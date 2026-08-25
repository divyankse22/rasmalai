import { describe, expect, it } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import type { GameContext, PlayerIndex, Transition } from '../contract';
import {
  GRACE_MS,
  LANES,
  LEAD_IN_MS,
  MAX_COMPENSATION_MS,
  MOVE_COOLDOWN_MS,
  START_LANE,
  WAVES,
  type Wave,
} from './protocol';
import { rules, type ReflexState } from './server';

/**
 * The rules are pure, so a whole run is played out here with no timers, no canvas and no frames.
 *
 * The interesting half of this file is the timing. Everything is measured in **game time**, which
 * stops when somebody drops off, and every hazard is judged from where the player actually was when
 * it landed rather than from where they happened to be when the frame arrived. Both of those are
 * arithmetic, and arithmetic is testable — which is the whole reason the rules never touch a clock.
 */

const context: GameContext = { random: () => 0 };

const ALICE: PlayerIndex = 0;
const BOB: PlayerIndex = 1;

const at = (receivedAt: number, compensationMs = 0) => ({ receivedAt, compensationMs });

/** A run whose hazards we chose, so a test can name the moment it means. */
function run(waves: Wave[], overrides: Partial<ReflexState> = {}): ReflexState {
  return {
    waves,
    judged: 0,
    runners: [
      { steps: [{ at: 0, lane: START_LANE }], lastMoveAt: null, alive: true, diedAt: null },
      { steps: [{ at: 0, lane: START_LANE }], lastMoveAt: null, alive: true, diedAt: null },
    ],
    elapsedMs: 0,
    runningSince: 0,
    complete: false,
    ...overrides,
  };
}

function move(
  state: ReflexState,
  player: PlayerIndex,
  direction: 'left' | 'right',
  receivedAt: number,
  compensationMs = 0,
): Transition<ReflexState> {
  const validation = rules.validateAction(state, player, { type: 'move', direction });
  if (!validation.ok) throw new Error(`refused: ${validation.code} — ${validation.message}`);
  return rules.applyAction(
    state,
    player,
    validation.action,
    at(receivedAt, compensationMs),
    context,
  );
}

const refusal = (state: ReflexState, player: PlayerIndex, action: unknown) => {
  const result = rules.validateAction(state, player, action);
  if (result.ok) throw new Error('expected the move to be refused');
  return result;
};

const types = (transition: Transition<ReflexState>) => transition.events.map((event) => event.type);

/** One hazard, closing everything except `safe`. */
const only = (moment: number, safe: number): Wave => ({
  at: moment,
  blocked: Array.from({ length: LANES }, (_, lane) => lane).filter((lane) => lane !== safe),
});

describe('the run', () => {
  it('is forty-five hazards, getting faster and closing more lanes', () => {
    const state = rules.createMatch(0, { random: () => 0.5 });

    expect(state.waves).toHaveLength(WAVES);
    expect(state.waves[0]!.at).toBe(LEAD_IN_MS);

    const gaps = state.waves.slice(1).map((wave, index) => wave.at - state.waves[index]!.at);
    // Monotonically tightening, never below the floor.
    expect(gaps.every((gap, index) => index === 0 || gap <= gaps[index - 1]!)).toBe(true);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(420);

    expect(state.waves[0]!.blocked).toHaveLength(1);
    expect(state.waves.at(-1)!.blocked).toHaveLength(LANES - 1);
  });

  it('always leaves a way through', () => {
    // A wave nobody can survive is not difficulty. Checked across several seeds rather than one.
    for (const seed of [0, 0.13, 0.5, 0.77, 0.99]) {
      const state = rules.createMatch(0, { random: () => seed });
      for (const wave of state.waves) {
        expect(wave.blocked.length).toBeLessThan(LANES);
        expect(new Set(wave.blocked).size).toBe(wave.blocked.length);
        expect(wave.blocked.every((lane) => lane >= 0 && lane < LANES)).toBe(true);
      }
    }
  });

  it('gives both of them the same hazards and the same starting lane', () => {
    const state = rules.createMatch(0, { random: () => 0.4 });
    const mine = rules.getView(state, ALICE);
    const theirs = rules.getView(state, BOB);

    expect(mine.waves).toEqual(theirs.waves);
    expect(mine.you.lane).toBe(START_LANE);
    expect(theirs.you.lane).toBe(START_LANE);
  });

  it('asks the clock for the next hazard plus its grace, and nothing else', () => {
    const state = run([only(1_000, 0), only(2_000, 0)]);
    expect(rules.nextTickAt(state)).toBe(1_000 + GRACE_MS);
    // Nobody is on the platform's move clock underneath it.
    expect(rules.turnOf(state)).toBeNull();
  });
});

