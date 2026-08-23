import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, type SessionView } from '@rasmalai/shared';
import { type WordGameView } from '@rasmalai/games';
// Reached by relative path on purpose. `packages/games/package.json` publishes only `.`, `./server`
// and `./client`, so `@rasmalai/games/word-game/dictionary` does not resolve — that exports map is
// one of the three fences keeping the dictionary out of the browser, and a test is not a reason to
// widen it. A test in the same monorepo reading source is ordinary; a new public entrypoint is not.
import { validate as validateWord } from '../../../../../../packages/games/src/word-game/dictionary';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

/**
 * Word Game through the real registry: real Postgres, the real session registry, and the real
 * `packages/games/src/word-game` rulebook running underneath it (untouched — this file tests the
 * platform's handling of that rulebook, not the rulebook itself, which has 33 unit tests of its own
 * and 8 more for the dictionary).
 *
 * What this proves that nothing else does: the dictionary is enforced **on the server** across a
 * real submission rather than in a unit call, whose turn it is survives the registry's
 * user-id-to-seat resolution, and a game the catalogue files as **casual** is recorded as
 * **competitive with a named winner** — the half `catalogue.test.ts` cannot reach, because it
 * compares two strings and this compares behaviour.
 *
 * This game asks the platform for no clock at all (`turnOf` and `nextTickAt` are both always null,
 * deliberately — see the rulebook), so plain `Date.now()` is correct throughout and there is no
 * timer racing a faked one.
 */

const env = integrationEnv();

