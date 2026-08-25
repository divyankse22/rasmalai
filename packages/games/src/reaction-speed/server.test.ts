import { describe, expect, it } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import type { GameContext, PlayerIndex, Transition } from '../contract';
import {
  ARM_MAX_MS,
  ARM_MIN_MS,
  BREATHER_MS,
  MAX_COMPENSATION_MS,
  ROUNDS,
  TAP_TIMEOUT_MS,
} from './protocol';
import { rules, type ReactionSpeedState } from './server';

/**
 * The rules are pure, so an entire match can be played out here at exact millisecond timings with
 * no timers, no sockets and no waiting. That is the whole reason they were written this way: the
 * fairness of this game lives in arithmetic, and arithmetic is testable.
 */

/** Halfway through the arming window, so every round goes live at a known moment. */
const context: GameContext = { random: () => 0.5 };
const ARM_MS = ARM_MIN_MS + 0.5 * (ARM_MAX_MS - ARM_MIN_MS);

const ALICE: PlayerIndex = 0;
const BOB: PlayerIndex = 1;

function tap(
  state: ReactionSpeedState,
  player: PlayerIndex,
  receivedAt: number,
  compensationMs = 0,
  round = state.round.number,
): Transition<ReactionSpeedState> {
  const validation = rules.validateAction(state, player, { type: 'tap', round });
  if (!validation.ok) throw new Error(`refused: ${validation.code}`);
  return rules.applyAction(state, player, validation.action, { receivedAt, compensationMs }, context);
}

/** Advances a freshly armed round to the moment it goes live. */
function goLive(state: ReactionSpeedState, armedAt: number) {
  const at = armedAt + ARM_MS;
  return { at, ...rules.tick(state, at, context) };
}

/** Plays one whole round: arm, go live, both tap, then the breather into the next one. */
function playRound(
  state: ReactionSpeedState,
  armedAt: number,
  aliceMs: number | null,
  bobMs: number | null,
): { state: ReactionSpeedState; armedAt: number } {
  const live = goLive(state, armedAt);
  let next = live.state;
  const startedAt = live.at;

  const order: [PlayerIndex, number][] = [];
  if (aliceMs !== null) order.push([ALICE, startedAt + aliceMs]);
  if (bobMs !== null) order.push([BOB, startedAt + bobMs]);
  order.sort((a, b) => a[1] - b[1]);

  for (const [player, at] of order) next = tap(next, player, at).state;

  // Nobody tapped, or only one did: the round has to time out on its own.
  if (next.round.phase !== 'over') {
    next = rules.tick(next, startedAt + TAP_TIMEOUT_MS, context).state;
  }

  if (next.complete) return { state: next, armedAt: startedAt };

  const resumeAt = next.round.nextRoundAt ?? startedAt;
  return { state: rules.tick(next, resumeAt, context).state, armedAt: resumeAt };
}

const types = (transition: Transition<ReactionSpeedState>) =>
  transition.events.map((event) => event.type);

describe('arming a round', () => {
  it('waits somewhere inside the window before going live', () => {
    const earliest = rules.createMatch(0, { random: () => 0 });
    const latest = rules.createMatch(0, { random: () => 0.999 });

    expect(rules.nextTickAt(earliest)).toBe(ARM_MIN_MS);
    expect(rules.nextTickAt(latest)).toBeLessThan(ARM_MAX_MS);
    expect(rules.nextTickAt(latest)).toBeGreaterThan(ARM_MIN_MS);
  });

  it('tells nobody anything until the wait is over', () => {
    const state = rules.createMatch(0, context);
    const early = rules.tick(state, ARM_MS - 1, context);

    expect(early.events).toEqual([]);
    // Unchanged by reference, which is how the platform knows not to re-arm its timer.
    expect(early.state).toBe(state);
    expect(rules.getView(state, ALICE).current.startedAt).toBeNull();
  });

  it('goes live at the deadline, and tells both of them at once', () => {
    const state = rules.createMatch(0, context);
    const live = rules.tick(state, ARM_MS, context);

    expect(types(live)).toEqual([EVENTS.game.roundStarted]);
    // No `to`, so both players get the same frame.
    expect(live.events[0]?.to).toBeUndefined();
    expect(rules.getView(live.state, ALICE).current.startedAt).toBe(ARM_MS);
  });
});