describe('moving', () => {
  it('steps one lane at a time, and stops at the wall', () => {
    let state = run([only(10_000, 0)]);

    state = move(state, ALICE, 'left', 0).state;
    expect(rules.getView(state, ALICE).you.lane).toBe(START_LANE - 1);

    state = move(state, ALICE, 'left', MOVE_COOLDOWN_MS).state;
    expect(rules.getView(state, ALICE).you.lane).toBe(0);

    // Against the wall: nothing happens, and only the player who tried is told.
    const walled = move(state, ALICE, 'left', MOVE_COOLDOWN_MS * 2);
    expect(walled.state).toBe(state);
    expect(walled.events).toEqual([{ type: EVENTS.game.stateUpdated, to: ALICE }]);
  });

  it('ignores a step taken too soon, without shouting about it', () => {
    // The game is played by hammering a key. Answering every third press with a protocol error
    // would fill the socket with noise nobody can act on.
    let state = run([only(10_000, 0)]);
    state = move(state, ALICE, 'left', 0).state;

    const tooSoon = move(state, ALICE, 'left', MOVE_COOLDOWN_MS - 1);
    expect(tooSoon.state).toBe(state);
    expect(types(tooSoon)).toEqual([EVENTS.game.stateUpdated]);
    expect(tooSoon.events[0]!.to).toBe(ALICE);

    // And the one after the cooldown lands.
    expect(rules.getView(move(state, ALICE, 'left', MOVE_COOLDOWN_MS).state, ALICE).you.lane).toBe(
      START_LANE - 2,
    );
  });

  it('tells both of them when somebody actually moves', () => {
    const state = run([only(10_000, 0)]);
    const stepped = move(state, ALICE, 'right', 0);

    expect(stepped.events).toEqual([{ type: EVENTS.game.stateUpdated }]);
    expect(rules.getView(stepped.state, BOB).them.lane).toBe(START_LANE + 1);
  });

  it('refuses anything that is not a step, and refuses a corpse', () => {
    const state = run([only(10_000, 0)]);
    expect(refusal(state, ALICE, { type: 'move', direction: 'up' }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, { type: 'jump' }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, null).code).toBe('invalid_action');

    const dead = run([only(10_000, 0)], {
      runners: [
        { steps: [{ at: 0, lane: 1 }], lastMoveAt: null, alive: false, diedAt: 500 },
        { steps: [{ at: 0, lane: START_LANE }], lastMoveAt: null, alive: true, diedAt: null },
      ],
    });
    expect(refusal(dead, ALICE, { type: 'move', direction: 'left' }).message).toBe(
      'You are out of this one.',
    );
  });
});

