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
  ARM_MAX_MS,
  ARM_MIN_MS,
  BREATHER_MS,
  MAX_COMPENSATION_MS,
  ROUNDS,
  TAP_TIMEOUT_MS,
  type ReactionSpeedAction,
  type ReactionSpeedView,
  type RoundEnding,
  type RoundPhase,
  type RoundView,
} from './protocol';

/**
 * Reaction Speed, decided entirely on the server.
 *
 * The lifecycle from `docs/13` section 8, unchanged:
 *
 * ```text
 * round armed → server waits a random 1.5–4.0s → the round goes live
 *   → each player taps → the server times its own arrival, not the client's claim
 *   → the round ends when both have tapped, or after 3s
 *   → five rounds → most rounds won; equal = draw
 * ```
 *
 * Tapping before the round goes live is a false start and loses that round immediately. It ends the
 * round there and then rather than letting the other player tap into a decided result, which keeps
 * the punishment for flinching honest and the game moving.
 *
 * Nothing in this file reads a clock or sets a timer. Time arrives as an argument and leaves through
 * `nextTickAt`, which is what lets a whole match be played out deterministically in a test.
 */

interface Tap {
  reactionMs: number;
}

interface RoundState {
  number: number;
  phase: RoundPhase;
  /** Server epoch ms this round stops arming and goes live. */
  liveAt: number;
  startedAt: number | null;
  /** When an unanswered round gives up. */
  deadline: number | null;
  taps: [Tap | null, Tap | null];
  falseStart: [boolean, boolean];
  winner: PlayerIndex | null;
  ending: RoundEnding | null;
  /** Set when the round ends: when the next one arms. */
  nextRoundAt: number | null;
}

export interface ReactionSpeedState {
  /** The round on screen. Once it resolves it is also the last entry in `history`. */
  round: RoundState;
  /** Every resolved round, oldest first. */
  history: RoundState[];
  roundsWon: [number, number];
  paused: boolean;
  complete: boolean;
}

function armedRound(number: number, now: number, context: GameContext): RoundState {
  return {
    number,
    phase: 'arming',
    // Uniform across the whole window. A fixed or narrow delay is learnable, and a player who has
    // learned the delay is no longer reacting to anything.
    //
    // Rounded to a whole millisecond because timers are: a deadline of `…2750.6` is asked for and
    // arrives at `…2750`, a tick that finds itself early. The platform copes with that either way,
    // but a deadline no clock can express is not worth setting.
    liveAt: Math.round(now + ARM_MIN_MS + context.random() * (ARM_MAX_MS - ARM_MIN_MS)),
    startedAt: null,
    deadline: null,
    taps: [null, null],
    falseStart: [false, false],
    winner: null,
    ending: null,
    nextRoundAt: null,
  };
}

/** A round waiting on a resume. `liveAt` is unreachable on purpose: a paused game must not start. */
function pausedRound(number: number): RoundState {
  return {
    number,
    phase: 'arming',
    liveAt: Number.POSITIVE_INFINITY,
    startedAt: null,
    deadline: null,
    taps: [null, null],
    falseStart: [false, false],
    winner: null,
    ending: null,
    nextRoundAt: null,
  };
}

/** Who won a round that has just stopped. */
function decide(round: RoundState): { winner: PlayerIndex | null; ending: RoundEnding } {
  const [falseA, falseB] = round.falseStart;
  // Only ever one: the first flinch ends the round, so the other player never gets the chance.
  if (falseA) return { winner: 1, ending: 'false-start' };
  if (falseB) return { winner: 0, ending: 'false-start' };

  const [tapA, tapB] = round.taps;
  if (tapA && tapB) {
    if (tapA.reactionMs === tapB.reactionMs) return { winner: null, ending: 'tapped' };
    return { winner: tapA.reactionMs < tapB.reactionMs ? 0 : 1, ending: 'tapped' };
  }
  if (tapA) return { winner: 0, ending: 'tapped' };
  if (tapB) return { winner: 1, ending: 'tapped' };

  // Both froze. Nobody earns a round for doing nothing.
  return { winner: null, ending: 'nobody-tapped' };
}

