import { EVENTS, RECONNECT_WINDOW_MS } from '@rasmalai/shared';
import {
  opponentOf,
  type GameContext,
  type GameResult,
  type GameRules,
  type PlayerIndex,
  type Transition,
  type ValidationResult,
} from '../contract';
import { meta } from './meta';
import {
  HOOP_AMPLITUDE_FIRST,
  HOOP_AMPLITUDE_LAST,
  HOOP_PERIOD_FIRST_MS,
  HOOP_PERIOD_LAST_MS,
  LEVELS,
  MAKE_TOLERANCE,
  MAX_ANGLE_DEG,
  MIN_ANGLE_DEG,
  RELEASE_X,
  ROUNDS_PER_LEVEL,
  SETTLE_MS,
  SHOT_CLOCK_MS,
  THREE_POINTS,
  THREE_POINT_DISTANCE,
  TOTAL_SHOTS,
  TWO_POINTS,
  ballAt,
  computeBallPath,
  hoopXAt,
  launchOf,
  pathDurationMs,
  timeToFloor,
  timeToRim,
  type BasketballAction,
  type BasketballView,
  type HoopMotion,
  type ShotOutcome,
  type ShotView,
} from './protocol';

/**
 * Basketball, decided entirely on the server.
 *
 * ```text
 * match created → server coin-flips who shoots first
 *   → the shooter has fifteen seconds while the hoop stands still (level one) or drifts past (level two)
 *   → they send an angle and a strength; the server flies the ball and decides where the hoop was
 *     when it arrived
 *   → both of them watch it land, then the other one shoots
 *   → five rounds of two shots, twice over — level one stationary, level two moving — → most points
 *     wins; equal is a draw
 * ```
 *
 * **Nothing here has an opinion about pixels.** A client sends the two numbers a throw consists of
 * and the server does the rest: it decides when the ball left (from its own arrival time, less its
 * own latency estimate), where the hoop had drifted to by the time the ball got there, whether that
 * counts, and what it is worth. A client that claimed a basket would be asserting an outcome, and
 * clients send intents (`docs/04` section 1).
 *
 * **The hoop is rolled per round, not per shot.** Both players in a round meet an identically
 * moving hoop measured from their own shot's opening moment, which is the whole of what makes an
 * alternating game fair (`docs/04` section 10). Rolling per shot would give one of them a gentle
 * hoop and the other a wild one; carrying the position over from the previous shot would hand the
 * second shooter whatever the first left behind.
 *
 * **Who shoots when snakes**: A B B A A B B A A B. Five each, and each of them shoots second in
 * half the rounds — the second shooter knows what they need, and strict alternation would give that
 * to the same person every time.
 *
 * As with every game here, nothing in this file reads a clock, holds a socket, or knows a user id.
 */

interface ShotRecord {
  number: number;
  round: number;
  shooter: PlayerIndex;
  outcome: ShotOutcome;
  points: number;
  angle: number | null;
  power: number | null;
  releasedAtMs: number | null;
  flightMs: number;
  landingX: number | null;
  hoopXAtArrival: number;
  hoopDistanceAtRelease: number;
  wasThree: boolean;
}

export interface BasketballState {
  /** 1-based, across the whole match. The round is derived from it and cannot drift. */
  shotNumber: number;
  /** Who took shot one — a coin flip, re-flipped for a rematch. */
  startedBy: PlayerIndex;
  phase: 'aiming' | 'watching';
  /** Server epoch ms this shot opened: the origin the hoop's motion is measured from. */
  shotStartedAt: number;
  /** Server epoch ms the shot clock runs out. Unreachable while paused. */
  shotDeadline: number;
  /** Server epoch ms the ball has landed and been looked at. Null while aiming. */
  watchUntil: number | null;
  /** This round's hoop. Shared by both of its shots. */
  hoop: HoopMotion;
  last: ShotRecord | null;
  history: ShotRecord[];
  scores: [number, number];
  paused: boolean;
  complete: boolean;
}