describe('judging a hazard', () => {
  it('waits out the grace window before deciding anything', () => {
    const state = run([only(1_000, START_LANE + 1)]);

    // The hazard has landed, but a dodge sent before it may still be in the air.
    expect(rules.tick(state, 1_000, context).state).toBe(state);
    expect(rules.tick(state, 1_000 + GRACE_MS - 1, context).state).toBe(state);

    const judged = rules.tick(state, 1_000 + GRACE_MS, context);
    expect(judged.state.judged).toBe(1);
    expect(judged.state.runners[ALICE].alive).toBe(false);
  });

  it('counts a dodge that was made in time even though its frame arrived late', () => {
    // The whole reason the grace window exists: the player moved at 950, the packet landed at 1080,
    // and the hazard was at 1000. Their thumb beat it; their wifi did not.
    const state = run([only(1_000, START_LANE + 1)]);
    const dodged = move(state, ALICE, 'right', 1_080, MAX_COMPENSATION_MS).state;

    expect(rules.tick(dodged, 1_000 + GRACE_MS, context).state.runners[ALICE].alive).toBe(true);
  });

  it('does not let a late dodge rewrite a hazard that has already been judged', () => {
    const state = run([only(1_000, START_LANE + 1)]);
    const judged = rules.tick(state, 1_000 + GRACE_MS, context).state;
    expect(judged.runners[ALICE].alive).toBe(false);

    // They are out; the move is refused rather than quietly resurrecting them.
    expect(refusal(judged, ALICE, { type: 'move', direction: 'right' }).code).toBe(
      'invalid_game_state',
    );
  });

  it('judges from where they were at the moment it landed, not where they ended up', () => {
    // Safe when the hazard lands, then steps into the closed lane a fraction later. Alive.
    const state = run([only(1_000, 0), only(5_000, 0)]);
    let moving = state;
    // Walk to lane 0 well before the hazard.
    for (let step = 0; step < 2; step += 1) {
      moving = move(moving, ALICE, 'left', step * MOVE_COOLDOWN_MS).state;
    }
    expect(rules.getView(moving, ALICE).you.lane).toBe(0);

    // Then step out of it *after* the hazard's moment but before it is judged.
    moving = move(moving, ALICE, 'right', 1_050).state;
    const judged = rules.tick(moving, 1_000 + GRACE_MS, context);

    expect(judged.state.runners[ALICE].alive).toBe(true);
    expect(rules.getView(judged.state, ALICE).you.lane).toBe(1);
  });

  it('resolves everything a late tick slept through', () => {
    const state = run([only(1_000, 0), only(2_000, 0), only(3_000, 0)]);
    // One tick, arriving after all three. Nothing is skipped.
    const judged = rules.tick(state, 10_000, context);

    expect(judged.state.judged).toBe(1);
    // …and it stops the moment both of them are out, rather than judging hazards nobody is left
    // standing in front of.
    expect(judged.state.complete).toBe(true);
    expect(judged.state.runners[ALICE].diedAt).toBe(1_000);
    expect(judged.state.runners[BOB].diedAt).toBe(1_000);
  });

  it('says nothing when a hazard catches nobody', () => {
    // The clients are already drawing it exactly where the schedule said it would be.
    const state = run([only(1_000, START_LANE), only(9_000, 0)]);
    const judged = rules.tick(state, 1_000 + GRACE_MS, context);

    expect(judged.state.judged).toBe(1);
    expect(judged.events).toEqual([]);
  });

  it('prunes the trail as hazards are settled', () => {
    // Left, right, left, right — ending back on the lane the hazard leaves open.
    let state = run([only(5_000, START_LANE), only(9_000, START_LANE)]);
    const directions = ['left', 'right', 'left', 'right'] as const;
    directions.forEach((direction, step) => {
      state = move(state, ALICE, direction, step * MOVE_COOLDOWN_MS).state;
    });

    expect(state.runners[ALICE].steps).toHaveLength(directions.length + 1);
    expect(rules.getView(state, ALICE).you.lane).toBe(START_LANE);

    const judged = rules.tick(state, 5_000 + GRACE_MS, context);
    expect(judged.state.runners[ALICE].alive).toBe(true);
    // One step left: where they are standing. A thirty-second run of keypresses does not accumulate.
    expect(judged.state.runners[ALICE].steps).toEqual([{ at: 5_000, lane: START_LANE }]);
    // …and the cooldown is not reset by the tidy-up.
    expect(judged.state.runners[ALICE].lastMoveAt).toBe(MOVE_COOLDOWN_MS * 3);
  });
});