describe.skipIf(env === null)('word game, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await ctx.dispose();
  });

  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'word-game',
      gameName: 'Word Game',
      players: [
        { userId: ctx.alice.id, nickname: ctx.alice.nickname, avatarKey: 'fox', gender: 'female' },
        { userId: ctx.bob.id, nickname: ctx.bob.nickname, avatarKey: 'penguin', gender: 'male' },
      ],
    });
    ctx.sessions.join(view.id, ctx.alice.id);
    ctx.sessions.join(view.id, ctx.bob.id);
    ctx.sessions.setReady(view.id, ctx.alice.id, true);
    ctx.sessions.setReady(view.id, ctx.bob.id, true);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 1);
    return view.id;
  }

  const gameView = (view: SessionView): WordGameView => view.game!.state as WordGameView;
  const viewOf = (sessionId: string, userId: string) =>
    gameView(ctx.sessions.viewFor(sessionId, userId));

  const send = (sessionId: string, userId: string, action: unknown): void => {
    ctx.sessions.submitAction(sessionId, userId, action, {
      receivedAt: Date.now(),
      compensationMs: 0,
    });
  };

  /** Whichever of the two the view says is on the move. There is no `turnUserId` — no move clock. */
  function mover(sessionId: string): string {
    return viewOf(sessionId, ctx.alice.id).yourTurn ? ctx.alice.id : ctx.bob.id;
  }

  /**
   * Finds a real three-letter word in whatever the server dealt.
   *
   * The pool is shuffled from the platform's own RNG, so a test cannot know the letters in advance.
   * Brute-forcing ordered triples over twelve tiles is 1,320 candidates and takes no measurable
   * time. Returns null if the pool genuinely holds no three-letter word, which the caller treats as
   * a skip rather than a failure — that is a property of the deal, not of the code under test.
   */
  function findWord(view: WordGameView): number[] | null {
    const pool = view.pool;
    for (const a of pool) {
      for (const b of pool) {
        if (b.id === a.id) continue;
        for (const c of pool) {
          if (c.id === a.id || c.id === b.id) continue;
          if (validateWord(a.letter + b.letter + c.letter).valid) return [a.id, b.id, c.id];
        }
      }
    }
    return null;
  }

  it('starts a match and writes an active row for the right game', async () => {
    const sessionId = await startMatch();
    const view = viewOf(sessionId, ctx.alice.id);

    expect(view.pool).toHaveLength(12);
    expect(view.pool.filter((tile) => tile.golden)).toHaveLength(1);
    expect(view.bagLeft).toBeGreaterThan(0);
    // Exactly one of them is on the move, and the platform is not policing it with a clock.
    expect(view.yourTurn).not.toBe(viewOf(sessionId, ctx.bob.id).yourTurn);
    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).turnUserId).toBeNull();

    await ctx.recorder.drain();
    const { rows } = await ctx.pool.query<{ status: string; slug: string }>(
      `select m.status, g.slug from public.matches m
         join public.games g on g.id = m.game_id
        where m.couple_id = $1`,
      [ctx.coupleId],
    );
    expect(rows[0]).toMatchObject({ status: 'active', slug: 'word-game' });
  });

  it('enforces the dictionary on the server, and does not cost the player their turn', async () => {
    const sessionId = await startMatch();
    const on = mover(sessionId);
    const pool = viewOf(sessionId, on).pool;

    // Three tiles that are almost certainly not a word, submitted through the real socket path.
    // The browser has no dictionary at all, so this decision can only have been the server's.
    const nonsense = [...pool].sort((a, b) => a.letter.localeCompare(b.letter)).slice(0, 3);
    const before = viewOf(sessionId, on);
    send(sessionId, on, { type: 'claim', tiles: nonsense.map((tile) => tile.id), steal: null });

    const after = viewOf(sessionId, on);
    if (validateWord(nonsense.map((tile) => tile.letter).join('')).valid) {
      // The deal handed us a real word. Then it must have been accepted, which is the mirror
      // assertion and just as good.
      expect(after.yourWords).toHaveLength(1);
    } else {
      expect(after.lastRejection).toBe('NOT_FOUND');
      expect(after.yourTurn).toBe(true);
      expect(after.yourWords).toEqual([]);
      expect(after.pool).toHaveLength(before.pool.length);
    }
  });

  it('refuses a move from the seat whose turn it is not, resolved from a real user id', async () => {
    const sessionId = await startMatch();
    const waiting = mover(sessionId) === ctx.alice.id ? ctx.bob.id : ctx.alice.id;

    // The seat is resolved by the registry from the user id; the rulebook only ever sees 0 or 1.
    expect(() => send(sessionId, waiting, { type: 'pass' })).toThrow();
  });

  it('records a completed competitive match with a winner, though the catalogue files it casual', async () => {
    const sessionId = await startMatch();

    // One real word so the scoreline is decided, then both of them run the match out. The bag is
    // full, so this ends on the turn cap — which is the backstop that exists precisely because this
    // game asks for no move clock.
    const on = mover(sessionId);
    const word = findWord(viewOf(sessionId, on));
    expect(word, 'the deal held no three-letter word at all').not.toBeNull();
    send(sessionId, on, { type: 'claim', tiles: word!, steal: null });
    expect(viewOf(sessionId, on).yourWords).toHaveLength(1);

    for (let guard = 0; guard < 200 && !viewOf(sessionId, ctx.alice.id).complete; guard += 1) {
      send(sessionId, mover(sessionId), { type: 'pass' });
    }

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    await ctx.recorder.drain();

    const { rows } = await ctx.pool.query<{
      status: string;
      winner_user_id: string | null;
      score_a: number;
      score_b: number;
    }>(
      'select status, winner_user_id, score_a, score_b from public.matches where couple_id = $1',
      [ctx.coupleId],
    );
    expect(rows[0]!.status).toBe('completed');
    // Null here on a cooperative or social result by design, so a real id is the assertion:
    // `scoring_kind` reached the recorder and was read as competitive.
    expect(rows[0]!.winner_user_id).toBe(on);
    expect(Math.max(rows[0]!.score_a, rows[0]!.score_b)).toBe(9);

    const stats = await ctx.pool.query<{ total_games: number; competitive_games: number }>(
      'select total_games, competitive_games from public.lifetime_statistics where couple_id = $1',
      [ctx.coupleId],
    );
    expect(stats.rows[0]!.total_games).toBe(1);
    expect(stats.rows[0]!.competitive_games).toBe(1);
  });
});