/** Stops the current round, scores it, and lines up whatever comes next. */
function resolve(state: ReactionSpeedState, round: RoundState, now: number): Transition<ReactionSpeedState> {
  const { winner, ending } = decide(round);
  const wasLast = round.number >= ROUNDS;

  const resolved: RoundState = {
    ...round,
    phase: 'over',
    winner,
    ending,
    nextRoundAt: wasLast ? null : now + BREATHER_MS,
  };

  const roundsWon: [number, number] = [...state.roundsWon];
  if (winner !== null) roundsWon[winner] += 1;

  const events: GameEvent[] = [{ type: EVENTS.game.roundEnded }];
  if (wasLast) events.push({ type: EVENTS.game.finished });

  return {
    state: {
      ...state,
      round: resolved,
      history: [...state.history, resolved],
      roundsWon,
      complete: wasLast,
    },
    events,
  };
}

function still(state: ReactionSpeedState): Transition<ReactionSpeedState> {
  return { state, events: [] };
}

function roundView(round: RoundState, player: PlayerIndex): RoundView {
  const them = opponentOf(player);
  const over = round.phase === 'over';

  const yours = round.taps[player];
  const theirs = round.taps[them];

  const outcome = !over
    ? null
    : round.winner === null
      ? ('drawn' as const)
      : round.winner === player
        ? ('won' as const)
        : ('lost' as const);

  return {
    number: round.number,
    phase: round.phase,
    startedAt: round.startedAt,
    // Your own time is yours to see as soon as it exists; theirs is withheld until the round is
    // over, so nobody is playing against a partner's tap instead of the signal.
    yourReactionMs: yours ? Math.round(yours.reactionMs) : null,
    theirReactionMs: over && theirs ? Math.round(theirs.reactionMs) : null,
    yourFalseStart: round.falseStart[player],
    theirFalseStart: over && round.falseStart[them],
    outcome,
    ending: round.ending,
  };
}

