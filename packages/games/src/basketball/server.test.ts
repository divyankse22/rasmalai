import { describe, expect, it } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import type { GameContext, PlayerIndex, Transition } from '../contract';
import {
  GRAVITY,
  HOOP_CENTRE_X,
  HOOP_PERIOD_FIRST_MS,
  LEVELS,
  MAKE_TOLERANCE,
  MAX_ANGLE_DEG,
  MAX_SPEED,
  MIN_ANGLE_DEG,
  MIN_SPEED,
  RELEASE_X,
  RELEASE_Y,
  RIM_Y,
  ROUNDS_PER_LEVEL,
  SETTLE_MS,
  SHOT_CLOCK_MS,
  THREE_POINT_DISTANCE,
  TOTAL_ROUNDS,
  TOTAL_SHOTS,
  computeBallPath,
  hoopXAt,
  launchOf,
  pathDurationMs,
  positionAlongPath,
  timeToRim,
  type HoopMotion,
} from './protocol';
import { rules, type BasketballState } from './server';

/**
 * The rules are pure, so twenty shots across two levels are played out here with no canvas, no
 * sockets and no ball on screen. Everything this game can be got wrong about — who shoots, where the
 * hoop was when the ball arrived, what a make is worth, what a dropped connection costs — is
 * arithmetic.
 *
 * The tests aim properly rather than asserting against magic numbers: `aimToMake` inverts the same
 * trajectory the rules integrate and solves for the hoop's position *on arrival*, which is the only
 * honest way to ask "does a good shot go in" of a game whose target is moving.
 */

const ALICE: PlayerIndex = 0;
const BOB: PlayerIndex = 1;

