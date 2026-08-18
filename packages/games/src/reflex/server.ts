import { EVENTS, RECONNECT_WINDOW_MS } from '@rasmalai/shared';
import {
  opponentOf,
  type GameContext,
  type GameEvent,
  type GameResult,
  type GameRules,
  type PlayerIndex,
  type Transition,
  type ValidationResult,
} from '../contract';
import { meta } from './meta';
import {
  FASTEST_INTERVAL_MS,
  GRACE_MS,
  INTERVAL_STEP_MS,
  LANES,
  LEAD_IN_MS,
  MAX_COMPENSATION_MS,
  MOVE_COOLDOWN_MS,
  START_INTERVAL_MS,
  START_LANE,
  WAVES,
  WAVES_PER_EXTRA_LANE,
  type ReflexAction,
  type ReflexView,
  type Wave,
} from './protocol';

/**
 * Reflex, decided entirely on the server.
 *
 * ```text
 * forty-five hazards generated server-side, the same ones for both of you
 *   → they arrive faster and close more lanes as the run goes on
 *   → one step left or right, and a cooldown between steps
 *   → the server judges each hazard from where you actually were when it landed
 *   → last one standing; equal time survived is a draw
 * ```
 *
 * **Game time, not wall clock.** Everything in this file is measured in milliseconds since the run
 * began, and a pause simply stops that clock. It is the only way a game whose entire state is a
 * schedule can survive somebody's phone dropping off mid-run — shifting forty-five absolute
 * deadlines and every recorded move would be the same idea done worse.
 *
 * **A hazard is judged 150ms after it lands.** A dodge made in time and delivered late would
 * otherwise be a death caused by a connection, which is the one thing `docs/13` section 8 says a
 * competitive game must never do. The grace window is the same cap the platform puts on latency
 * compensation, so a move that beat the hazard is counted even when its frame did not.
 *
 * Nothing here reads a clock, holds a socket, or knows a user id. Seats `0` and `1`, five lanes,
 * and a schedule.
 */

interface Step {
  /** Game time this player arrived in this lane. */
  at: number;
  lane: number;
}

interface RunnerState {
  /** Where they have been, oldest first, pruned as hazards are judged. Never empty. */
  steps: Step[];
  /**
   * Game time of their last actual step, or null before they have taken one.
   *
   * Deliberately not "the last entry in `steps`": that entry starts life as the lane they were
   * *placed* in, and reading the cooldown off it would eat everybody's first move — a real bug,
   * caught by a test that expected a player to be one lane over and found them where they started.
   * Pruning rewrites `steps` too, and a settled trail must not reset the cooldown either.
   */
  lastMoveAt: number | null;
  alive: boolean;
  /** Game time they were caught, or null while they are still going. */
  diedAt: number | null;
}

export interface ReflexState {
  waves: Wave[];
  /** How many hazards have been judged. Everything before this is history. */
  judged: number;
  runners: [RunnerState, RunnerState];
  /** Game time banked before the current running stretch. */
  elapsedMs: number;
  /** Wall clock the current stretch started, or null while paused. */
  runningSince: number | null;
  complete: boolean;
}

/**
 * The whole run, generated up front from the server's own randomness.
 *
 * Up front rather than as it goes, because both players are told the entire schedule and a
 * schedule that grew would mean a client that had to keep asking for more. It is also what makes a
 * run reproducible in a test: one seeded sequence, one set of hazards, every time.
 *
 * At least one lane is always left open. A wave nobody can survive is not difficulty, it is a
 * coin toss with extra steps.
 */
function buildRun(context: GameContext): Wave[] {
  const waves: Wave[] = [];
  let at = LEAD_IN_MS;

  for (let index = 0; index < WAVES; index += 1) {
    const closing = Math.min(1 + Math.floor(index / WAVES_PER_EXTRA_LANE), LANES - 1);

    // Draw the *safe* lanes rather than the blocked ones: picking which to close can collide with
    // itself and leave a wave easier than the one before, and difficulty that goes backwards is
    // difficulty nobody can feel.
    const open = LANES - closing;
    const lanes = Array.from({ length: LANES }, (_, lane) => lane);
    for (let position = lanes.length - 1; position > 0; position -= 1) {
      const swap = Math.min(Math.floor(context.random() * (position + 1)), position);
      [lanes[position], lanes[swap]] = [lanes[swap]!, lanes[position]!];
    }

    const blocked = lanes.slice(open).sort((left, right) => left - right);
    waves.push({ at, blocked });

    at += Math.max(FASTEST_INTERVAL_MS, START_INTERVAL_MS - index * INTERVAL_STEP_MS);
  }

  return waves;
}

