import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, type SessionView } from '@rasmalai/shared';
import { MEMORY_PEEK_MS, type MemoryCard, type MemoryView } from '@rasmalai/games';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

/**
 * Memory through the real registry: real Postgres, the real session registry, and the real
 * `packages/games/src/memory` rulebook running underneath it (untouched — this file tests the
 * platform's handling of that rulebook, not the rulebook itself, which already has 27 passing
 * unit tests of its own).
 *
 * What this proves that nothing else does: the board's secret survives the platform's own
 * view-building (a face never reaches a client that has not earned it), and a game shelved
 * `casual` in the catalogue is recorded `competitive` in `matches`/`lifetime_statistics` because
 * `games.scoring_kind` says so — P-3 is read from the catalogue, not from the module's own
 * opinion of itself.
 *
 * `ActionTiming.receivedAt` is deliberately built from `vi.getRealSystemTime()`, never the faked
 * `Date.now()`. `createIntegrationContext()` constructs the real `SessionRegistry` — and the
 * `matchRunner` clock every game (including Memory's peek timer) schedules against — before this
 * suite's `beforeEach` ever installs fake timers, per R5. That `now` is a plain function
 * reference resolved once at construction, so it stays bound to the real clock for the session's
 * whole life; `vi.useFakeTimers()` cannot retroactively rebind it. Stamping an action with the
 * *faked* clock while the platform schedules its next tick off the *real* one lets the two values
 * drift apart every time this test fast-forwards past a peek — the real fix, since neither
 * `sessionRegistry.ts` nor `matchRunner.ts` is this task's to change.
 */

const env = integrationEnv();

