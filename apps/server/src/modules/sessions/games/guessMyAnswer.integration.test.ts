import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, type SessionView } from '@rasmalai/shared';
import { GUESS_MY_ANSWER_ROUNDS, type GuessMyAnswerView } from '@rasmalai/games';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

/**
 * Guess My Answer through the real registry: real Postgres, the real session registry, and the
 * real `packages/games/src/guess-my-answer` rulebook running underneath it (untouched — this file
 * tests the platform's handling of that rulebook, not the rulebook itself, which already has 21
 * passing unit tests of its own).
 *
 * What this proves that nothing else does: both seats act at once through the real registry with
 * neither one waiting on the other, an answer's *content* never reaches the partner while its
 * *existence* does, and a `social` game reaches real Postgres with no winner and touches no
 * competitive counter — P-3, read by the platform from `games.scoring_kind`, not from the module's
 * own opinion of itself (confirmed against `0004_dashboard.sql`, which catalogues
 * `guess-my-answer` as `category = 'social', scoring_kind = 'social'`).
 *
 * This game asks the platform for no clock at all (`nextTickAt` is always null — see
 * `guess-my-answer/server.ts`), so unlike Memory there is no peek timer racing a faked `Date.now()`
 * against the registry's real one, and Memory's `vi.getRealSystemTime()` workaround has nothing to
 * work around here. Plain `Date.now()` is correct throughout, per Task 3b's fix making both
 * `sessionRegistry.ts` and `matchRunner.ts` resolve `now` lazily.
 */

const env = integrationEnv();

describe.skipIf(env === null)('guess my answer, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await ctx.dispose();
  });

  /** Opens a guess-my-answer session with both players on the page and both ready, and starts the match. */
  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'guess-my-answer',
      gameName: 'Guess My Answer',
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

  const answerView = (view: SessionView): GuessMyAnswerView => view.game!.state as GuessMyAnswerView;

  /** Locks in a pick — the caller's own answer if they are answering this round, their guess if not.
   * Both roles submit the identical `choose` shape; the rulebook routes it to the right field. */
  function choose(sessionId: string, userId: string, round: number, option: number): void {
    ctx.sessions.submitAction(
      sessionId,
      userId,
      { type: 'choose', round, option },
      { receivedAt: Date.now(), compensationMs: 0 },
    );
  }

  /** "I have read the reveal, move on." Both have to say so before the round advances. */
  function next(sessionId: string, userId: string, round: number): void {
    ctx.sessions.submitAction(
      sessionId,
      userId,
      { type: 'next', round },
      { receivedAt: Date.now(), compensationMs: 0 },
    );
  }

  it('names nobody on the move while both are still deciding', async () => {
    const sessionId = await startMatch();
    // Both seats act simultaneously, so there is no turn to take until one of them commits.
    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).turnUserId).toBeNull();
    expect(ctx.sessions.viewFor(sessionId, ctx.bob.id).turnUserId).toBeNull();
  });

  it('tells the partner that an answer landed without telling them what it was', async () => {
    const sessionId = await startMatch();

    choose(sessionId, ctx.alice.id, 1, 1);

    const partnerView = ctx.sessions.viewFor(sessionId, ctx.bob.id);
    const partnerState = answerView(partnerView);

    // The fact travels: Bob is told somebody moved.
    expect(partnerState.theyHaveChosen).toBe(true);
    // The content does not: nothing that could carry Alice's option has left the server yet — every
    // field on the wire that could hold a pick is still null/false, and history (which only ever
    // holds *past*, revealed rounds) is still empty.
    expect(partnerState.revealed).toBe(false);
    expect(partnerState.answer).toBeNull();
    expect(partnerState.guess).toBeNull();
    expect(partnerState.correct).toBeNull();
    expect(partnerState.yourChoice).toBeNull();
    expect(partnerState.history).toEqual([]);
    // A seatbelt on top of the field-by-field checks above: the option Alice locked in (1) never
    // appears anywhere a pick could sit in Bob's own serialized view.
    expect(JSON.stringify(partnerState)).not.toMatch(/"(answer|guess|yourChoice)":1\b/);

    // Once one of them is in, the clock is waiting on the straggler — Bob.
    expect(partnerView.turnUserId).toBe(ctx.bob.id);
  });

  it('records a social match with no winner and no competitive counter', async () => {
    const sessionId = await startMatch();

    // Six rounds, played out deterministically: whichever seat is answering this round and whichever
    // is guessing both submit the identical `choose` shape (the rulebook, not this test, decides
    // which field each pick lands in). Every round but the last also needs both of them to say
    // "next" before the roles swap; the sixth reveal completes the match on its own.
    for (let round = 1; round <= GUESS_MY_ANSWER_ROUNDS; round += 1) {
      choose(sessionId, ctx.alice.id, round, 0);
      choose(sessionId, ctx.bob.id, round, 0);

      if (round < GUESS_MY_ANSWER_ROUNDS) {
        next(sessionId, ctx.alice.id, round);
        next(sessionId, ctx.bob.id, round);
      }
    }

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    await ctx.recorder.drain();

    const match = await ctx.pool.query<{ status: string; winner_user_id: string | null }>(
      'select status, winner_user_id from public.matches where couple_id = $1',
      [ctx.coupleId],
    );
    expect(match.rows[0]!.status).toBe('completed');
    expect(match.rows[0]!.winner_user_id).toBeNull();

    const stats = await ctx.pool.query<{
      total_games: number;
      competitive_games: number;
      draws: number;
    }>(
      `select total_games, competitive_games, draws
         from public.lifetime_statistics where couple_id = $1`,
      [ctx.coupleId],
    );
    // P-3: played and counted, and counted by nothing else. A social game is never a draw.
    expect(stats.rows[0]!.total_games).toBe(1);
    expect(stats.rows[0]!.competitive_games).toBe(0);
    expect(stats.rows[0]!.draws).toBe(0);
  });
});
