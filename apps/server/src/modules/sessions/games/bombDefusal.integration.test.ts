import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, RECONNECT_WINDOW_MS } from '@rasmalai/shared';
import { BOMB_FUSE_MS, type BombDefusalView } from '@rasmalai/games';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

/**
 * Bomb Defusal through the real registry: real Postgres, the real session registry, and the real
 * `packages/games/src/bomb-defusal` rulebook running underneath it (untouched — this file tests
 * the platform's handling of that rulebook, not the rulebook itself, which already has 30 passing
 * unit tests of its own).
 *
 * What this proves that nothing else does: the asymmetric `getView` fork — one seat holds the
 * bomb, the other holds the manual, and neither holds both — survives the platform's real
 * view-building for both seats; the manual reaches exactly one screen and never the defuser's; the
 * fuse genuinely freezes across a *real* registry disconnect (`pauseOnDisconnect: true`) and comes
 * back with exactly what it had; and a cooperative ending lands in Postgres as played, with no
 * winner and no competitive counter touched (P-3).
 *
 * The task brief guessed the view carries a `fuseMsLeft` field. It does not. Read against
 * `packages/games/src/bomb-defusal/protocol.ts`, `BombDefusalView` carries `explodesAt: number |
 * null` (the epoch ms it goes off, on the server's clock) and `paused: boolean` — there is no
 * "milliseconds left" field on the wire at all. While the fuse burns, a client derives the
 * countdown itself from `explodesAt - now`; while it is frozen, `explodesAt` is null and nothing
 * else on the view names how much was banked (the server-side `fuseLeftMs` on `BombDefusalState`
 * never crosses `getView` — see `server.ts`). So this suite proves the freeze directly, against
 * `paused`/`explodesAt`, and proves "gives it back intact" by comparing the fuse's *remaining*
 * time — `explodesAt - Date.now()`, read from the fake clock immediately after each transition —
 * before the disconnect and after the reconnect. That is a strictly stronger claim than comparing
 * a hypothetical `fuseMsLeft` field would have been, and it is the one the rulebook's own
 * `resume()` doc comment ("exactly what was left, no more and no less") actually promises.
 *
 * This game does run a real clock the platform schedules against (the fuse — `nextTickAt` returns
 * `explodesAt`, unlike Guess My Answer's `null`), so unlike that suite this one really does depend
 * on `sessionRegistry.ts`'s and `matchRunner.ts`'s `now` resolving lazily. Task 3b already fixed
 * that at the source (both default to `() => Date.now()`, not a `Date.now` reference frozen at
 * construction), so plain `Date.now()` is correct throughout and Memory's `vi.getRealSystemTime()`
 * workaround is neither needed nor used here.
 */

const env = integrationEnv();