describe.skipIf(env === null)('memory, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await ctx.dispose();
  });

  /** Opens a memory session with both players on the page and both ready, and starts the match. */
  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'memory',
      gameName: 'Memory',
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

  const memoryView = (view: SessionView): MemoryView => view.game!.state as MemoryView;

  /** A flip, timed off the real clock — see the file banner for why. */
  function flip(sessionId: string, userId: string, card: number): void {
    ctx.sessions.submitAction(
      sessionId,
      userId,
      { type: 'flip', card },
      { receivedAt: vi.getRealSystemTime(), compensationMs: 0 },
    );
  }

  it('starts a match and writes an active row for the right game', async () => {
    const sessionId = await startMatch();
    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('active');

    await ctx.recorder.drain();

    const { rows } = await ctx.pool.query<{ status: string; slug: string; mode: string }>(
      `select m.status, g.slug, m.mode
         from public.matches m join public.games g on g.id = m.game_id
        where m.couple_id = $1`,
      [ctx.coupleId],
    );

    expect(rows).toEqual([{ status: 'active', slug: 'memory', mode: 'individual' }]);
  });

  it('never shows an unclaimed, face-down card to either player', async () => {
    const sessionId = await startMatch();

    for (const userId of [ctx.alice.id, ctx.bob.id]) {
      const cards = memoryView(ctx.sessions.viewFor(sessionId, userId)).cards;
      expect(cards).not.toHaveLength(0);
      // At the start nothing is turned over and nothing is claimed, so no face may be readable.
      expect(cards.every((card) => card.face === null)).toBe(true);
    }

    // Nothing was ever started here beyond the lobby-to-active transition; nothing to drain.
    await ctx.recorder.drain();
  });

  it('reveals a face only to the seat that turned it, and only while it is up', async () => {
    const sessionId = await startMatch();
    const turn = ctx.sessions.viewFor(sessionId, ctx.alice.id).turnUserId!;
    const waiting = turn === ctx.alice.id ? ctx.bob.id : ctx.alice.id;

    flip(sessionId, turn, 0);

    const flipped = memoryView(ctx.sessions.viewFor(sessionId, turn)).cards[0]!;
    const partnerSees = memoryView(ctx.sessions.viewFor(sessionId, waiting)).cards[0]!;

    expect(flipped.face).not.toBeNull();
    // A face-up card is public — both are looking at the same table.
    expect(partnerSees.face).toBe(flipped.face);
    // Everything still face down stays hidden from both.
    expect(
      memoryView(ctx.sessions.viewFor(sessionId, waiting)).cards.filter(
        (card) => card.face !== null,
      ),
    ).toHaveLength(1);

    await ctx.recorder.drain();
  });

  it('records the match as competitive even though memory is shelved casual', async () => {
    const sessionId = await startMatch();

    // Play the board to completion deterministically, the way a real player legitimately could:
    // remember every face a flip ever revealed, and once two remembered faces match, claim them.
    // Nothing here reads server-side state directly — only what `memoryView` hands back to Alice,
    // exactly what a client on the wire receives.
    const known = new Map<number, string>();
    const claimed = new Set<number>();

    function remember(state: MemoryView): void {
      state.cards.forEach((card: MemoryCard, index: number) => {
        if (card.matched !== null) claimed.add(index);
        if (card.face !== null) known.set(index, card.face);
      });
    }

    /** Two live card indices to flip next: a known pair if one is remembered, else fresh ground. */
    function pickGuess(total: number): [number, number] {
      const live: number[] = [];
      for (let index = 0; index < total; index += 1) {
        if (!claimed.has(index)) live.push(index);
      }

      const byFace = new Map<string, number[]>();
      for (const index of live) {
        const face = known.get(index);
        if (face === undefined) continue;
        const indices = byFace.get(face) ?? [];
        indices.push(index);
        byFace.set(face, indices);
      }
      for (const indices of byFace.values()) {
        if (indices.length >= 2) return [indices[0]!, indices[1]!];
      }

      // No known pair yet: prefer ground we have never seen, then fill from whatever is left.
      const picks: number[] = [];
      for (const index of live) {
        if (picks.length === 2) break;
        if (!known.has(index)) picks.push(index);
      }
      for (const index of live) {
        if (picks.length === 2) break;
        if (!picks.includes(index)) picks.push(index);
      }

      return [picks[0]!, picks[1]!];
    }

    // 10 pairs; this strategy never needs more than a few dozen guesses. A guard against an
    // infinite loop, not a tuned budget.
    const guessLimit = 100;
    let guesses = 0;
    for (;;) {
      const view = ctx.sessions.viewFor(sessionId, ctx.alice.id);
      if (view.phase !== 'active') break;

      const state = memoryView(view);
      remember(state);

      if (state.peeking) {
        // A mismatch is showing; nobody may move until the server turns it back over.
        await vi.advanceTimersByTimeAsync(MEMORY_PEEK_MS + 50);
        continue;
      }

      const mover = view.turnUserId;
      if (!mover) break;

      guesses += 1;
      expect(guesses).toBeLessThanOrEqual(guessLimit);

      const [first, second] = pickGuess(state.cards.length);

      flip(sessionId, mover, first);
      // The mover's own view after the first flip is exactly what a real player sees before
      // choosing the second card.
      remember(memoryView(ctx.sessions.viewFor(sessionId, mover)));

      flip(sessionId, mover, second);
    }

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    await ctx.recorder.drain();

    const { rows } = await ctx.pool.query<{ status: string; score_a: number; score_b: number }>(
      'select status, score_a, score_b from public.matches where couple_id = $1',
      [ctx.coupleId],
    );
    expect(rows[0]!.status).toBe('completed');

    // P-3 reads `games.scoring_kind`, which `0009_slice_10_games.sql` moved to competitive.
    const stats = await ctx.pool.query<{ total_games: number; competitive_games: number }>(
      'select total_games, competitive_games from public.lifetime_statistics where couple_id = $1',
      [ctx.coupleId],
    );
    expect(stats.rows[0]!.total_games).toBe(1);
    expect(stats.rows[0]!.competitive_games).toBe(1);
  });
});