export const rules: GameRules<ReactionSpeedState, ReactionSpeedAction, ReactionSpeedView> = {
  meta,

  reconnectPolicy: {
    windowMs: RECONNECT_WINDOW_MS,
    // A timed game must stop its clock, or the missing player loses rounds they were never shown.
    pauseOnDisconnect: true,
    // Two minutes is long enough that this is walking out, not bad wifi.
    onExpire: 'forfeit',
  },

  createMatch(now, context) {
    return {
      round: armedRound(1, now, context),
      history: [],
      roundsWon: [0, 0],
      paused: false,
      complete: false,
    };
  },

  validateAction(state, player, action): ValidationResult<ReactionSpeedAction> {
    if (state.complete) {
      return { ok: false, code: 'invalid_game_state', message: 'That game is already over.' };
    }
    if (state.paused) {
      return { ok: false, code: 'invalid_game_state', message: 'The game is paused.' };
    }

    const candidate = action as Partial<ReactionSpeedAction> | null;
    if (!candidate || candidate.type !== 'tap' || typeof candidate.round !== 'number') {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    // A tap carrying a round number we have moved past is a frame that lost a race with the server.
    // Dropping it is the point: it must never land on the round that replaced it.
    if (candidate.round !== state.round.number || state.round.phase === 'over') {
      return { ok: false, code: 'invalid_action', message: 'That round has already finished.' };
    }

    if (state.round.taps[player] !== null || state.round.falseStart[player]) {
      return { ok: false, code: 'invalid_action', message: 'You have already gone this round.' };
    }

    return { ok: true, action: { type: 'tap', round: candidate.round } };
  },

  applyAction(state, player, _action, at, _context) {
    const round = state.round;

    if (round.phase === 'arming') {
      // A false start. The round is decided the moment somebody flinches.
      const flinched: RoundState = {
        ...round,
        falseStart: player === 0 ? [true, round.falseStart[1]] : [round.falseStart[0], true],
      };
      return resolve(state, flinched, at.receivedAt);
    }

    const startedAt = round.startedAt ?? at.receivedAt;

    // The compensation is the server's own estimate of that player's one-way delay, capped. The
    // client never asserts a number, so the worst a bad connection can do is be forgiven up to the
    // cap — never rewarded past it. Clamped at zero: a generous estimate must not invent a reaction
    // faster than the signal itself.
    const compensation = Math.min(Math.max(at.compensationMs, 0), MAX_COMPENSATION_MS);
    const reactionMs = Math.max(0, at.receivedAt - compensation - startedAt);

    const taps: [Tap | null, Tap | null] =
      player === 0 ? [{ reactionMs }, round.taps[1]] : [round.taps[0], { reactionMs }];

    const tapped: RoundState = { ...round, taps };

    if (taps[0] && taps[1]) return resolve(state, tapped, at.receivedAt);

    // Only the tapper is told, and only that their own tap landed. Telling the partner would hand
    // them the one piece of information this game is about.
    return { state: { ...state, round: tapped }, events: [{ type: EVENTS.game.stateUpdated, to: player }] };
  },

  tick(state, now, context) {
    if (state.complete || state.paused) return still(state);

    const round = state.round;

    if (round.phase === 'arming' && now >= round.liveAt) {
      return {
        state: {
          ...state,
          round: { ...round, phase: 'live', startedAt: now, deadline: now + TAP_TIMEOUT_MS },
        },
        events: [{ type: EVENTS.game.roundStarted }],
      };
    }

    if (round.phase === 'live' && round.deadline !== null && now >= round.deadline) {
      return resolve(state, round, now);
    }

    if (round.phase === 'over' && round.nextRoundAt !== null && now >= round.nextRoundAt) {
      return {
        state: { ...state, round: armedRound(round.number + 1, now, context) },
        events: [{ type: EVENTS.game.stateUpdated }],
      };
    }

    return still(state);
  },

  nextTickAt(state) {
    if (state.complete || state.paused) return null;

    switch (state.round.phase) {
      case 'arming':
        return state.round.liveAt;
      case 'live':
        return state.round.deadline;
      case 'over':
        return state.round.nextRoundAt;
    }
  },

  // Nobody is ever on the clock to move here. Both players are waiting on the same stimulus, and
  // being slow to it is what the game measures rather than something to be timed out for.
  turnOf() {
    return null;
  },

  pause(state, _now) {
    if (state.complete) return state;

    // A round nobody could see must not be scored, so whatever was in flight is thrown away. If the
    // round had already resolved, the next one is the one waiting to be armed.
    const next = state.round.phase === 'over' ? state.round.number + 1 : state.round.number;
    return { ...state, paused: true, round: pausedRound(next) };
  },

  resume(state, now, context) {
    if (state.complete) return still(state);

    // A fresh arming delay, so the player who waited cannot have learned the timing of the round
    // that was interrupted.
    return {
      state: { ...state, paused: false, round: armedRound(state.round.number, now, context) },
      events: [{ type: EVENTS.game.stateUpdated }],
    };
  },

  getView(state, player) {
    const them = opponentOf(player);
    const bests = state.history
      .map((round) => round.taps[player]?.reactionMs)
      .filter((value): value is number => value !== undefined && value > 0);

    return {
      rounds: ROUNDS,
      roundNumber: state.round.number,
      yourRoundsWon: state.roundsWon[player],
      theirRoundsWon: state.roundsWon[them],
      current: roundView(state.round, player),
      history: state.history.map((round) => roundView(round, player)),
      youTapped: state.round.taps[player] !== null || state.round.falseStart[player],
      yourBestMs: bests.length > 0 ? Math.round(Math.min(...bests)) : null,
      paused: state.paused,
      complete: state.complete,
    };
  },

  isComplete(state) {
    return state.complete;
  },

  getResult(state): GameResult {
    const [wonA, wonB] = state.roundsWon;
    return {
      winner: wonA === wonB ? null : wonA > wonB ? 0 : 1,
      draw: wonA === wonB,
      // Rounds won, not milliseconds: `matches.score_a` is an authoritative score where higher is
      // always better, and the fastest reaction is the lowest number.
      scores: [wonA, wonB],
    };
  },
};