describe.skipIf(env === null)('bomb defusal, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await ctx.dispose();
  });

  /** Opens a bomb defusal session with both players on the page and both ready, and starts the match. */
  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'bomb-defusal',
      gameName: 'Bomb Defusal',
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

  const bombView = (sessionId: string, userId: string): BombDefusalView =>
    ctx.sessions.viewFor(sessionId, userId).game!.state as BombDefusalView;

  it('gives the two of them different screens', async () => {
    const sessionId = await startMatch();

    const alice = bombView(sessionId, ctx.alice.id);
    const bob = bombView(sessionId, ctx.bob.id);

    expect(JSON.stringify(alice)).not.toBe(JSON.stringify(bob));

    // Not just "different" — specifically the fork the whole game is built on: one of them is the
    // defuser (sees every wire's colour, no manual), the other is the expert (sees no colours yet,
    // a manual). Which one is which is a coin-flip the harness cannot seed, so the test reads the
    // roles from the views themselves rather than assuming an order.
    const [defuser, expert] = alice.role === 'defuser' ? [alice, bob] : [bob, alice];

    expect(defuser.role).toBe('defuser');
    expect(expert.role).toBe('expert');
    expect(defuser.wires).toHaveLength(6);
    expect(defuser.wires.every((wire) => wire.colour !== null)).toBe(true);
    expect(expert.wires.every((wire) => wire.colour === null)).toBe(true);
    expect(defuser.manual).toBeNull();
    expect(expert.manual).not.toBeNull();
  });

  it('never sends the manual to the defuser', async () => {
    const sessionId = await startMatch();

    // The manual's own words, from `MANUAL` in `packages/games/src/bomb-defusal/server.ts` — rule
    // 1's sentence. `MANUAL_TEXT` (what `getView` sends the expert) is the *whole* manual, every
    // rule's text, unconditionally — not just whichever rule the current bomb happens to match — so
    // this exact phrase is on the expert's screen for every bomb the coin-flip could produce.
    const manualPhrase = 'cut the SECOND wire';

    const alice = bombView(sessionId, ctx.alice.id);
    const bob = bombView(sessionId, ctx.bob.id);

    // A sanity check on the test itself, not just the game: exactly one of the two screens has a
    // manual at all. If both did, or neither did, the search below would prove nothing about
    // secrecy — this is what makes the assertion below meaningful rather than accidental.
    expect([alice.manual, bob.manual].filter((manual) => manual !== null)).toHaveLength(1);

    const seen = [JSON.stringify(alice), JSON.stringify(bob)];

    // Exactly one of them is the expert, so the manual's text reaches exactly one screen.
    expect(seen.filter((state) => state.includes(manualPhrase))).toHaveLength(1);

    // And it is specifically the expert's screen, not merely "some" screen — this is the assertion
    // that would fail if the manual ever leaked to both, or leaked to the wrong one.
    const [defuser, expert] = alice.role === 'defuser' ? [alice, bob] : [bob, alice];
    expect(JSON.stringify(expert)).toContain(manualPhrase);
    expect(JSON.stringify(defuser)).not.toContain(manualPhrase);
  });

  it('freezes the fuse across a real disconnect and gives it back intact', async () => {
    const sessionId = await startMatch();

    await vi.advanceTimersByTimeAsync(5_000);

    const beforePause = bombView(sessionId, ctx.alice.id);
    expect(beforePause.paused).toBe(false);
    expect(beforePause.explodesAt).not.toBeNull();
    const remainingBeforePause = beforePause.explodesAt! - Date.now();

    // Bob's last socket closes.
    ctx.online.delete(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, false);

    // The fuse freezes the instant he leaves — both seats agree, immediately, with nothing to wait
    // on. `explodesAt` goes to null rather than merely "not moving", because a paused game telling a
    // client a deadline it is not actually counting down to would be lying to the screen.
    expect(bombView(sessionId, ctx.alice.id).paused).toBe(true);
    expect(bombView(sessionId, ctx.alice.id).explodesAt).toBeNull();
    expect(bombView(sessionId, ctx.bob.id).paused).toBe(true);
    expect(bombView(sessionId, ctx.bob.id).explodesAt).toBeNull();

    // Half the reconnect window passes with nobody able to play. A burning fuse would have eaten
    // into it; a frozen one has nothing to show but the same frozen state.
    await vi.advanceTimersByTimeAsync(RECONNECT_WINDOW_MS / 2);
    expect(bombView(sessionId, ctx.alice.id).paused).toBe(true);
    expect(bombView(sessionId, ctx.alice.id).explodesAt).toBeNull();

    ctx.online.add(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, true);
    ctx.sessions.join(sessionId, ctx.bob.id);

    const afterResume = bombView(sessionId, ctx.bob.id);
    expect(afterResume.paused).toBe(false);
    expect(afterResume.explodesAt).not.toBeNull();
    // "Exactly what was left, no more and no less" — the rulebook's own promise for `resume()`. The
    // same number of milliseconds is banked across the whole disconnect, however long it lasted.
    const remainingAfterResume = afterResume.explodesAt! - Date.now();
    expect(remainingAfterResume).toBe(remainingBeforePause);

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('active');
  });

  it('records a cooperative ending as played and nothing more', async () => {
    const sessionId = await startMatch();

    // Let the fuse run all the way out rather than defusing: the bomb going off is a real, legal
    // ending that needs no deterministic wire-cutting to reach, and it is the one this test cares
    // about — the platform's P-3 bookkeeping for a cooperative match, not the rulebook's outcome
    // logic (already covered by the rulebook's own unit tests).
    await vi.advanceTimersByTimeAsync(BOMB_FUSE_MS + 10_000);

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    expect(bombView(sessionId, ctx.alice.id).outcome).toBe('exploded');

    await ctx.recorder.drain();

    const stats = await ctx.pool.query<{
      total_games: number;
      competitive_games: number;
      user_a_wins: number;
      user_b_wins: number;
    }>(
      `select total_games, competitive_games, user_a_wins, user_b_wins
         from public.lifetime_statistics where couple_id = $1`,
      [ctx.coupleId],
    );

    // P-3: played and counted, and counted by nothing else. `games.scoring_kind` for `bomb-defusal`
    // is `cooperative` in the catalogue (`0004_dashboard.sql`) — the platform reads that, not the
    // module's own opinion of itself, which is what this row proves.
    expect(stats.rows[0]!.total_games).toBe(1);
    expect(stats.rows[0]!.competitive_games).toBe(0);
    expect(stats.rows[0]!.user_a_wins).toBe(0);
    expect(stats.rows[0]!.user_b_wins).toBe(0);
  });
});