/** Two shots to a round, so shots 7 and 8 are round 4. */
function roundOf(shotNumber: number): number {
  return Math.ceil(shotNumber / 2);
}

/** 1 while the hoop is still standing, 2 once it starts drifting. */
function levelOf(round: number): number {
  return Math.ceil(round / ROUNDS_PER_LEVEL);
}

/** 1-based position inside its level — level two's first round is round 6 overall and 1 in here. */
function roundInLevelOf(round: number): number {
  return ((round - 1) % ROUNDS_PER_LEVEL) + 1;
}

/**
 * Whose shot number `n` is.
 *
 * Derived rather than stored, so the order cannot come adrift from the count. Each round's first
 * shot alternates, and the second shot of a round belongs to whoever did not take the first.
 */
function shooterOfShot(shotNumber: number, startedBy: PlayerIndex): PlayerIndex {
  const firstOfRound = roundOf(shotNumber) % 2 === 1 ? startedBy : opponentOf(startedBy);
  return (shotNumber - 1) % 2 === 1 ? opponentOf(firstOfRound) : firstOfRound;
}

function shooterOf(state: BasketballState): PlayerIndex {
  return shooterOfShot(state.shotNumber, state.startedBy);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * This round's hoop: dead still through level one, then gentler-to-wilder across level two, and
 * never quite the same twice.
 *
 * Level one has nothing to roll — the arc is the whole problem while the hoop cannot move, so an
 * amplitude of zero is the entire hoop and no randomness is spent getting there. Level two picks up
 * the escalation on its own five rounds rather than continuing the match's: round 6 opens exactly as
 * gentle as round 1 used to, because level two is teaching a drifting hoop from scratch, not
 * finishing a curve level one already started.
 *
 * The jitter and the phase are what stop a round being memorised — without them level two's fifth
 * round of every match would be the identical problem, and the couple who played it yesterday would
 * be solving it from memory rather than watching it.
 */
function hoopFor(round: number, context: GameContext): HoopMotion {
  if (levelOf(round) === 1) {
    return { amplitude: 0, periodMs: HOOP_PERIOD_FIRST_MS, phase: 0 };
  }

  // Round one of the level sits at 0 and its last round at 1. The floor of one on the divisor is
  // only there so a one-round level would still be arithmetic.
  const t = (roundInLevelOf(round) - 1) / Math.max(ROUNDS_PER_LEVEL - 1, 1);
  const jitter = () => 0.9 + context.random() * 0.2;

  return {
    amplitude: lerp(HOOP_AMPLITUDE_FIRST, HOOP_AMPLITUDE_LAST, t) * jitter(),
    // Whole milliseconds, like every other deadline here: a period no clock can express is not
    // worth setting, and both ends have to agree on it exactly.
    periodMs: Math.round(lerp(HOOP_PERIOD_FIRST_MS, HOOP_PERIOD_LAST_MS, t) * jitter()),
    phase: context.random() * 2 * Math.PI,
  };
}

function still(state: BasketballState): Transition<BasketballState> {
  return { state, events: [] };
}

/** A shot opening: a fresh fifteen seconds, and a fresh hoop if this is a new round. */
function openShot(
  state: BasketballState,
  shotNumber: number,
  now: number,
  context: GameContext,
): BasketballState {
  const sameRound = roundOf(shotNumber) === roundOf(state.shotNumber);

  return {
    ...state,
    shotNumber,
    phase: 'aiming',
    shotStartedAt: now,
    shotDeadline: now + SHOT_CLOCK_MS,
    watchUntil: null,
    hoop: sameRound ? state.hoop : hoopFor(roundOf(shotNumber), context),
    paused: false,
  };
}

/**
 * Files a shot and starts the beat both of them watch it in.
 *
 * `restedAt` is when the ball stopped being interesting — the moment it dropped through, hit the
 * floor, or the clock ran out on a shot nobody took. Derived from the release and the flight rather
 * than from whenever this happened to be computed, so the two clients and the server all agree on
 * when the next shot opens without any of them being told separately.
 */
function closeShot(
  state: BasketballState,
  record: ShotRecord,
  restedAt: number,
): Transition<BasketballState> {
  const scores: [number, number] = [...state.scores];
  scores[record.shooter] += record.points;

  return {
    state: {
      ...state,
      phase: 'watching',
      shotDeadline: Number.POSITIVE_INFINITY,
      watchUntil: restedAt + SETTLE_MS,
      last: record,
      history: [...state.history, record],
      scores,
    },
    events: [{ type: EVENTS.game.roundEnded }],
  };
}

/**
 * The ball has landed and been looked at: either the next shot opens, or the match is over.
 *
 * The match deliberately does not end the instant the last ball is resolved. Completion hands the
 * session straight to its results screen, and doing that mid-flight would take the final shot off
 * the screen before either of them saw whether it went in.
 */
function advance(
  state: BasketballState,
  now: number,
  context: GameContext,
): Transition<BasketballState> {
  if (state.shotNumber >= TOTAL_SHOTS) {
    return {
      state: { ...state, paused: false, complete: true, watchUntil: null },
      events: [{ type: EVENTS.game.finished }],
    };
  }

  return {
    state: openShot(state, state.shotNumber + 1, now, context),
    events: [{ type: EVENTS.game.roundStarted }],
  };
}

function shotView(shot: ShotRecord, player: PlayerIndex): ShotView {
  return {
    number: shot.number,
    round: shot.round,
    mine: shot.shooter === player,
    outcome: shot.outcome,
    points: shot.points,
    angle: shot.angle,
    power: shot.power,
    releasedAtMs: shot.releasedAtMs,
    flightMs: shot.flightMs,
    landingX: shot.landingX,
    hoopXAtArrival: shot.hoopXAtArrival,
    hoopDistanceAtRelease: shot.hoopDistanceAtRelease,
    wasThree: shot.wasThree,
  };
}

export const rules: GameRules<BasketballState, BasketballAction, BasketballView> = {
  meta,

  reconnectPolicy: {
    windowMs: RECONNECT_WINDOW_MS,
    // A shot clock must stop, or somebody's wifi costs them a shot they never got to take.
    pauseOnDisconnect: true,
    // Two minutes is long enough that this is walking out, not bad wifi.
    onExpire: 'forfeit',
  },

  createMatch(now, context) {
    // A coin flip, from the server's own randomness, re-flipped for every rematch. The snake order
    // shares out the advantage of shooting second, so this decides less than it would in a strictly
    // alternating game — but it still decides something, and chance is the fairest way to.
    const startedBy: PlayerIndex = context.random() < 0.5 ? 0 : 1;

    return {
      shotNumber: 1,
      startedBy,
      phase: 'aiming',
      shotStartedAt: now,
      shotDeadline: now + SHOT_CLOCK_MS,
      watchUntil: null,
      hoop: hoopFor(1, context),
      last: null,
      history: [],
      scores: [0, 0],
      paused: false,
      complete: false,
    };
  },

  validateAction(state, player, action): ValidationResult<BasketballAction> {
    if (state.complete) {
      return { ok: false, code: 'invalid_game_state', message: 'That game is already over.' };
    }
    if (state.paused) {
      return { ok: false, code: 'invalid_game_state', message: 'The game is paused.' };
    }

    const candidate = action as Partial<BasketballAction> | null;
    if (
      !candidate ||
      candidate.type !== 'shoot' ||
      typeof candidate.shot !== 'number' ||
      typeof candidate.angle !== 'number' ||
      typeof candidate.power !== 'number' ||
      !Number.isFinite(candidate.angle) ||
      !Number.isFinite(candidate.power)
    ) {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    // A frame that lost a race with the shot clock. Dropping it is the point: it must never land on
    // the shot that replaced it, and it must never be scored against a hoop it was not aimed at.
    if (state.phase !== 'aiming' || candidate.shot !== state.shotNumber) {
      return { ok: false, code: 'invalid_action', message: 'That shot has already gone.' };
    }

    if (shooterOf(state) !== player) {
      return { ok: false, code: 'invalid_action', message: 'It is not your shot.' };
    }

    if (candidate.angle < MIN_ANGLE_DEG || candidate.angle > MAX_ANGLE_DEG) {
      return { ok: false, code: 'invalid_action', message: 'That is not an angle you can throw at.' };
    }

    if (candidate.power < 0 || candidate.power > 1) {
      return { ok: false, code: 'invalid_action', message: 'That is not a throw you can make.' };
    }

    return {
      ok: true,
      action: {
        type: 'shoot',
        shot: candidate.shot,
        angle: candidate.angle,
        power: candidate.power,
      },
    };
  },

  applyAction(state, player, action, at, _context) {
    // When the ball actually left the hand, by the server's own reckoning. The compensation is the
    // platform's measurement of that socket's one-way delay — already capped there, and never
    // asserted by the client — so the hoop is read where the shooter saw it rather than where it
    // had drifted to while the frame was in the post. Clamped into the shot clock at both ends: a
    // generous estimate must not reach back before the shot opened, and a frame that arrived a
    // fraction late is scored at the buzzer rather than thrown away.
    const compensated = at.receivedAt - Math.max(at.compensationMs, 0) - state.shotStartedAt;
    const releasedAtMs = Math.min(Math.max(compensated, 0), SHOT_CLOCK_MS);

    const launch = launchOf(action.angle, action.power);
    const hoopXAtRelease = hoopXAt(state.hoop, releasedAtMs);
    const hoopDistanceAtRelease = hoopXAtRelease - RELEASE_X;

    // Judged at release, not on arrival: the arc line is what the shooter was looking at when they
    // decided to take it, and rewarding the decision is the point of having two values at all.
    const wasThree = hoopDistanceAtRelease >= THREE_POINT_DISTANCE;

    const rimSeconds = timeToRim(launch);
    let outcome: ShotOutcome = 'missed';
    let landingX: number | null = null;
    let hoopXAtArrival: number;

    if (rimSeconds === null) {
      // Never got as high as the rim. It still has to land somewhere, and the hoop still moves
      // while it does, so the screen has something honest to draw.
      hoopXAtArrival = hoopXAt(state.hoop, releasedAtMs + timeToFloor(launch) * 1000);
    } else {
      landingX = ballAt(launch, rimSeconds).x;
      hoopXAtArrival = hoopXAt(state.hoop, releasedAtMs + rimSeconds * 1000);
      if (Math.abs(landingX - hoopXAtArrival) <= MAKE_TOLERANCE) outcome = 'made';
    }

    // A ball that went in stops at the rim. Anything else carries on — bouncing off the rim or the
    // backboard first if it comes close enough to hit them — so `flightMs` has to be measured off
    // that same bounced path rather than the clean parabola, or the watching beat below could end
    // while the ball everyone is looking at is still in the air.
    const flightMs =
      outcome === 'made' && rimSeconds !== null
        ? rimSeconds * 1000
        : pathDurationMs(computeBallPath(launch, releasedAtMs, state.hoop), releasedAtMs);

    const record: ShotRecord = {
      number: state.shotNumber,
      round: roundOf(state.shotNumber),
      shooter: player,
      outcome,
      points: outcome === 'made' ? (wasThree ? THREE_POINTS : TWO_POINTS) : 0,
      angle: action.angle,
      power: action.power,
      releasedAtMs,
      flightMs,
      landingX,
      hoopXAtArrival,
      hoopDistanceAtRelease,
      wasThree,
    };

    return closeShot(state, record, state.shotStartedAt + releasedAtMs + flightMs);
  },

  tick(state, now, context) {
    if (state.complete || state.paused) return still(state);

    if (state.phase === 'aiming' && now >= state.shotDeadline) {
      // Nobody shot. Chalked off rather than played for them: nothing is ever thrown on a player's
      // behalf, the same way a timed-out board is awarded rather than continued.
      const record: ShotRecord = {
        number: state.shotNumber,
        round: roundOf(state.shotNumber),
        shooter: shooterOf(state),
        outcome: 'timeout',
        points: 0,
        angle: null,
        power: null,
        releasedAtMs: null,
        flightMs: 0,
        landingX: null,
        hoopXAtArrival: hoopXAt(state.hoop, SHOT_CLOCK_MS),
        hoopDistanceAtRelease: hoopXAt(state.hoop, SHOT_CLOCK_MS) - RELEASE_X,
        wasThree: false,
      };

      return closeShot(state, record, state.shotDeadline);
    }

    if (state.phase === 'watching' && state.watchUntil !== null && now >= state.watchUntil) {
      return advance(state, now, context);
    }

    return still(state);
  },

  nextTickAt(state) {
    if (state.complete || state.paused) return null;
    return state.phase === 'aiming' ? state.shotDeadline : state.watchUntil;
  },

  // The shooter, and only while there is a shot to take. Nobody is under the platform's two-minute
  // clock while a ball is in the air, and the shot clock means it never runs out in practice — but
  // naming the seat is what puts "your shot" on both of their screens, and the game should say who
  // it is waiting on whether or not anything is going to happen about it.
  turnOf(state) {
    if (state.complete || state.paused || state.phase !== 'aiming') return null;
    return shooterOf(state);
  },

  pause(state, _now) {
    if (state.complete) return state;

    // The clocks stop where they are. An unshot shot is given back whole on resume rather than
    // resumed with two seconds left on it, and a shot already in the air keeps its result — it was
    // taken, and a disconnect afterwards does not un-take it.
    return {
      ...state,
      paused: true,
      shotDeadline: Number.POSITIVE_INFINITY,
      watchUntil: null,
    };
  },

  resume(state, now, context) {
    if (state.complete) return still(state);

    // The ball had already landed, so there is nothing to give back: carry on to the next shot, or
    // finish if that was the last of them.
    if (state.phase === 'watching') return advance(state, now, context);

    // A fresh fifteen seconds, and the hoop's cycle restarts with it. The motion itself is untouched on
    // purpose — it belongs to the round and the other player has to shoot at the same one.
    return {
      state: {
        ...state,
        paused: false,
        shotStartedAt: now,
        shotDeadline: now + SHOT_CLOCK_MS,
      },
      events: [{ type: EVENTS.game.roundStarted }],
    };
  },

  getView(state, player) {
    const them = opponentOf(player);
    const nextNumber = state.shotNumber + 1;

    return {
      levels: LEVELS,
      level: levelOf(roundOf(state.shotNumber)),
      roundsPerLevel: ROUNDS_PER_LEVEL,
      roundInLevel: roundInLevelOf(roundOf(state.shotNumber)),
      shotNumber: state.shotNumber,
      phase: state.phase,
      yourTurn:
        !state.complete && !state.paused && state.phase === 'aiming' && shooterOf(state) === player,
      nextIsYours:
        nextNumber > TOTAL_SHOTS ? null : shooterOfShot(nextNumber, state.startedBy) === player,
      shotStartedAt: state.shotStartedAt,
      // Infinity is how a paused clock is held; it is not a deadline anybody can render.
      shotDeadline:
        state.phase === 'aiming' && Number.isFinite(state.shotDeadline) ? state.shotDeadline : null,
      watchUntil: state.watchUntil,
      hoop: state.hoop,
      last: state.last === null ? null : shotView(state.last, player),
      history: state.history.map((shot) => shotView(shot, player)),
      yourScore: state.scores[player],
      theirScore: state.scores[them],
      yourShotsTaken: state.history.filter((shot) => shot.shooter === player).length,
      theirShotsTaken: state.history.filter((shot) => shot.shooter === them).length,
      paused: state.paused,
      complete: state.complete,
    };
  },

  isComplete(state) {
    return state.complete;
  },

  getResult(state): GameResult {
    const [pointsA, pointsB] = state.scores;

    return {
      winner: pointsA === pointsB ? null : pointsA > pointsB ? 0 : 1,
      draw: pointsA === pointsB,
      // Points, which is already a score where higher is better, so it goes to `matches.score_a`
      // unchanged and means something on a catalogue card as a personal best.
      scores: [pointsA, pointsB],
    };
  },
};