describe('timing a tap', () => {
  it('measures from the moment the round went live, on the server clock', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const after = tap(live, ALICE, ARM_MS + 214).state;

    expect(rules.getView(after, ALICE).current.yourReactionMs).toBe(214);
  });

  it('forgives the wire, up to the cap', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const after = tap(live, ALICE, ARM_MS + 300, 90).state;

    expect(rules.getView(after, ALICE).current.yourReactionMs).toBe(210);
  });

  it('refuses to forgive more than the cap, however bad the connection', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const after = tap(live, ALICE, ARM_MS + 600, 5_000).state;

    expect(rules.getView(after, ALICE).current.yourReactionMs).toBe(600 - MAX_COMPENSATION_MS);
  });

  it('never invents a reaction faster than the signal', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    // A tap that arrives 20ms after the signal, from a socket the server thinks is 150ms away.
    const after = tap(live, ALICE, ARM_MS + 20, 150).state;

    expect(rules.getView(after, ALICE).current.yourReactionMs).toBe(0);
  });
});

describe('who wins a round', () => {
  it('the faster thumb', () => {
    const { state } = playRound(rules.createMatch(0, context), 0, 200, 260);
    expect(state.roundsWon).toEqual([1, 0]);
  });

  it('an exact tie is nobody', () => {
    const { state } = playRound(rules.createMatch(0, context), 0, 250, 250);
    expect(state.roundsWon).toEqual([0, 0]);
    expect(state.history[0]?.ending).toBe('tapped');
  });

  it('the one who tapped, when the other never does', () => {
    const { state } = playRound(rules.createMatch(0, context), 0, null, 900);
    expect(state.roundsWon).toEqual([0, 1]);
  });

  it('nobody, when neither of them moves', () => {
    const { state } = playRound(rules.createMatch(0, context), 0, null, null);
    expect(state.roundsWon).toEqual([0, 0]);
    expect(state.history[0]?.ending).toBe('nobody-tapped');
  });

  it('flinching early loses the round on the spot', () => {
    const armed = rules.createMatch(0, context);
    const flinch = tap(armed, ALICE, ARM_MS - 500);

    expect(types(flinch)).toEqual([EVENTS.game.roundEnded]);
    expect(flinch.state.roundsWon).toEqual([0, 1]);
    expect(flinch.state.history[0]?.ending).toBe('false-start');
    // And the round is over, so the other player is not left tapping into a decided result.
    expect(flinch.state.round.phase).toBe('over');
  });
});

describe('what each player is allowed to see', () => {
  it('shows you your own time the moment you tap', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const after = tap(live, ALICE, ARM_MS + 180).state;

    expect(rules.getView(after, ALICE).current.yourReactionMs).toBe(180);
    expect(rules.getView(after, ALICE).youTapped).toBe(true);
  });

  it('hides your partner’s tap until the round is over', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const after = tap(live, ALICE, ARM_MS + 180).state;

    const theirs = rules.getView(after, BOB);
    expect(theirs.current.theirReactionMs).toBeNull();
    expect(theirs.youTapped).toBe(false);
  });

  it('tells only the tapper that their tap landed', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const after = tap(live, ALICE, ARM_MS + 180);

    expect(after.events).toEqual([{ type: EVENTS.game.stateUpdated, to: ALICE }]);
  });

  it('reveals both times once the round has ended', () => {
    const { state } = playRound(rules.createMatch(0, context), 0, 200, 260);
    const finished = state.history[0];

    expect(finished?.number).toBe(1);
    expect(rules.getView(state, ALICE).history[0]?.theirReactionMs).toBe(260);
    expect(rules.getView(state, BOB).history[0]?.theirReactionMs).toBe(200);
    expect(rules.getView(state, ALICE).history[0]?.outcome).toBe('won');
    expect(rules.getView(state, BOB).history[0]?.outcome).toBe('lost');
  });
});