/** Where this player was at a given game time. `steps` always holds their starting lane. */
function laneAt(runner: RunnerState, time: number): number {
  let lane = runner.steps[0]!.lane;
  for (const step of runner.steps) {
    if (step.at > time) break;
    lane = step.lane;
  }
  return lane;
}

const lastStep = (runner: RunnerState): Step => runner.steps[runner.steps.length - 1]!;

/** How far the run gets if nobody is caught. */
const totalMs = (state: ReflexState): number => state.waves[state.waves.length - 1]!.at;

/** Game time right now — frozen at `elapsedMs` while paused. */
function gameTime(state: ReflexState, now: number): number {
  if (state.runningSince === null) return state.elapsedMs;
  return state.elapsedMs + (now - state.runningSince);
}

/** The wall clock at which a given game time will arrive, or null while nothing is running. */
function wallClockOf(state: ReflexState, time: number): number | null {
  if (state.runningSince === null) return null;
  return state.runningSince + (time - state.elapsedMs);
}

const survivedBy = (state: ReflexState, runner: RunnerState): number =>
  runner.diedAt ?? totalMs(state);

function still(state: ReflexState): Transition<ReflexState> {
  return { state, events: [] };
}

function freshRunner(): RunnerState {
  return { steps: [{ at: 0, lane: START_LANE }], lastMoveAt: null, alive: true, diedAt: null };
}