describe('how it ends', () => {
  it('ends when the second one is caught, and gives it to whoever lasted longer', () => {
    const state = run([only(1_000, 1), only(2_000, 2)]);
    // Alice steps into lane 1 and survives the first; Bob stays in the middle and does not.
    const moved = move(state, ALICE, 'left', 0).state;

    const first = rules.tick(moved, 1_000 + GRACE_MS, context);
    expect(first.state.runners[BOB].alive).toBe(false);
    expect(first.state.runners[ALICE].alive).toBe(true);
    expect(first.state.complete).toBe(false);
    expect(types(first)).toEqual([EVENTS.game.stateUpdated]);

    const second = rules.tick(first.state, 2_000 + GRACE_MS, context);
    expect(second.state.complete).toBe(true);
    expect(types(second)).toEqual([EVENTS.game.stateUpdated, EVENTS.game.finished]);

    expect(rules.getResult(second.state)).toEqual({
      winner: ALICE,
      draw: false,
      scores: [2_000, 1_000],
    });
    expect(rules.getView(second.state, ALICE).outcome).toBe('won');
    expect(rules.getView(second.state, BOB).outcome).toBe('lost');
  });

  it('calls it a draw when the same hazard takes both of them', () => {
    const state = run([only(1_000, 0)]);
    const done = rules.tick(state, 1_000 + GRACE_MS, context);

    expect(done.state.complete).toBe(true);
    expect(rules.getResult(done.state)).toEqual({
      winner: null,
      draw: true,
      scores: [1_000, 1_000],
    });
    expect(rules.getView(done.state, ALICE).outcome).toBe('drawn');
    expect(rules.getView(done.state, BOB).outcome).toBe('drawn');
  });

  it('ends the run when the last hazard has gone, with survivors on full time', () => {
    const state = run([only(1_000, START_LANE), only(2_000, START_LANE)]);
    const done = rules.tick(state, 2_000 + GRACE_MS, context);

    expect(done.state.complete).toBe(true);
    expect(rules.getResult(done.state)).toEqual({
      winner: null,
      draw: true,
      scores: [2_000, 2_000],
    });
    expect(rules.nextTickAt(done.state)).toBeNull();
    expect(refusal(done.state, ALICE, { type: 'move', direction: 'left' }).code).toBe(
      'invalid_game_state',
    );
  });

  it('scores in milliseconds survived, and spells them as seconds', () => {
    expect(rules.meta.formatScore?.(28_640)).toBe('28.6s');
    expect(rules.meta.formatScore?.(2_500)).toBe('2.5s');
  });
});

describe('somebody drops mid-run', () => {
  it('stops the clock rather than letting hazards land on an empty screen', () => {
    const state = run([only(5_000, 0)], { runningSince: 1_000 });
    const paused = rules.pause(state, 3_000);

    expect(paused.runningSince).toBeNull();
    expect(paused.elapsedMs).toBe(2_000);
    expect(rules.nextTickAt(paused)).toBeNull();
    expect(rules.tick(paused, 9_999_999, context).state).toBe(paused);
    expect(refusal(paused, ALICE, { type: 'move', direction: 'left' }).code).toBe(
      'invalid_game_state',
    );

    const view = rules.getView(paused, ALICE);
    expect(view.paused).toBe(true);
    // No origin while no clock is running: there is nowhere for the renderer to place a hazard.
    expect(view.originAt).toBeNull();
    expect(view.elapsedMs).toBe(2_000);
  });

  it('picks the run up mid-air where it stopped', () => {
    const state = run([only(5_000, 0)], { runningSince: 1_000 });
    const back = rules.resume(rules.pause(state, 3_000), 500_000, context);

    expect(back.state.runningSince).toBe(500_000);
    expect(back.state.elapsedMs).toBe(2_000);
    expect(types(back)).toEqual([EVENTS.game.stateUpdated]);

    // Three seconds of the run were left, so the hazard is three seconds away again — not five,
    // and not overdue.
    expect(rules.nextTickAt(back.state)).toBe(500_000 + 3_000 + GRACE_MS);
    expect(rules.getView(back.state, ALICE).originAt).toBe(498_000);

    // And it still resolves normally from there.
    expect(rules.tick(back.state, 500_000 + 3_000 + GRACE_MS, context).state.judged).toBe(1);
  });

  it('keeps both trails, so nobody is teleported by their own wifi', () => {
    let state = run([only(9_000, 0)]);
    state = move(state, ALICE, 'left', 0).state;
    const back = rules.resume(rules.pause(state, 1_000), 60_000, context).state;

    expect(rules.getView(back, ALICE).you.lane).toBe(START_LANE - 1);
  });
});
