import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS } from '@rasmalai/shared';
import {
  BASKETBALL_MAX_ANGLE_DEG,
  BASKETBALL_TOTAL_SHOTS,
  type BasketballView,
  type ShootAction,
} from '@rasmalai/games';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

/**
 * Basketball through the real registry: real Postgres, the real session registry, and the real
 * `packages/games/src/basketball` rulebook running underneath it (untouched — this file tests the
 * platform's handling of that rulebook, not the rulebook itself, which already has 50 passing unit
 * tests of its own). This is the largest and newest game in the product — 548 lines of rulebook, a
 * 655-line Phaser client — and it shipped with no integration coverage at all until this file.
 *
 * What this proves that nothing else does: the server refuses an illegal shot and an out-of-turn
 * shot through the real `userId → seat` resolution in `sessionRegistry.ts`, not through
 * `rules.validateAction` called directly against a `PlayerIndex` the way the rulebook's own unit
 * tests do; and a full twenty-shot match actually plays out through the platform's real event loop
 * (shot clock, watch beat, round-by-round hoop rolls) and reaches real Postgres as a completed
 * competitive match, not a forfeit wearing the same status string.
 *
 * **Corrections to the task brief's guesses, read against `packages/games/src/basketball/protocol.ts`
 * and `server.ts` before writing anything (R6):**
 *
 * - `{ type: 'shoot', shot, angle, power }` is exactly right — matches the real `ShootAction`.
 * - The angle range `[20, 80]` is exactly right (`MIN_ANGLE_DEG`/`MAX_ANGLE_DEG`), imported here as
 *   `BASKETBALL_MAX_ANGLE_DEG` rather than hand-typed.
 * - **The brief's `view.game.state.shot` does not exist.** The real field is `shotNumber`, on
 *   `BasketballView`. `state` here is not one flat number either — it is the per-seat view the
 *   whole match renders from (`shotNumber`, `phase: 'aiming' | 'watching'`, `watchUntil`, `history`,
 *   …), read as `BasketballView`.
 * - **`view.phase` and `view.game.state.phase` are two different phases, and the brief's tests
 *   conflate them.** The outer `SessionView.phase` is the lobby/countdown/active/finished lifecycle
 *   the other four suites already assert against. The inner `BasketballView.phase` is
 *   `'aiming' | 'watching'` — whether a shot is currently open or the ball is being watched land.
 *   Neither is ever `'active'` for the inner one; the brief's loop guard (`view.phase !== 'active'`)
 *   only makes sense read against the outer view, which is what this file does throughout.
 * - **The brief's hardcoded `shot: 0` is wrong for both refusal tests.** `shotNumber` is 1-based —
 *   `createMatch` opens the match on shot 1, not 0 — so `shot: 0` fails `validateAction`'s
 *   staleness check ("That shot has already gone.") before the angle-range or turn-order check the
 *   tests mean to exercise ever runs. Both refusal tests below read the real, current `shotNumber`
 *   from the view and shoot that, so the *intended* rule is the one that actually throws.
 *
 * **No `try/catch` anywhere in this file, per the ruling against the brief's swallow-and-retry
 * loop.** The brief's twenty-shot loop wrapped `submitAction` in `try {} catch {}` with a comment
 * about stale shot numbers — a loop that can silently eat every one of its own assertions proves
 * nothing. Instead, each iteration reads `BasketballView.watchUntil` — the server's own epoch-ms
 * answer for when the next shot arms — straight off the just-submitted state, and advances the fake
 * clock by exactly that much. Nothing is ever submitted against a shot number that has already
 * moved on, so nothing ever needs to be caught. The shot clock (`SHOT_CLOCK_MS`, 15s) is never at
 * risk of running out either, because a shot is submitted the instant its `'aiming'` phase is
 * observed, with no fake time advanced in between — the completion test asserts this directly by
 * checking that no shot in the finished match's `history` carries the `'timeout'` outcome, which is
 * what a match ended by the shot clock rather than by being played would show.
 *
 * The hoop's motion is server-random and unseedable (`GameContext.random`, confirmed not exposed
 * through `IntegrationContext`, the same finding every prior task in this slice has made) — level
 * two's amplitude, period and phase are rolled fresh per round and cannot be predicted. That
 * randomness only affects whether a fixed-angle, fixed-power shot happens to go in; it never
 * affects whether the shot is *legal*, so the completion test below picks one throw (45°, 0.6
 * power) and submits it from whoever the view says is on turn, however the hoop happened to land.
 */

const env = integrationEnv();