export const rules: GameRules<ReflexState, ReflexAction, ReflexView> = {
  meta,

  reconnectPolicy: {
    windowMs: RECONNECT_WINDOW_MS,
    // A timed game must stop its clock, or the absent player is caught by hazards they were never
    // shown. Nothing else here needs discarding — the schedule and both trails are exactly what
    // should still be there when they get back.
    pauseOnDisconnect: true,
    // Two minutes is long enough that this is walking out, not bad wifi.
    onExpire: 'forfeit',
  },

  createMatch(now, context) {
    return {
      waves: buildRun(context),
      judged: 0,
      runners: [freshRunner(), freshRunner()],
      elapsedMs: 0,
      runningSince: now,
      complete: false,
    };
  },

  validateAction(state, player, action): ValidationResult<ReflexAction> {
    if (state.complete) {
      return { ok: false, code: 'invalid_game_state', message: 'That game is already over.' };
    }
    if (state.runningSince === null) {
      return { ok: false, code: 'invalid_game_state', message: 'The game is paused.' };
    }
    if (!state.runners[player].alive) {
      return { ok: false, code: 'invalid_game_state', message: 'You are out of this one.' };
    }

    const candidate = action as Partial<ReflexAction> | null;
    if (
      !candidate ||
      candidate.type !== 'move' ||
      (candidate.direction !== 'left' && candidate.direction !== 'right')
    ) {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    return { ok: true, action: { type: 'move', direction: candidate.direction } };
  },

  applyAction(state, player, action, at, _context) {
    const runner = state.runners[player];
    const previous = lastStep(runner);

    // The server's own estimate of this player's one-way delay, capped and floored. A generous
    // estimate must never place a move before one already recorded, which would corrupt the trail
    // the hazards are judged against.
    const compensation = Math.min(Math.max(at.compensationMs, 0), MAX_COMPENSATION_MS);
    const when = Math.max(gameTime(state, at.receivedAt) - compensation, previous.at);

    const lane = Math.min(
      LANES - 1,
      Math.max(0, previous.lane + (action.direction === 'left' ? -1 : 1)),
    );

    // Two ways a move does nothing: too soon after the last one, or already against the wall.
    // Neither is an error — this game is played by hammering a key, and answering every third press
    // with a protocol error would fill the socket with noise the player cannot act on. The mover
    // gets a frame so their screen snaps back to where they really are; their partner is not
    // troubled with it.
    const tooSoon = runner.lastMoveAt !== null && when - runner.lastMoveAt < MOVE_COOLDOWN_MS;
    if (tooSoon || lane === previous.lane) {
      return { state, events: [{ type: EVENTS.game.stateUpdated, to: player }] };
    }

    const runners: [RunnerState, RunnerState] = [...state.runners];
    runners[player] = { ...runner, steps: [...runner.steps, { at: when, lane }], lastMoveAt: when };

    // Both of them: watching your partner scramble two lanes over is most of the fun of losing.
    return { state: { ...state, runners }, events: [{ type: EVENTS.game.stateUpdated }] };
  },

  tick(state, now, _context) {
    if (state.complete || state.runningSince === null) return still(state);

    const clock = gameTime(state, now);
    let judged = state.judged;
    const runners: [RunnerState, RunnerState] = [...state.runners];
    let caught = false;

    // Judged in order and never skipped, so a tick that arrives late resolves everything it slept
    // through rather than letting hazards pass unnoticed.
    while (judged < state.waves.length) {
      const wave = state.waves[judged]!;
      if (clock < wave.at + GRACE_MS) break;

      for (const seat of [0, 1] as PlayerIndex[]) {
        const runner = runners[seat];
        if (!runner.alive) continue;

        if (wave.blocked.includes(laneAt(runner, wave.at))) {
          runners[seat] = { ...runner, alive: false, diedAt: wave.at };
          caught = true;
          continue;
        }

        // Everything before this hazard is settled, so the trail can be cut back to the one step
        // that still says where they are. Otherwise a long run accumulates a step per keypress.
        const surviving = runner.steps.filter((step) => step.at > wave.at);
        const standing = { at: wave.at, lane: laneAt(runner, wave.at) };
        runners[seat] = { ...runner, steps: [standing, ...surviving] };
      }

      judged += 1;
      if (!runners[0].alive && !runners[1].alive) break;
    }

    if (judged === state.judged) return still(state);

    const complete = (!runners[0].alive && !runners[1].alive) || judged >= state.waves.length;

    const events: GameEvent[] = [];
    // Only when something a player can see has changed. A hazard that caught nobody is already on
    // their screens, falling exactly where the schedule said it would.
    if (caught || complete) events.push({ type: EVENTS.game.stateUpdated });
    if (complete) events.push({ type: EVENTS.game.finished });

    return { state: { ...state, judged, runners, complete }, events };
  },

  nextTickAt(state) {
    if (state.complete || state.runningSince === null) return null;
    const wave = state.waves[state.judged];
    if (!wave) return null;
    return wallClockOf(state, wave.at + GRACE_MS);
  },

  // Nobody is ever on the move clock: the run is on a schedule, and being slow to it is what the
  // game measures rather than something to be timed out for.
  turnOf() {
    return null;
  },

  /** Stop the clock. The schedule and both trails are exactly what should still be here. */
  pause(state, now) {
    if (state.complete || state.runningSince === null) return state;
    return { ...state, elapsedMs: gameTime(state, now), runningSince: null };
  },

  /** Start it again from where it stopped — the run picks up mid-air rather than restarting. */
  resume(state, now) {
    if (state.complete || state.runningSince !== null) return still(state);
    return {
      state: { ...state, runningSince: now },
      events: [{ type: EVENTS.game.stateUpdated }],
    };
  },

  getView(state, player) {
    const them = opponentOf(player);
    const [mine, theirs] = [state.runners[player], state.runners[them]];

    const mySurvival = survivedBy(state, mine);
    const theirSurvival = survivedBy(state, theirs);

    const outcome = !state.complete
      ? null
      : mySurvival === theirSurvival
        ? ('drawn' as const)
        : mySurvival > theirSurvival
          ? ('won' as const)
          : ('lost' as const);

    return {
      lanes: LANES,
      // Game time zero, in the reader's own clock. Everything the renderer draws hangs off this.
      originAt: state.runningSince === null ? null : state.runningSince - state.elapsedMs,
      elapsedMs: state.elapsedMs,
      // The whole schedule, every frame. Forty-five hazards is a smaller thing to send than the
      // machinery for sending some of them would be, and a client can never run out of run.
      waves: state.waves,
      totalMs: totalMs(state),
      you: { lane: lastStep(mine).lane, alive: mine.alive, survivedMs: mySurvival },
      them: { lane: lastStep(theirs).lane, alive: theirs.alive, survivedMs: theirSurvival },
      paused: state.runningSince === null && !state.complete,
      outcome,
      complete: state.complete,
    };
  },

  isComplete(state) {
    return state.complete;
  },

  getResult(state): GameResult {
    const [a, b] = [survivedBy(state, state.runners[0]), survivedBy(state, state.runners[1])];

    return {
      winner: a === b ? null : a > b ? 0 : 1,
      draw: a === b,
      // Milliseconds survived. Higher is better, as `matches.score_a` requires, and the margin
      // between them is a real measure of how close the run was.
      scores: [a, b],
    };
  },
};
