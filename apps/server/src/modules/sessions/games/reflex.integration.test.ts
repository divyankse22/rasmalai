import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, RECONNECT_WINDOW_MS } from '@rasmalai/shared';
import { REFLEX_START_LANE, REFLEX_WAVES, type ReflexView } from '@rasmalai/games';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

/**
 * Reflex through the real registry: real Postgres, the real session registry, and the real
 * `packages/games/src/reflex` rulebook running underneath it (untouched — this file tests the
 * platform's handling of that rulebook, not the rulebook itself, which already has 22 passing unit
 * tests of its own).
 *
 * What this proves that nothing else does: both runners are handed the exact same server-generated
 * hazard schedule through real per-seat view-building; the platform's `pause`/`resume` on a real
 * registry disconnect preserves *game time* rather than wall clock — Reflex's whole timing model,
 * and the headline test in this file; the registry refuses a move while a partner is away, and lets
 * a legal one through the real `userId → seat` resolution when nobody is; and a genuinely
 * competitive, duration-scored match reaches real Postgres in `matches` and `couple_game_stats`.
 *
 * **The brief's guessed field name `hazards` does not exist.** Read against
 * `packages/games/src/reflex/protocol.ts`, `ReflexView` carries `waves: Wave[]` — the whole
 * schedule, sent once and unchanging. `elapsedMs` is a real field, but it is *not* a live "how much
 * time has passed" counter: `getView` returns `state.elapsedMs` verbatim, and the rulebook's own
 * `pause()`/`resume()` are the only two places that ever write to it — while a run is going, it
 * stays banked at whatever it was set to by the *previous* pause (0, initially), even as real
 * seconds tick by. A live client is expected to derive "how far the run has got" from `originAt`
 * (the wall-clock epoch that corresponds to game time zero) plus its own clock instead, which is
 * exactly why `originAt` exists on the wire at all. So the freeze test below proves real progress
 * before the disconnect through `Date.now() - originAt` (the only field that actually moves while
 * running), and proves the freeze itself — and "exactly what was left, no more and no less" across
 * the whole disconnect — through `elapsedMs` (which is exactly right for that, since it is the
 * banked value a paused screen is built to show). `{ type: 'move', direction: 'left' }` matches the
 * real `ReflexAction` exactly, no correction needed.
 *
 * This game runs a real platform clock the way Bomb Defusal's fuse does (`nextTickAt` returns a
 * real deadline, not `null`), so this suite depends on Task 3b's lazy-`now` fix
 * (`sessionRegistry.ts`/`matchRunner.ts` both default `now` to `() => Date.now()`). Plain
 * `Date.now()` is correct throughout; no `vi.getRealSystemTime()` workaround is used or needed.
 */

const env = integrationEnv();