describe('refusing an action', () => {
  it('refuses a tap carrying a round that has already gone', () => {
    const { state } = playRound(rules.createMatch(0, context), 0, 200, 260);
    const stale = rules.validateAction(state, ALICE, { type: 'tap', round: 1 });

    expect(stale).toMatchObject({ ok: false, code: 'invalid_action' });
  });

  it('refuses a second tap in the same round', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const after = tap(live, ALICE, ARM_MS + 180).state;

    expect(rules.validateAction(after, ALICE, { type: 'tap', round: 1 })).toMatchObject({
      ok: false,
      code: 'invalid_action',
    });
  });

  it('refuses a tap from someone who already flinched', () => {
    const flinch = tap(rules.createMatch(0, context), ALICE, 100).state;
    expect(rules.validateAction(flinch, ALICE, { type: 'tap', round: 1 })).toMatchObject({
      ok: false,
      code: 'invalid_action',
    });
  });

  it('refuses anything that is not a tap', () => {
    const state = rules.createMatch(0, context);

    expect(rules.validateAction(state, ALICE, null)).toMatchObject({ ok: false });
    expect(rules.validateAction(state, ALICE, { type: 'shove' })).toMatchObject({ ok: false });
    expect(rules.validateAction(state, ALICE, { type: 'tap' })).toMatchObject({ ok: false });
  });

  it('refuses everything once the match is over', () => {
    let state = rules.createMatch(0, context);
    let armedAt = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      ({ state, armedAt } = playRound(state, armedAt, 200, 300));
    }

    expect(state.complete).toBe(true);
    expect(rules.validateAction(state, ALICE, { type: 'tap', round: ROUNDS })).toMatchObject({
      ok: false,
      code: 'invalid_game_state',
    });
  });

  it('refuses a tap while the game is paused', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const paused = rules.pause(live, ARM_MS + 100);

    expect(rules.validateAction(paused, ALICE, { type: 'tap', round: 1 })).toMatchObject({
      ok: false,
      code: 'invalid_game_state',
    });
  });
});

describe('finishing', () => {
  it('plays every round, then hands back rounds won as the score', () => {
    let state = rules.createMatch(0, context);
    let armedAt = 0;

    // Alice takes the first three, Bob the last two.
    for (const [alice, bob] of [
      [200, 300],
      [200, 300],
      [200, 300],
      [400, 300],
      [400, 300],
    ] as const) {
      ({ state, armedAt } = playRound(state, armedAt, alice, bob));
    }

    expect(state.complete).toBe(true);
    expect(rules.isComplete(state)).toBe(true);
    expect(rules.getResult(state)).toEqual({ winner: ALICE, draw: false, scores: [3, 2] });
    // Nothing left for the platform's timer to do.
    expect(rules.nextTickAt(state)).toBeNull();
  });

  it('announces the end alongside the last round', () => {
    let state = rules.createMatch(0, context);
    let armedAt = 0;
    for (let round = 0; round < ROUNDS - 1; round += 1) {
      ({ state, armedAt } = playRound(state, armedAt, 200, 300));
    }

    const live = goLive(state, armedAt);
    const last = tap(tap(live.state, ALICE, live.at + 200).state, BOB, live.at + 300);

    expect(types(last)).toEqual([EVENTS.game.roundEnded, EVENTS.game.finished]);
  });

  it('is a draw when the rounds are shared evenly', () => {
    let state = rules.createMatch(0, context);
    let armedAt = 0;

    for (const [alice, bob] of [
      [200, 300],
      [300, 200],
      [200, 300],
      [300, 200],
      // A dead heat leaves it two apiece.
      [250, 250],
    ] as const) {
      ({ state, armedAt } = playRound(state, armedAt, alice, bob));
    }

    expect(rules.getResult(state)).toEqual({ winner: null, draw: true, scores: [2, 2] });
  });

  it('holds the last round on screen instead of arming a sixth', () => {
    let state = rules.createMatch(0, context);
    let armedAt = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      ({ state, armedAt } = playRound(state, armedAt, 200, 300));
    }

    expect(state.round.number).toBe(ROUNDS);
    expect(state.round.nextRoundAt).toBeNull();
    expect(rules.getView(state, ALICE).history).toHaveLength(ROUNDS);
  });
});

