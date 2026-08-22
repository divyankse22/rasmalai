import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, type SessionView } from '@rasmalai/shared';
import { WOULD_YOU_RATHER_ROUNDS, type WouldYouRatherView } from '@rasmalai/games';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

/**
 * Would You Rather through the real registry: real Postgres, the real session registry, and the
 * real `packages/games/src/would-you-rather` rulebook running underneath it (untouched — this file
 * tests the platform's handling of that rulebook, not the rulebook itself, which has 42 passing
 * unit tests of its own).
 *
 * What this proves that nothing else does: the two seats really do receive structurally different
 * frames through the real `viewFor`, the two dilemmas the Asker turned down never cross the wire to
 * the Answerer, the Asker's frame carries no answer until their prediction lands, and a game the
 * catalogue files as **social** is recorded as **competitive with a named winner** — which is the
 * half `catalogue.test.ts` cannot reach, because it compares two strings and this compares
 * behaviour.
 *
 * This game asks the platform for no clock at all (`nextTickAt` is always null), so plain
 * `Date.now()` is correct throughout — there is no timer racing a faked clock.
 */

const env = integrationEnv();

describe.skipIf(env === null)('would you rather, through the real registry', () => {
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
      gameSlug: 'would-you-rather',
      gameName: 'Would You Rather',
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

  const gameView = (view: SessionView): WouldYouRatherView => view.game!.state as WouldYouRatherView;
  const viewOf = (sessionId: string, userId: string) =>
    gameView(ctx.sessions.viewFor(sessionId, userId));

  const send = (sessionId: string, userId: string, action: unknown): void => {
    ctx.sessions.submitAction(sessionId, userId, action, {
      receivedAt: Date.now(),
      compensationMs: 0,
    });
  };

  /** Whoever the real registry says is on the move at the start of a round is the Asker. */
  function seats(sessionId: string): { asker: string; answerer: string } {
    const asker = ctx.sessions.viewFor(sessionId, ctx.alice.id).turnUserId!;
    return { asker, answerer: asker === ctx.alice.id ? ctx.bob.id : ctx.alice.id };
  }

  /** Drives one whole round through the real registry and returns who asked it. */
  function playRound(sessionId: string, round: number, answer: 0 | 1, prediction: 0 | 1): string {
    const { asker, answerer } = seats(sessionId);
    send(sessionId, asker, { type: 'select', round, candidate: 0 });
    send(sessionId, answerer, { type: 'answer', round, option: answer });
    send(sessionId, asker, { type: 'predict', round, option: prediction });
    if (round < WOULD_YOU_RATHER_ROUNDS) {
      send(sessionId, ctx.alice.id, { type: 'next', round });
      send(sessionId, ctx.bob.id, { type: 'next', round });
    }
    return asker;
  }

  it('hands the two seats structurally different frames', async () => {
    const sessionId = await startMatch();
    const { asker, answerer } = seats(sessionId);

    const askerState = viewOf(sessionId, asker);
    const answererState = viewOf(sessionId, answerer);

    expect(askerState.yourRole).toBe('asking');
    expect(answererState.yourRole).toBe('answering');
    // The sanity guard: exactly one of the two real frames has candidates on it at all.
    expect('candidates' in askerState).toBe(true);
    expect('candidates' in answererState).toBe(false);
  });

  it('never sends the two unchosen dilemmas to the Answerer', async () => {
    const sessionId = await startMatch();
    const { asker, answerer } = seats(sessionId);

    const dealt = viewOf(sessionId, asker) as Extract<WouldYouRatherView, { yourRole: 'asking' }>;
    const losing = dealt.candidates.slice(1);
    expect(losing).toHaveLength(2);

    send(sessionId, asker, { type: 'select', round: 1, candidate: 0 });
    send(sessionId, answerer, { type: 'answer', round: 1, option: 0 });
    send(sessionId, asker, { type: 'predict', round: 1, option: 0 });

    // Through every phase including the reveal, and through the real emitted frames rather than a
    // view built by hand.
    const serialized = JSON.stringify(ctx.sessions.viewFor(sessionId, answerer));
    for (const dilemma of losing) {
      expect(serialized).not.toContain(dilemma.optionA);
      expect(serialized).not.toContain(dilemma.optionB);
    }
    // And the same text really is on the other screen, so the sweep above means something.
    expect(JSON.stringify(ctx.sessions.viewFor(sessionId, asker))).toContain(losing[0]!.optionA);
  });

  it('withholds the answer from the Asker until their prediction lands, and enforces the roles', async () => {
    const sessionId = await startMatch();
    const { asker, answerer } = seats(sessionId);

    send(sessionId, asker, { type: 'select', round: 1, candidate: 0 });
    send(sessionId, answerer, { type: 'answer', round: 1, option: 1 });

    const waiting = viewOf(sessionId, asker);
    expect(waiting.phase).toBe('predicting');
    expect(waiting.answer).toBeNull();
    expect(JSON.stringify(ctx.sessions.viewFor(sessionId, asker))).not.toContain('"answer":1');

    // The role split is resolved by the real registry from a user id, not from a seat index.
    expect(() => send(sessionId, answerer, { type: 'predict', round: 1, option: 1 })).toThrow();
    expect(() => send(sessionId, asker, { type: 'answer', round: 1, option: 0 })).toThrow();

    send(sessionId, asker, { type: 'predict', round: 1, option: 1 });
    expect(viewOf(sessionId, asker).answer).toBe(1);
    expect(viewOf(sessionId, asker).correct).toBe(true);
  });

  it('walks the move clock across the seats, phase by phase', async () => {
    const sessionId = await startMatch();
    const { asker, answerer } = seats(sessionId);

    expect(ctx.sessions.viewFor(sessionId, asker).turnUserId).toBe(asker);
    send(sessionId, asker, { type: 'select', round: 1, candidate: 0 });
    expect(ctx.sessions.viewFor(sessionId, asker).turnUserId).toBe(answerer);
    send(sessionId, answerer, { type: 'answer', round: 1, option: 0 });
    expect(ctx.sessions.viewFor(sessionId, asker).turnUserId).toBe(asker);
    send(sessionId, asker, { type: 'predict', round: 1, option: 0 });
    // Nobody is late at the instant of a reveal — they are both reading it.
    expect(ctx.sessions.viewFor(sessionId, asker).turnUserId).toBeNull();
  });

  it('records a competitive win with a real winner, though the catalogue files it as social', async () => {
    const sessionId = await startMatch();

    // The first Asker calls every one of theirs; the other calls none. Six rounds, decided 3-0.
    const first = seats(sessionId).asker;
    for (let round = 1; round <= WOULD_YOU_RATHER_ROUNDS; round += 1) {
      const asking = seats(sessionId).asker;
      playRound(sessionId, round, 0, asking === first ? 0 : 1);
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
    // The whole point of `0012`: a social game that names a winner, and Postgres agrees. On a
    // cooperative or social result this column is null by design, so a real id here is the
    // assertion — `scoring_kind` reached the recorder and was read as competitive.
    expect(rows[0]!.winner_user_id).toBe(first);
    // 3-0: the scoreline backs up the winner, so a stray forfeit could not produce this row.
    expect([rows[0]!.score_a, rows[0]!.score_b].sort()).toEqual([0, 3]);

    const stats = await ctx.pool.query<{ total_games: number; competitive_games: number }>(
      'select total_games, competitive_games from public.lifetime_statistics where couple_id = $1',
      [ctx.coupleId],
    );
    expect(stats.rows[0]!.total_games).toBe(1);
    expect(stats.rows[0]!.competitive_games).toBe(1);
  });
});