describe.skipIf(env === null)('reflex, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await ctx.dispose();
  });

  /** Opens a reflex session with both players on the page and both ready, and starts the match. */
  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'reflex',
      gameName: 'Reflex',
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

  const reflexView = (sessionId: string, userId: string): ReflexView =>
    ctx.sessions.viewFor(sessionId, userId).game!.state as ReflexView;

  /** One step, through the real registry — the real `userId → seat` resolution, not a `PlayerIndex`. */
  function move(sessionId: string, userId: string, direction: 'left' | 'right'): void {
    ctx.sessions.submitAction(
      sessionId,
      userId,
      { type: 'move', direction },
      { receivedAt: Date.now(), compensationMs: 0 },
    );
  }

  it('gives both runners the identical hazard schedule', async () => {
    const sessionId = await startMatch();

    const alice = reflexView(sessionId, ctx.alice.id);
    const bob = reflexView(sessionId, ctx.bob.id);

    expect(alice.waves).toHaveLength(REFLEX_WAVES);
    expect(alice.waves).toEqual(bob.waves);
  });

  it('stops game time while somebody is away and resumes with what was left', async () => {
    const sessionId = await startMatch();

    // Real progress, first — proven the way a real client actually derives it. `elapsedMs` stays
    // banked at 0 for as long as the run keeps going (only `pause()` ever writes to it), so "how far
    // the run has got" while running has to come from `originAt` — the wall-clock epoch game time
    // zero corresponds to — plus the reader's own clock.
    const running = reflexView(sessionId, ctx.alice.id);
    expect(running.paused).toBe(false);
    expect(running.originAt).not.toBeNull();

    // Neither of them moves in this test, so staying under `LEAD_IN_MS` (2,500ms of game time, the
    // breath before the first hazard) for the whole test — 1,500ms here, another 500ms after
    // resuming, 2,000ms total — makes survival certain regardless of what the server's own
    // randomness drew for the schedule. This test is about the clock, not the run.
    await vi.advanceTimersByTimeAsync(1_500);

    const stillRunning = reflexView(sessionId, ctx.alice.id);
    // The origin does not move while nobody has been away — only a pause/resume cycle ever shifts
    // it, to carry a disconnect's downtime out of the game clock.
    expect(stillRunning.originAt).toBe(running.originAt);
    // Real fake-clock time genuinely passed and the game genuinely progressed: this is what makes
    // the freeze below meaningful rather than a test that would have passed with nothing moving.
    expect(Date.now() - stillRunning.originAt!).toBeGreaterThanOrEqual(1_500);

    ctx.online.delete(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, false);

    // The clock freezes the instant he leaves — both seats agree, immediately.
    const paused = reflexView(sessionId, ctx.alice.id);
    expect(paused.paused).toBe(true);
    expect(paused.originAt).toBeNull();
    expect(reflexView(sessionId, ctx.bob.id).paused).toBe(true);
    const banked = paused.elapsedMs;
    expect(banked).toBeGreaterThanOrEqual(1_500);

    // Wall clock moves by a full minute; the banked game time must not.
    await vi.advanceTimersByTimeAsync(RECONNECT_WINDOW_MS / 2);
    expect(reflexView(sessionId, ctx.alice.id).elapsedMs).toBe(banked);
    expect(reflexView(sessionId, ctx.alice.id).paused).toBe(true);

    ctx.online.add(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, true);
    ctx.sessions.join(sessionId, ctx.bob.id);

    const resumed = reflexView(sessionId, ctx.alice.id);
    expect(resumed.paused).toBe(false);
    expect(resumed.originAt).not.toBeNull();
    // "Exactly what was left, no more and no less": the run resumes from precisely what was banked,
    // however long the disconnect actually lasted.
    expect(Date.now() - resumed.originAt!).toBe(banked);

    await vi.advanceTimersByTimeAsync(500);
    // And it genuinely keeps going afterward, rather than staying frozen forever.
    expect(Date.now() - reflexView(sessionId, ctx.alice.id).originAt!).toBeGreaterThan(banked);

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('active');
  });

  it('lets a legal move through, and refuses a move once a partner is away', async () => {
    const sessionId = await startMatch();

    expect(reflexView(sessionId, ctx.alice.id).you.lane).toBe(REFLEX_START_LANE);

    // A real move, through the real `userId → seat` resolution — not `rules.validateAction` called
    // directly against a `PlayerIndex`, which the rulebook's own 22 unit tests already do. Visible
    // on both screens: this is what proves the resolution actually reached the rulebook rather than
    // merely failing to throw.
    move(sessionId, ctx.alice.id, 'left');
    expect(reflexView(sessionId, ctx.alice.id).you.lane).toBe(REFLEX_START_LANE - 1);
    expect(reflexView(sessionId, ctx.bob.id).them.lane).toBe(REFLEX_START_LANE - 1);

    ctx.online.delete(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, false);

    expect(() => move(sessionId, ctx.alice.id, 'right')).toThrow(
      expect.objectContaining({ code: 'invalid_game_state', message: 'The game is paused.' }),
    );
  });

  it('records the duration score against the game', async () => {
    const sessionId = await startMatch();

    // Nobody dodges anything, and neither of them ever moves — so both stay in the same starting
    // lane the whole run and are caught by exactly the same hazard at exactly the same moment. A
    // real, legal, fully deterministic ending: a draw, needing no seeded randomness to reach. The
    // longest a perfect run can take is ~33.4s of game time (45 waves, `LEAD_IN_MS` +
    // `INTERVAL_STEP_MS` easing to `FASTEST_INTERVAL_MS`, plus `GRACE_MS`); 120s of fake wall clock
    // is comfortably past that either way.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(reflexView(sessionId, ctx.alice.id).complete).toBe(true);
    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    await ctx.recorder.drain();

    const match = await ctx.pool.query<{
      status: string;
      winner_user_id: string | null;
      score_a: number;
      score_b: number;
    }>(
      `select status, winner_user_id, score_a, score_b
         from public.matches where couple_id = $1`,
      [ctx.coupleId],
    );
    expect(match.rows[0]!.status).toBe('completed');
    // Never moving means never diverging: both of them are caught by the same hazard at the same
    // game-time instant, so this is a draw — no winner, and identical survived-ms on both sides.
    expect(match.rows[0]!.winner_user_id).toBeNull();
    expect(match.rows[0]!.score_a).toBeGreaterThan(0);
    expect(match.rows[0]!.score_a).toBe(match.rows[0]!.score_b);

    const lifetime = await ctx.pool.query<{
      total_games: number;
      competitive_games: number;
      draws: number;
    }>(
      `select total_games, competitive_games, draws
         from public.lifetime_statistics where couple_id = $1`,
      [ctx.coupleId],
    );
    expect(lifetime.rows[0]!.total_games).toBe(1);
    expect(lifetime.rows[0]!.competitive_games).toBe(1);
    expect(lifetime.rows[0]!.draws).toBe(1);

    const stats = await ctx.pool.query<{
      plays: number;
      user_a_best_score: number | null;
      user_b_best_score: number | null;
    }>(
      `select cgs.plays, cgs.user_a_best_score, cgs.user_b_best_score
         from public.couple_game_stats cgs join public.games g on g.id = cgs.game_id
        where cgs.couple_id = $1 and g.slug = 'reflex'`,
      [ctx.coupleId],
    );
    expect(stats.rows[0]!.plays).toBe(1);
    // The duration score itself — game-time milliseconds survived — reaching the couple's
    // best-score columns, not merely a play count.
    expect(stats.rows[0]!.user_a_best_score).toBe(match.rows[0]!.score_a);
    expect(stats.rows[0]!.user_b_best_score).toBe(match.rows[0]!.score_b);
  });
});