describe('pausing for a missing player', () => {
  it('throws away the round nobody could see, and stops the clock', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const tapped = tap(live, ALICE, ARM_MS + 150).state;
    const paused = rules.pause(tapped, ARM_MS + 200);

    expect(rules.nextTickAt(paused)).toBeNull();
    expect(paused.round.number).toBe(1);
    expect(paused.round.taps).toEqual([null, null]);
    expect(paused.history).toHaveLength(0);
    expect(rules.getView(paused, ALICE).paused).toBe(true);
  });

  it('re-arms the same round when they come back', () => {
    const live = goLive(rules.createMatch(0, context), 0).state;
    const paused = rules.pause(live, ARM_MS + 200);
    const resumed = rules.resume(paused, 60_000, context);

    expect(resumed.state.round.number).toBe(1);
    expect(resumed.state.paused).toBe(false);
    // A fresh wait, so nobody learned the timing of the round that was interrupted.
    expect(rules.nextTickAt(resumed.state)).toBe(60_000 + ARM_MS);
    expect(types(resumed)).toEqual([EVENTS.game.stateUpdated]);
  });

  it('keeps rounds that were already decided', () => {
    const { state, armedAt } = playRound(rules.createMatch(0, context), 0, 200, 300);
    const paused = rules.pause(goLive(state, armedAt).state, armedAt + ARM_MS + 10);
    const resumed = rules.resume(paused, 60_000, context).state;

    expect(resumed.roundsWon).toEqual([1, 0]);
    expect(resumed.history).toHaveLength(1);
    expect(resumed.round.number).toBe(2);
  });

  it('moves on to the next round if the pause landed on a result', () => {
    // Round one has resolved and the breather is running when the connection drops.
    const live = goLive(rules.createMatch(0, context), 0);
    const decided = tap(tap(live.state, ALICE, live.at + 200).state, BOB, live.at + 300).state;

    expect(decided.round.phase).toBe('over');
    const resumed = rules.resume(rules.pause(decided, live.at + 400), 60_000, context).state;

    expect(resumed.round.number).toBe(2);
    expect(resumed.roundsWon).toEqual([1, 0]);
  });

  it('does nothing to a match that already finished', () => {
    let state = rules.createMatch(0, context);
    let armedAt = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      ({ state, armedAt } = playRound(state, armedAt, 200, 300));
    }

    expect(rules.pause(state, 99_999)).toBe(state);
    expect(rules.resume(state, 99_999, context).state).toBe(state);
  });
});

describe('the clock the platform is asked to keep', () => {
  it('asks for the arming deadline, then the tap deadline, then the breather', () => {
    const armed = rules.createMatch(0, context);
    expect(rules.nextTickAt(armed)).toBe(ARM_MS);

    const live = rules.tick(armed, ARM_MS, context).state;
    expect(rules.nextTickAt(live)).toBe(ARM_MS + TAP_TIMEOUT_MS);

    const decided = tap(tap(live, ALICE, ARM_MS + 200).state, BOB, ARM_MS + 300).state;
    expect(rules.nextTickAt(decided)).toBe(ARM_MS + 300 + BREATHER_MS);
  });

  it('gives up on a round nobody answered', () => {
    const live = rules.tick(rules.createMatch(0, context), ARM_MS, context).state;
    const timedOut = rules.tick(live, ARM_MS + TAP_TIMEOUT_MS, context);

    expect(types(timedOut)).toEqual([EVENTS.game.roundEnded]);
    expect(timedOut.state.history[0]?.ending).toBe('nobody-tapped');
  });
});