describe.skipIf(env === null)('basketball, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await ctx.dispose();
  });

  /** Opens a basketball session with both players on the page and both ready, and starts the match. */
  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'basketball',
      gameName: 'Basketball',
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

  const basketballView = (sessionId: string, userId: string): BasketballView =>
    ctx.sessions.viewFor(sessionId, userId).game!.state as BasketballView;

  /** One throw, through the real registry — the real `userId → seat` resolution, not a `PlayerIndex`. */
  function shoot(sessionId: string, userId: string, shot: number, angle: number, power: number): void {
    ctx.sessions.submitAction(
      sessionId,
      userId,
      { type: 'shoot', shot, angle, power } satisfies ShootAction,
      { receivedAt: Date.now(), compensationMs: 0 },
    );
  }

  it('refuses a shot with an angle outside the legal range', async () => {
    const sessionId = await startMatch();
    const outer = ctx.sessions.viewFor(sessionId, ctx.alice.id);
    const shooter = outer.turnUserId!;
    const shotNumber = basketballView(sessionId, ctx.alice.id).shotNumber;

    expect(() => shoot(sessionId, shooter, shotNumber, BASKETBALL_MAX_ANGLE_DEG + 9, 0.5)).toThrow(
      expect.objectContaining({
        code: 'invalid_action',
        message: 'That is not an angle you can throw at.',
      }),
    );
  });

  it('refuses a shot from the player whose turn it is not', async () => {
    const sessionId = await startMatch();
    const outer = ctx.sessions.viewFor(sessionId, ctx.alice.id);
    const shooter = outer.turnUserId!;
    const waiting = shooter === ctx.alice.id ? ctx.bob.id : ctx.alice.id;
    const shotNumber = basketballView(sessionId, ctx.alice.id).shotNumber;

    expect(() => shoot(sessionId, waiting, shotNumber, 45, 0.6)).toThrow(
      expect.objectContaining({ code: 'invalid_action', message: 'It is not your shot.' }),
    );
  });

  it('plays all twenty shots and records a completed competitive match', async () => {
    const sessionId = await startMatch();

    // Twenty shots, driven deterministically: each iteration reads whose turn it is and which shot
    // number is current straight from the authoritative view, submits exactly that shot, then reads
    // the server's own `watchUntil` off the state the submission just produced and advances the
    // fake clock by exactly that much — never a guessed constant, never a catch that could hide a
    // rejected shot.
    for (let expected = 1; expected <= BASKETBALL_TOTAL_SHOTS; expected += 1) {
      const outer = ctx.sessions.viewFor(sessionId, ctx.alice.id);
      const game = outer.game!.state as BasketballView;
      expect(game.phase).toBe('aiming');
      expect(game.shotNumber).toBe(expected);
      const shooter = outer.turnUserId!;

      shoot(sessionId, shooter, expected, 45, 0.6);

      const afterShot = basketballView(sessionId, ctx.alice.id);
      expect(afterShot.phase).toBe('watching');
      // Small buffer past the server's own beat, the same margin Memory's suite uses past
      // `MEMORY_PEEK_MS` — never a hardcoded flight/settle estimate of our own.
      const delay = Math.max(1, afterShot.watchUntil! - Date.now()) + 50;
      await vi.advanceTimersByTimeAsync(delay);
    }

    const finishedOuter = ctx.sessions.viewFor(sessionId, ctx.alice.id);
    expect(finishedOuter.phase).toBe('finished');

    const finishedGame = finishedOuter.game!.state as BasketballView;
    expect(finishedGame.complete).toBe(true);
    // Proof this ended by being played rather than by the shot clock or a forfeit: all twenty shots
    // are on the record, split across the two of them, and not one of them is a `'timeout'`.
    expect(finishedGame.history).toHaveLength(BASKETBALL_TOTAL_SHOTS);
    expect(finishedGame.yourShotsTaken + finishedGame.theirShotsTaken).toBe(BASKETBALL_TOTAL_SHOTS);
    expect(finishedGame.history.every((shot) => shot.outcome !== 'timeout')).toBe(true);

    await ctx.recorder.drain();

    const match = await ctx.pool.query<{ status: string; score_a: number; score_b: number }>(
      'select status, score_a, score_b from public.matches where couple_id = $1',
      [ctx.coupleId],
    );
    expect(match.rows[0]!.status).toBe('completed');
    // The scoreline in Postgres is the sum of points actually recorded on the shots taken — not a
    // forfeit's 1–0, which this cross-check would catch: twenty real shots at 45°/0.6 power can
    // only ever total 0 (every shot missed) or a multiple of 2 or 3 up to the low thirties, never
    // exactly the single point a forfeit awards the survivor.
    const totalPoints = finishedGame.history.reduce((sum, shotRecord) => sum + shotRecord.points, 0);
    expect(match.rows[0]!.score_a + match.rows[0]!.score_b).toBe(totalPoints);

    const lifetime = await ctx.pool.query<{ total_games: number; competitive_games: number }>(
      'select total_games, competitive_games from public.lifetime_statistics where couple_id = $1',
      [ctx.coupleId],
    );
    expect(lifetime.rows[0]!.total_games).toBe(1);
    expect(lifetime.rows[0]!.competitive_games).toBe(1);

    const stats = await ctx.pool.query<{
      plays: number;
      user_a_best_score: number | null;
      user_b_best_score: number | null;
    }>(
      `select cgs.plays, cgs.user_a_best_score, cgs.user_b_best_score
         from public.couple_game_stats cgs join public.games g on g.id = cgs.game_id
        where cgs.couple_id = $1 and g.slug = 'basketball'`,
      [ctx.coupleId],
    );
    expect(stats.rows[0]!.plays).toBe(1);
    expect(stats.rows[0]!.user_a_best_score).toBe(match.rows[0]!.score_a);
    expect(stats.rows[0]!.user_b_best_score).toBe(match.rows[0]!.score_b);
  });
});