/** Reproducible pseudo-randomness, so a whole match replays identically. */
function seeded(seed: number): GameContext {
  let state = seed >>> 0;
  return {
    random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** The coin flip first, then everything else from the sequence. */
function startingWith(first: number, seed = 7): GameContext {
  const rest = seeded(seed);
  let spent = false;
  return {
    random() {
      if (spent) return rest.random();
      spent = true;
      return first;
    },
  };
}

const context = seeded(1);
const aliceFirst = () => rules.createMatch(0, startingWith(0.1));
const bobFirst = () => rules.createMatch(0, startingWith(0.9));

/**
 * The strength of throw that puts the ball through rim height exactly `distance` away at `angle`.
 *
 * The inverse of the trajectory the rules integrate, from the standard form
 * `rise = d·tanθ − g·d² / (2v²cos²θ)`. Returns null for an angle too shallow to ever get there.
 */
function powerToReach(distance: number, angleDeg: number): number | null {
  const radians = (angleDeg * Math.PI) / 180;
  const rise = RIM_Y - RELEASE_Y;
  const climb = distance * Math.tan(radians) - rise;
  if (climb <= 0) return null;

  const speed = Math.sqrt((GRAVITY * distance * distance) / (2 * Math.cos(radians) ** 2 * climb));
  const power = (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  return power >= 0 && power <= 1 ? power : null;
}

/**
 * An aim that goes in, allowing for the hoop drifting while the ball is in the air.
 *
 * Aiming at where the hoop is *now* misses by however far it moves during the flight, so this
 * iterates to the fixed point: aim, work out when the ball would arrive, look at where the hoop will
 * be then, aim again. Four passes is far more than it needs.
 */
function aimToMake(
  hoop: HoopMotion,
  releasedAtMs: number,
  angleDeg = 55,
): { type: 'shoot'; shot: number; angle: number; power: number } {
  let target = hoopXAt(hoop, releasedAtMs);
  let power = powerToReach(target, angleDeg) ?? 1;

  for (let pass = 0; pass < 4; pass += 1) {
    const seconds = timeToRim(launchOf(angleDeg, power));
    if (seconds === null) break;
    target = hoopXAt(hoop, releasedAtMs + seconds * 1000);
    power = powerToReach(target, angleDeg) ?? power;
  }

  return { type: 'shoot', shot: 0, angle: angleDeg, power };
}

function shoot(
  state: BasketballState,
  player: PlayerIndex,
  action: unknown,
  receivedAt: number,
  compensationMs = 0,
): Transition<BasketballState> {
  const validation = rules.validateAction(state, player, action);
  if (!validation.ok) throw new Error(`refused: ${validation.code} — ${validation.message}`);
  return rules.applyAction(state, player, validation.action, { receivedAt, compensationMs }, context);
}

/** Takes the open shot, aiming to score, and runs the clock on to the next one. */
function scoreAndAdvance(state: BasketballState, waitMs = 500): BasketballState {
  const aim = { ...aimToMake(state.hoop, waitMs), shot: state.shotNumber };
  const shooter = rules.turnOf(state);
  if (shooter === null) throw new Error('nobody is on the shot');

  const taken = shoot(state, shooter, aim, state.shotStartedAt + waitMs).state;
  return rules.tick(taken, taken.watchUntil ?? 0, context).state;
}

/** Lets the shot clock run out, and runs on to the next shot. */
function skipAndAdvance(state: BasketballState): BasketballState {
  const timedOut = rules.tick(state, state.shotDeadline, context).state;
  return rules.tick(timedOut, timedOut.watchUntil ?? 0, context).state;
}

const refusal = (state: BasketballState, player: PlayerIndex, action: unknown) => {
  const result = rules.validateAction(state, player, action);
  if (result.ok) throw new Error('expected the shot to be refused');
  return result;
};

const types = (transition: Transition<BasketballState>) =>
  transition.events.map((event) => event.type);

describe('a new match', () => {
  it('opens with a shot clock running and a hoop standing dead still', () => {
    const state = aliceFirst();
    const view = rules.getView(state, ALICE);

    expect(view.levels).toBe(LEVELS);
    expect(view.level).toBe(1);
    expect(view.roundsPerLevel).toBe(ROUNDS_PER_LEVEL);
    expect(view.roundInLevel).toBe(1);
    expect(view.shotNumber).toBe(1);
    expect(view.phase).toBe('aiming');
    expect(view.shotDeadline).toBe(state.shotStartedAt + SHOT_CLOCK_MS);
    expect(view.watchUntil).toBeNull();
    // Level one is the still hoop: nothing moves until level two.
    expect(view.hoop.amplitude).toBe(0);
    expect(view.yourScore).toBe(0);
    expect(view.theirScore).toBe(0);
    expect(view.history).toEqual([]);
    expect(view.complete).toBe(false);
  });

  it('coin-flips who shoots first, and tells both of them the same story about it', () => {
    expect(rules.turnOf(aliceFirst())).toBe(ALICE);
    expect(rules.turnOf(bobFirst())).toBe(BOB);

    const state = aliceFirst();
    expect(rules.getView(state, ALICE).yourTurn).toBe(true);
    expect(rules.getView(state, BOB).yourTurn).toBe(false);
  });

  it('asks the platform for a clock, unlike a purely turn-based game', () => {
    const state = aliceFirst();
    expect(rules.nextTickAt(state)).toBe(state.shotStartedAt + SHOT_CLOCK_MS);
  });
});

describe('whose shot it is', () => {
  it('snakes, so each of them shoots second in half the rounds', () => {
    let state = aliceFirst();
    const order: PlayerIndex[] = [];

    for (let shot = 0; shot < TOTAL_SHOTS; shot += 1) {
      const shooter = rules.turnOf(state);
      if (shooter === null) throw new Error('nobody is on the shot');
      order.push(shooter);
      state = skipAndAdvance(state);
    }

    expect(order).toEqual([
      ALICE, BOB, BOB, ALICE, ALICE, BOB, BOB, ALICE, ALICE, BOB,
      BOB, ALICE, ALICE, BOB, BOB, ALICE, ALICE, BOB, BOB, ALICE,
    ]);
  });

  it('gives each of them one shot in every round of both levels', () => {
    let state = aliceFirst();
    const byRound = new Map<number, PlayerIndex[]>();

    for (let shot = 0; shot < TOTAL_SHOTS; shot += 1) {
      const round = Math.ceil(state.shotNumber / 2);
      const shooter = rules.turnOf(state);
      if (shooter === null) throw new Error('nobody is on the shot');
      byRound.set(round, [...(byRound.get(round) ?? []), shooter]);
      state = skipAndAdvance(state);
    }

    expect(byRound.size).toBe(TOTAL_ROUNDS);
    for (const shooters of byRound.values()) {
      expect([...shooters].sort()).toEqual([ALICE, BOB]);
    }
  });

  it('names the shooter while a shot is open and nobody while the ball is in the air', () => {
    const state = aliceFirst();
    expect(rules.turnOf(state)).toBe(ALICE);

    const taken = shoot(state, ALICE, { ...aimToMake(state.hoop, 0), shot: 1 }, state.shotStartedAt)
      .state;

    expect(taken.phase).toBe('watching');
    expect(rules.turnOf(taken)).toBeNull();
  });
});

describe('the hoop', () => {
  /** Every shot of level one, skipped, landing exactly on level two's opening shot. */
  function toLevelTwo(state: BasketballState): BasketballState {
    let next = state;
    for (let shot = 0; shot < ROUNDS_PER_LEVEL * 2; shot += 1) next = skipAndAdvance(next);
    return next;
  }

  it('stands dead still through the whole of level one', () => {
    let state = aliceFirst();

    for (let shot = 0; shot < ROUNDS_PER_LEVEL * 2; shot += 1) {
      expect(rules.getView(state, ALICE).level).toBe(1);
      expect(state.hoop).toEqual({ amplitude: 0, periodMs: HOOP_PERIOD_FIRST_MS, phase: 0 });
      state = skipAndAdvance(state);
    }
  });

  it('starts drifting the moment level two opens', () => {
    const state = toLevelTwo(aliceFirst());

    expect(rules.getView(state, ALICE).level).toBe(2);
    expect(rules.getView(state, ALICE).roundInLevel).toBe(1);
    expect(state.hoop.amplitude).toBeGreaterThan(0);
    expect(state.hoop.periodMs).toBeGreaterThan(0);
  });

  it('is rolled once a round, so both shots of a round face the same problem', () => {
    const firstOfRound = toLevelTwo(aliceFirst());
    const secondShot = skipAndAdvance(firstOfRound);
    const nextRound = skipAndAdvance(secondShot);

    expect(secondShot.hoop).toEqual(firstOfRound.hoop);
    expect(nextRound.hoop).not.toEqual(firstOfRound.hoop);
  });

  it('is measured from each shot’s own opening, so the second shooter inherits nothing', () => {
    const first = toLevelTwo(aliceFirst());
    const secondShot = skipAndAdvance(first);

    // Same motion, and each of them meets it at the same point in its cycle.
    expect(hoopXAt(secondShot.hoop, 0)).toBeCloseTo(hoopXAt(first.hoop, 0), 10);
    expect(hoopXAt(secondShot.hoop, 3_000)).toBeCloseTo(hoopXAt(first.hoop, 3_000), 10);
  });

  it('gets wilder across level two’s own five rounds, starting from scratch rather than from level one', () => {
    const levelTwoOpens = toLevelTwo(aliceFirst());
    let state = levelTwoOpens;
    // Four rounds on, to level two's own round five — two shots per round in between.
    for (let shot = 0; shot < (ROUNDS_PER_LEVEL - 1) * 2; shot += 1) state = skipAndAdvance(state);

    expect(rules.getView(state, ALICE).roundInLevel).toBe(ROUNDS_PER_LEVEL);
    expect(state.hoop.amplitude).toBeGreaterThan(levelTwoOpens.hoop.amplitude);
    expect(state.hoop.periodMs).toBeLessThan(levelTwoOpens.hoop.periodMs);
  });

  it('stays inside the court, at its widest', () => {
    let state = aliceFirst();

    for (let shot = 0; shot < TOTAL_SHOTS; shot += 1) {
      for (let ms = 0; ms <= SHOT_CLOCK_MS; ms += 100) {
        const x = hoopXAt(state.hoop, ms);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(10);
      }
      state = skipAndAdvance(state);
    }
  });
});

describe('bouncing off anything that is not the hole', () => {
  const still: HoopMotion = { amplitude: 0, periodMs: 4_000, phase: 0 };

  it('leaves a clean airball alone — one segment, straight to the floor', () => {
    // Short and weak: nowhere near the hoop at any point in its arc.
    const path = computeBallPath(launchOf(MIN_ANGLE_DEG, 0.05), 0, still);

    expect(path).toHaveLength(1);
    expect(path[0]?.fromX).toBe(RELEASE_X);
    expect(path[0]?.fromY).toBe(RELEASE_Y);
  });

  it('bounces off the rim when a shot clips just outside the make tolerance', () => {
    const angle = 55;
    // Just past the tolerance, and well short of the backboard's own plane (`BACKBOARD_X_OFFSET`)
    // — the point of this shot is a rim clip specifically, not a longer shot reaching the board.
    const target = HOOP_CENTRE_X + MAKE_TOLERANCE + 0.05;
    const power = powerToReach(target, angle);
    if (power === null) throw new Error('test setup: no power reaches that far at this angle');

    const path = computeBallPath(launchOf(angle, power), 0, still);

    expect(path.length).toBeGreaterThan(1);
    expect(path[1]?.fromY).toBeCloseTo(RIM_Y, 5);
  });

  it('never bounces more than twice, and always ends at the floor, for any legal throw', () => {
    // A hoop that is actually moving, so the collision arithmetic has to chase a moving target too.
    const drifting: HoopMotion = { amplitude: 1.6, periodMs: 3_000, phase: 0.7 };

    for (let angle = MIN_ANGLE_DEG; angle <= MAX_ANGLE_DEG; angle += 7) {
      for (let power = 0; power <= 1; power += 0.15) {
        const path = computeBallPath(launchOf(angle, power), 0, drifting);
        expect(path.length).toBeLessThanOrEqual(3);

        const last = path[path.length - 1]!;
        const rest = positionAlongPath(path, last.startMs + last.durationMs);
        expect(rest.y).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('is a pure function of its inputs — the same shot walks the same path every time', () => {
    const hoop: HoopMotion = { amplitude: 1.1, periodMs: 3_200, phase: 1.4 };
    const launch = launchOf(48, 0.72);

    expect(computeBallPath(launch, 137, hoop)).toEqual(computeBallPath(launch, 137, hoop));
  });

  it('never turns a miss into a make: `applyAction` waits for it, but never asks it what happened', () => {
    const state = aliceFirst();
    const good = aimToMake(state.hoop, 0);
    const missAim = { ...good, shot: 1, power: Math.max(0, good.power - 0.25) };
    const taken = shoot(state, ALICE, missAim, state.shotStartedAt).state;

    expect(taken.last?.outcome).toBe('missed');

    // The server's own timing for the watching beat is measured off exactly this path — proof the
    // two are actually wired together, not just individually correct.
    const launch = launchOf(missAim.angle, missAim.power);
    const expectedPath = computeBallPath(launch, taken.last!.releasedAtMs!, state.hoop);
    expect(taken.last?.flightMs).toBe(pathDurationMs(expectedPath, taken.last!.releasedAtMs!));
  });
});

describe('a shot', () => {
  it('goes in when it is aimed where the hoop will be', () => {
    const state = aliceFirst();
    const taken = shoot(
      state,
      ALICE,
      { ...aimToMake(state.hoop, 400), shot: 1 },
      state.shotStartedAt + 400,
    ).state;

    expect(taken.last?.outcome).toBe('made');
    expect(taken.last?.points).toBeGreaterThan(0);
    expect(taken.scores[ALICE]).toBe(taken.last?.points);
    expect(taken.scores[BOB]).toBe(0);
  });

  it('misses when it is thrown at the wrong strength, and says where it landed', () => {
    const state = aliceFirst();
    const good = aimToMake(state.hoop, 0);
    const taken = shoot(
      state,
      ALICE,
      { ...good, shot: 1, power: Math.max(0, good.power - 0.25) },
      state.shotStartedAt,
    ).state;

    expect(taken.last?.outcome).toBe('missed');
    expect(taken.last?.points).toBe(0);
    expect(taken.last?.landingX).not.toBeNull();
    expect(Math.abs((taken.last?.landingX ?? 0) - (taken.last?.hoopXAtArrival ?? 0))).toBeGreaterThan(
      MAKE_TOLERANCE,
    );
    expect(taken.scores).toEqual([0, 0]);
  });

  it('misses when it never gets as high as the rim, and still says where the hoop was', () => {
    const state = aliceFirst();
    const taken = shoot(
      state,
      ALICE,
      { type: 'shoot', shot: 1, angle: MIN_ANGLE_DEG, power: 0 },
      state.shotStartedAt,
    ).state;

    expect(taken.last?.outcome).toBe('missed');
    expect(taken.last?.landingX).toBeNull();
    expect(taken.last?.hoopXAtArrival).toBeGreaterThan(0);
    expect(taken.last?.flightMs).toBeGreaterThan(0);
  });

  it('is worth three from beyond the arc and two from inside it, judged at release', () => {
    // A hoop parked either side of the line, so the distance is the only thing under test.
    const near: HoopMotion = { amplitude: 0, periodMs: 4_000, phase: 0 };
    const inside = { ...aliceFirst(), hoop: near };
    const twoPointer = shoot(
      inside,
      ALICE,
      { ...aimToMake(near, 0), shot: 1 },
      inside.shotStartedAt,
    ).state;

    expect(twoPointer.last?.hoopDistanceAtRelease).toBeLessThan(THREE_POINT_DISTANCE);
    expect(twoPointer.last?.wasThree).toBe(false);
    expect(twoPointer.last?.points).toBe(2);

    // Sat at its far extreme, which is past the line.
    const far: HoopMotion = { amplitude: 1.2, periodMs: 4_000, phase: Math.PI / 2 };
    const outside = { ...aliceFirst(), hoop: far };
    const threePointer = shoot(
      outside,
      ALICE,
      { ...aimToMake(far, 0), shot: 1 },
      outside.shotStartedAt,
    ).state;

    expect(threePointer.last?.hoopDistanceAtRelease).toBeGreaterThanOrEqual(THREE_POINT_DISTANCE);
    expect(threePointer.last?.wasThree).toBe(true);
    expect(threePointer.last?.points).toBe(3);
  });

  it('leaves the beat long enough for the ball to land, even on the slowest lob', () => {
    const state = aliceFirst();
    const lob = shoot(
      state,
      ALICE,
      { type: 'shoot', shot: 1, angle: MAX_ANGLE_DEG, power: 1 },
      state.shotStartedAt,
    ).state;

    const released = state.shotStartedAt + (lob.last?.releasedAtMs ?? 0);
    expect(lob.last?.flightMs).toBeGreaterThan(2_000);
    expect(lob.watchUntil).toBe(released + (lob.last?.flightMs ?? 0) + SETTLE_MS);
  });

  it('announces the shot ending, and the next one opening', () => {
    const state = aliceFirst();
    const taken = shoot(state, ALICE, { ...aimToMake(state.hoop, 0), shot: 1 }, state.shotStartedAt);

    expect(types(taken)).toEqual([EVENTS.game.roundEnded]);
    expect(types(rules.tick(taken.state, taken.state.watchUntil ?? 0, context))).toEqual([
      EVENTS.game.roundStarted,
    ]);
  });
});

describe('when the ball actually left the hand', () => {
  it('is read where the shooter saw the hoop, not where it had drifted to', () => {
    const state = aliceFirst();
    const aim = { ...aimToMake(state.hoop, 0), shot: 1 };

    // The identical frame, one of them a quarter of a second late off a slower connection. The
    // compensation puts them back where they were when they let go.
    const prompt = shoot(state, ALICE, aim, state.shotStartedAt + 250, 0).state;
    const laggy = shoot(state, ALICE, aim, state.shotStartedAt + 250, 250).state;

    expect(prompt.last?.releasedAtMs).toBe(250);
    expect(laggy.last?.releasedAtMs).toBe(0);
    expect(laggy.last?.hoopDistanceAtRelease).toBeCloseTo(hoopXAt(state.hoop, 0), 10);
  });

  it('cannot be compensated back before the shot opened, nor past the buzzer', () => {
    const state = aliceFirst();
    const aim = { ...aimToMake(state.hoop, 0), shot: 1 };

    const overGenerous = shoot(state, ALICE, aim, state.shotStartedAt + 100, 5_000).state;
    expect(overGenerous.last?.releasedAtMs).toBe(0);

    const late = shoot(state, ALICE, aim, state.shotStartedAt + SHOT_CLOCK_MS + 300, 0).state;
    expect(late.last?.releasedAtMs).toBe(SHOT_CLOCK_MS);
  });
});

describe('the shot clock', () => {
  it('chalks off a shot nobody took, worth nothing, and passes it on', () => {
    const state = aliceFirst();
    const timedOut = rules.tick(state, state.shotDeadline, context).state;

    expect(timedOut.last?.outcome).toBe('timeout');
    expect(timedOut.last?.points).toBe(0);
    expect(timedOut.last?.shooter).toBe(ALICE);
    expect(timedOut.last?.angle).toBeNull();
    expect(timedOut.scores).toEqual([0, 0]);

    const next = rules.tick(timedOut, timedOut.watchUntil ?? 0, context).state;
    expect(next.shotNumber).toBe(2);
    expect(rules.turnOf(next)).toBe(BOB);
  });

  it('does nothing early', () => {
    const state = aliceFirst();
    const early = rules.tick(state, state.shotDeadline - 1, context);

    expect(early.state).toBe(state);
    expect(early.events).toEqual([]);
  });

  it('points the platform at the deadline it is actually waiting on', () => {
    const state = aliceFirst();
    expect(rules.nextTickAt(state)).toBe(state.shotDeadline);

    const taken = shoot(state, ALICE, { ...aimToMake(state.hoop, 0), shot: 1 }, state.shotStartedAt)
      .state;
    expect(rules.nextTickAt(taken)).toBe(taken.watchUntil);
  });
});

describe('what the rules refuse', () => {
  it('refuses a shot from the player whose turn it is not', () => {
    const state = aliceFirst();
    expect(refusal(state, BOB, { ...aimToMake(state.hoop, 0), shot: 1 }).message).toMatch(/your shot/i);
  });

  it('refuses a frame carrying a shot the match has moved past', () => {
    const state = aliceFirst();
    expect(refusal(state, ALICE, { type: 'shoot', shot: 2, angle: 45, power: 0.5 }).code).toBe(
      'invalid_action',
    );
  });

  it('refuses a second shot while the ball is still in the air', () => {
    const state = aliceFirst();
    const taken = shoot(state, ALICE, { ...aimToMake(state.hoop, 0), shot: 1 }, state.shotStartedAt)
      .state;

    expect(refusal(taken, ALICE, { type: 'shoot', shot: 1, angle: 45, power: 0.5 }).message).toMatch(
      /already gone/i,
    );
  });

  it('refuses an angle nobody could throw at', () => {
    const state = aliceFirst();

    expect(refusal(state, ALICE, { type: 'shoot', shot: 1, angle: 5, power: 0.5 }).code).toBe(
      'invalid_action',
    );
    expect(refusal(state, ALICE, { type: 'shoot', shot: 1, angle: 120, power: 0.5 }).code).toBe(
      'invalid_action',
    );
  });

  it('refuses a strength outside the range it is measured in', () => {
    const state = aliceFirst();

    expect(refusal(state, ALICE, { type: 'shoot', shot: 1, angle: 45, power: 4 }).code).toBe(
      'invalid_action',
    );
    expect(refusal(state, ALICE, { type: 'shoot', shot: 1, angle: 45, power: -1 }).code).toBe(
      'invalid_action',
    );
  });

  it.each([
    ['nothing at all', null],
    ['another game’s move', { type: 'drop', column: 3 }],
    ['a shot with no aim', { type: 'shoot', shot: 1 }],
    ['an aim that is not a number', { type: 'shoot', shot: 1, angle: '45', power: 0.5 }],
    ['an aim that is not finite', { type: 'shoot', shot: 1, angle: Number.NaN, power: 0.5 }],
  ])('refuses %s', (_label, action) => {
    expect(refusal(aliceFirst(), ALICE, action).code).toBe('invalid_action');
  });

  it('refuses everything once the match is over', () => {
    const state = { ...aliceFirst(), complete: true };
    expect(refusal(state, ALICE, { type: 'shoot', shot: 1, angle: 45, power: 0.5 }).code).toBe(
      'invalid_game_state',
    );
  });

  it('refuses everything while a player is missing', () => {
    const paused = rules.pause(aliceFirst(), 0);
    expect(refusal(paused, ALICE, { type: 'shoot', shot: 1, angle: 45, power: 0.5 }).code).toBe(
      'invalid_game_state',
    );
  });
});

describe('somebody drops out', () => {
  it('stops the clock, so a shot cannot expire while nobody can take it', () => {
    const paused = rules.pause(aliceFirst(), 1_000);

    expect(paused.paused).toBe(true);
    expect(rules.nextTickAt(paused)).toBeNull();
    expect(rules.turnOf(paused)).toBeNull();
    expect(rules.getView(paused, ALICE).shotDeadline).toBeNull();
  });

  it('gives an unshot shot back whole, at the same hoop', () => {
    const state = aliceFirst();
    const paused = rules.pause(state, 4_000);
    const resumed = rules.resume(paused, 50_000, context);

    expect(resumed.state.shotNumber).toBe(1);
    expect(resumed.state.shotStartedAt).toBe(50_000);
    expect(resumed.state.shotDeadline).toBe(50_000 + SHOT_CLOCK_MS);
    // The round's hoop is untouched: the other player has to shoot at the same one.
    expect(resumed.state.hoop).toEqual(state.hoop);
    expect(rules.turnOf(resumed.state)).toBe(ALICE);
  });

  it('does not un-take a shot that had already been thrown', () => {
    const state = aliceFirst();
    const taken = shoot(state, ALICE, { ...aimToMake(state.hoop, 200), shot: 1 }, state.shotStartedAt + 200)
      .state;
    const scored = taken.scores[ALICE];

    const resumed = rules.resume(rules.pause(taken, 3_000), 60_000, context).state;

    expect(resumed.scores[ALICE]).toBe(scored);
    expect(resumed.history).toHaveLength(1);
    expect(resumed.shotNumber).toBe(2);
    expect(rules.turnOf(resumed)).toBe(BOB);
  });

  it('finishes the match if the last ball had already landed', () => {
    let state = aliceFirst();
    for (let shot = 0; shot < TOTAL_SHOTS - 1; shot += 1) state = skipAndAdvance(state);

    const last = rules.tick(state, state.shotDeadline, context).state;
    expect(last.complete).toBe(false);

    const resumed = rules.resume(rules.pause(last, 0), 90_000, context);
    expect(resumed.state.complete).toBe(true);
    expect(types(resumed)).toEqual([EVENTS.game.finished]);
  });
});

describe('the end of it', () => {
  it('runs to twenty shots and finishes only once the last ball has settled', () => {
    let state = aliceFirst();
    for (let shot = 0; shot < TOTAL_SHOTS - 1; shot += 1) state = skipAndAdvance(state);

    expect(state.shotNumber).toBe(TOTAL_SHOTS);

    const lastShot = rules.tick(state, state.shotDeadline, context).state;
    // Still on screen: completing here would take the final ball off it.
    expect(lastShot.complete).toBe(false);
    expect(rules.isComplete(lastShot)).toBe(false);

    const finished = rules.tick(lastShot, lastShot.watchUntil ?? 0, context);
    expect(finished.state.complete).toBe(true);
    expect(types(finished)).toEqual([EVENTS.game.finished]);
    expect(rules.nextTickAt(finished.state)).toBeNull();
    expect(rules.turnOf(finished.state)).toBeNull();
  });

  it('gives it to whoever scored more, and reports the points as the score', () => {
    const state: BasketballState = { ...aliceFirst(), scores: [7, 4], complete: true };

    expect(rules.getResult(state)).toEqual({ winner: ALICE, draw: false, scores: [7, 4] });
    expect(rules.getResult({ ...state, scores: [4, 7] })).toEqual({
      winner: BOB,
      draw: false,
      scores: [4, 7],
    });
  });

  it('is a draw when they matched each other, including a match nobody scored in', () => {
    const state: BasketballState = { ...aliceFirst(), scores: [6, 6], complete: true };
    expect(rules.getResult(state)).toEqual({ winner: null, draw: true, scores: [6, 6] });

    let missed = aliceFirst();
    for (let shot = 0; shot < TOTAL_SHOTS; shot += 1) missed = skipAndAdvance(missed);

    expect(missed.complete).toBe(true);
    expect(rules.getResult(missed)).toEqual({ winner: null, draw: true, scores: [0, 0] });
  });

  it('plays a whole match through, scoring every shot on both sides', () => {
    let state = aliceFirst();
    for (let shot = 0; shot < TOTAL_SHOTS; shot += 1) state = scoreAndAdvance(state, 300 + shot * 40);

    expect(state.complete).toBe(true);
    expect(state.history).toHaveLength(TOTAL_SHOTS);
    expect(state.history.every((shot) => shot.outcome === 'made')).toBe(true);

    const [alice, bob] = state.scores;
    expect(alice).toBeGreaterThanOrEqual(2 * (TOTAL_SHOTS / 2));
    expect(bob).toBeGreaterThanOrEqual(2 * (TOTAL_SHOTS / 2));
    expect(alice + bob).toBe(state.history.reduce((total, shot) => total + shot.points, 0));
  });
});

describe('what each of them is shown', () => {
  it('mirrors: the same match reads the opposite way round from the other seat', () => {
    let state = aliceFirst();
    state = scoreAndAdvance(state, 300);

    const hers = rules.getView(state, ALICE);
    const his = rules.getView(state, BOB);

    expect(hers.yourScore).toBe(his.theirScore);
    expect(hers.theirScore).toBe(his.yourScore);
    expect(hers.yourShotsTaken).toBe(his.theirShotsTaken);
    expect(hers.history[0]?.mine).toBe(true);
    expect(his.history[0]?.mine).toBe(false);
    expect(hers.yourTurn).not.toBe(his.yourTurn);
  });

  it('says who is up next, until there is no next one', () => {
    let state = aliceFirst();
    expect(rules.getView(state, ALICE).nextIsYours).toBe(false);
    expect(rules.getView(state, BOB).nextIsYours).toBe(true);

    for (let shot = 0; shot < TOTAL_SHOTS - 1; shot += 1) state = skipAndAdvance(state);
    expect(rules.getView(state, ALICE).nextIsYours).toBeNull();
  });

  it('carries the hoop’s motion rather than a position, so both draw the same one', () => {
    const state = aliceFirst();
    expect(rules.getView(state, ALICE).hoop).toEqual(rules.getView(state, BOB).hoop);
    expect(rules.getView(state, ALICE).shotStartedAt).toBe(state.shotStartedAt);
  });

  it('keeps the shot on screen while the ball is in the air', () => {
    const state = aliceFirst();
    const taken = shoot(state, ALICE, { ...aimToMake(state.hoop, 0), shot: 1 }, state.shotStartedAt)
      .state;
    const view = rules.getView(taken, BOB);

    expect(view.phase).toBe('watching');
    expect(view.yourTurn).toBe(false);
    expect(view.watchUntil).toBe(taken.watchUntil);
    expect(view.last?.mine).toBe(false);
    expect(view.shotStartedAt).toBe(state.shotStartedAt);
  });
});

describe('what the module declares', () => {
  it('is competitive, drawn with Phaser, and pauses for a missing player', () => {
    expect(rules.meta.slug).toBe('basketball');
    expect(rules.meta.scoringKind).toBe('competitive');
    expect(rules.meta.renderer).toBe('phaser');
    expect(rules.reconnectPolicy.pauseOnDisconnect).toBe(true);
    expect(rules.reconnectPolicy.onExpire).toBe('forfeit');
  });

  it('keeps its own shot clock well inside the platform’s move clock', () => {
    // The platform's two-minute clock is a last resort for somebody who has walked out. A game that
    // can resolve its own turns should never be the thing that fires it.
    expect(SHOT_CLOCK_MS).toBeLessThan(rules.reconnectPolicy.windowMs);
  });

  it('never asks for a throw it would then refuse', () => {
    // Every legal aim has to produce a trajectory the rules can resolve, or the validator and the
    // physics disagree about what a shot is.
    for (let angle = MIN_ANGLE_DEG; angle <= MAX_ANGLE_DEG; angle += 5) {
      for (let power = 0; power <= 1; power += 0.1) {
        const launch = launchOf(angle, power);
        expect(Number.isFinite(launch.vx)).toBe(true);
        expect(Number.isFinite(launch.vy)).toBe(true);
        expect(launch.vx).toBeGreaterThanOrEqual(0);
      }
    }

    expect(launchOf(90, 1).vy).toBeCloseTo(MAX_SPEED, 6);
  });
});
