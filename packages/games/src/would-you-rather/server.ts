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
import { DECK, DIFFICULTIES, bandForRound, type Axis } from './deck';
import { meta } from './meta';
import {
  ASKS_EACH,
  CANDIDATES,
  ROUNDS,
  type AnswererView,
  type AskerView,
  type Dilemma,
  type Option,
  type WouldYouRatherAction,
  type WouldYouRatherPhase,
  type WouldYouRatherRecap,
  type WouldYouRatherView,
} from './protocol';

/**
 * Would You Rather — the authoritative rulebook. Pure: no clock, no sockets, no randomness of its
 * own. Every moment arrives as an argument and every coin comes from `context.random()`.
 *
 * The whole game is one asymmetry, and it is enforced in one place. `getView` forks on the seat and
 * hands back two structurally different objects:
 *
 *   - the Asker sees three dilemmas, and bets on the answer without being shown it;
 *   - the Answerer sees the one that was chosen, and is never told another existed.
 *
 * The order of the middle two phases is what makes the reveal honest. The answer is recorded first
 * and the prediction second, so the Asker is always betting against something already decided. A
 * design that took the prediction first would be asking the Answerer to react to a guess they could
 * see — and would also be Guess My Answer with extra steps.
 *
 * Known stall, inherited from the Guess My Answer precedent: if both of them go idle on a reveal
 * while still connected, `turnOf` names nobody and no clock runs. Accepted rather than papered over
 * with a second timer.
 */

const axisOf = (index: number): Axis => DECK[index]!.axis;
const difficultyOf = (index: number): number => DECK[index]!.difficulty;

/** Two sentences and a prompt. The only function that reads `DECK` into something a client sees. */
const dilemmaOf = (index: number): Dilemma => {
  const entry = DECK[index]!;
  // Rebuilt field by field rather than spread-and-delete, so a field added to `Dilemma` in `deck.ts`
  // is withheld by default instead of leaking the first time somebody forgets.
  return { prompt: entry.prompt, optionA: entry.optionA, optionB: entry.optionB };
};

/**
 * Where in the remaining pool the next candidate comes from — as a position, and never a throw.
 *
 * Preference, strongest first: inside the band on an unused axis; inside the band at all; the band
 * widened one step at a time, each width trying the new-axis form first; then whatever is next off
 * the shuffled pile.
 *
 * That last fallback is unreachable with the deck as it stands — `deck.test` holds every band to
 * more unused cards than a whole match can consume — and it exists anyway because the deck is meant
 * to be extended by editing an array, which is exactly the kind of edit that tips a band over
 * without anybody noticing. Sliding one difficulty step is a worse round; an exception is not a
 * round at all, and a rulebook that can throw is one that can end an evening with a stack trace.
 */
function nextCard(
  pool: readonly number[],
  low: number,
  high: number,
  axes: ReadonlySet<Axis>,
): number {
  for (let widen = 0; widen <= DIFFICULTIES; widen += 1) {
    const lo = Math.max(1, low - widen);
    const hi = Math.min(DIFFICULTIES, high + widen);
    const within = (index: number) => difficultyOf(index) >= lo && difficultyOf(index) <= hi;

    const fresh = pool.findIndex((index) => within(index) && !axes.has(axisOf(index)));
    if (fresh !== -1) return fresh;

    const any = pool.findIndex(within);
    if (any !== -1) return any;
  }

  return 0;
}

/**
 * The whole match's deal: `ROUNDS` triples, each from that round's difficulty band, each pulling on
 * three different axes.
 *
 * Drawn once rather than a triple at a time, for two reasons. "No dilemma twice in one match"
 * becomes **structural** — every index is spliced out of one shuffled pool the moment it is taken,
 * so a repeat is unreachable rather than prevented by a check somebody could get wrong. And a test
 * can stub `context.random()` for a whole match in one sequence instead of interleaving draws with
 * moves.
 */
export function deal(context: GameContext): number[][] {
  // Fisher-Yates over the whole deck, from the server's randomness and nowhere else. `Math.min`
  // guards a `random()` that returns exactly 1 — a stub in a test, or a source swapped in later.
  const pool = DECK.map((_, index) => index);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.min(Math.floor(context.random() * (index + 1)), index);
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }

  const rounds: number[][] = [];

  for (let number = 1; number <= ROUNDS; number += 1) {
    const [low, high] = bandForRound(number, ROUNDS);
    const axes = new Set<Axis>();
    const triple: number[] = [];

    while (triple.length < CANDIDATES) {
      const [index] = pool.splice(nextCard(pool, low, high, axes), 1);
      axes.add(axisOf(index!));
      triple.push(index!);
    }

    rounds.push(triple);
  }

  return rounds;
}

interface RoundState {
  number: number;
  asker: PlayerIndex;
  /** A **position** in `deal[number - 1]`, not a deck index. */
  selected: number | null;
  answer: Option | null;
  prediction: Option | null;
  phase: WouldYouRatherPhase;
  /** Who has asked to move on. Meaningless before the reveal. */
  next: [boolean, boolean];
}

export interface WouldYouRatherState {
  /** Every round's three candidates as deck indices, oldest first. `deal[n - 1]` is round `n`. */
  deal: number[][];
  round: RoundState;
  /** Every round that has been read and moved past, oldest first. */
  history: RoundState[];
  /** Per seat: how many predictions **that seat** called right while asking. */
  correct: [number, number];
  complete: boolean;
}

function openRound(number: number, asker: PlayerIndex): RoundState {
  return {
    number,
    asker,
    selected: null,
    answer: null,
    prediction: null,
    phase: 'selecting',
    next: [false, false],
  };
}

function still(state: WouldYouRatherState): Transition<WouldYouRatherState> {
  return { state, events: [] };
}

const candidatesOf = (state: WouldYouRatherState, round: RoundState): number[] =>
  state.deal[round.number - 1]!;

/** The dilemma in play, or null before the Asker has taken one. */
function chosenOf(state: WouldYouRatherState, round: RoundState): Dilemma | null {
  if (round.selected === null) return null;
  return dilemmaOf(candidatesOf(state, round)[round.selected]!);
}

function recapOf(
  state: WouldYouRatherState,
  round: RoundState,
  player: PlayerIndex,
): WouldYouRatherRecap {
  return {
    number: round.number,
    // `history` only ever holds revealed rounds, so these are non-null by construction. The
    // fallbacks are for the compiler, not for a case that happens.
    dilemma: chosenOf(state, round) ?? { prompt: '', optionA: '', optionB: '' },
    youAsked: round.asker === player,
    answer: round.answer ?? 0,
    prediction: round.prediction ?? 0,
    correct: round.answer === round.prediction,
  };
}

/** Everything both of them are told. Every secret here is gated on `phase`, and on nothing else. */
function sharedView(state: WouldYouRatherState, player: PlayerIndex) {
  const round = state.round;
  const them = opponentOf(player);
  const revealed = round.phase === 'revealed';

  return {
    rounds: ROUNDS,
    roundNumber: round.number,
    phase: round.phase,
    asksEach: ASKS_EACH,
    // Gated on the phase, never on whether the field happens to be populated. `round.answer` is set
    // the moment the Answerer commits — a whole phase before the Asker is allowed it.
    answer: revealed ? round.answer : null,
    prediction: revealed ? round.prediction : null,
    correct: revealed ? round.answer === round.prediction : null,
    youReady: round.next[player],
    theyReady: round.next[them],
    yourCorrect: state.correct[player],
    theirCorrect: state.correct[them],
    history: state.history.map((past) => recapOf(state, past, player)),
    complete: state.complete,
  };
}

/**
 * What the Asker is allowed to see: three dilemmas until they take one, then the one they took —
 * and **never the answer** until their prediction is in. An Asker who could read the answer first
 * would call three out of three every time, and there would be nothing to be good at.
 *
 * The explicit `: AskerView` return annotation is load-bearing. It is what makes each object
 * literal below checked against one concrete type, where excess-property checking is unambiguous.
 * Inlining these two functions into `getView` and annotating the union instead would quietly
 * weaken the compile-time half of the guarantee to whatever discriminant narrowing does that week.
 */
function askerView(state: WouldYouRatherState, player: PlayerIndex): AskerView {
  const round = state.round;

  return {
    ...sharedView(state, player),
    yourRole: 'asking',
    // Positional. The server is the only thing that ever knows what sits behind a slot, in either
    // direction — a deck index never crosses the wire, and never comes back across it.
    candidates: candidatesOf(state, round).map(dilemmaOf),
    selected: round.selected,
    yourPrediction: round.prediction,
  };
}

/**
 * What the Answerer is allowed to see: one dilemma, and not a word about the two it beat.
 *
 * `AnswererView` has no `candidates` property — not a nullable one, none — so this function cannot
 * be edited into leaking them without failing the build. It cannot leak by phase either: the two
 * losers are absent at the reveal, and absent from `history`, because a recap carries only the
 * dilemma that was actually played.
 */
function answererView(state: WouldYouRatherState, player: PlayerIndex): AnswererView {
  const round = state.round;

  return {
    ...sharedView(state, player),
    yourRole: 'answering',
    // Null while the Asker is still choosing. Not a placeholder, and not a count: the Answerer is
    // not told how many they are being chosen between, only that they are.
    dilemma: chosenOf(state, round),
    yourAnswer: round.answer,
  };
}

const isOption = (value: unknown): value is Option => value === 0 || value === 1;

export const rules: GameRules<WouldYouRatherState, WouldYouRatherAction, WouldYouRatherView> = {
  meta,

  reconnectPolicy: {
    windowMs: RECONNECT_WINDOW_MS,
    // Nothing is running down. A locked-in answer must survive a dropped connection: throwing it
    // away would make somebody answer a dilemma twice, having already seen it and committed.
    pauseOnDisconnect: false,
    // Two minutes without a word is walking out, not bad wifi. Unlike Guess My Answer this has
    // teeth, because the game is competitive: the platform awards the win to whoever stayed.
    onExpire: 'forfeit',
  },

  createMatch(_now, context) {
    // The coin first, then the deal, so a test stubbing the sequence can tell the draws apart.
    const asker: PlayerIndex = context.random() < 0.5 ? 0 : 1;

    return {
      deal: deal(context),
      round: openRound(1, asker),
      history: [],
      correct: [0, 0],
      complete: false,
    };
  },

  validateAction(state, player, action): ValidationResult<WouldYouRatherAction> {
    if (state.complete) {
      return { ok: false, code: 'invalid_game_state', message: 'That game is already over.' };
    }

    const candidate = action as Partial<WouldYouRatherAction> | null;
    if (!candidate || typeof candidate.round !== 'number') {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    const round = state.round;

    // A frame carrying a round we have moved past lost a race with the server. Dropping it *first*
    // is what makes every check below safe: the roles swap every round, so a stale `select` would
    // otherwise be measured against the new round's asker — and could pass.
    if (candidate.round !== round.number) {
      return { ok: false, code: 'invalid_action', message: 'That one has already gone.' };
    }

    const asking = round.asker === player;

    if (candidate.type === 'select') {
      if (!asking) {
        return { ok: false, code: 'invalid_action', message: 'You are answering this one.' };
      }
      if (round.phase !== 'selecting') {
        return { ok: false, code: 'invalid_action', message: 'You have already picked one.' };
      }
      const slot = candidate.candidate;
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= CANDIDATES) {
        return { ok: false, code: 'invalid_action', message: 'That is not one of the three.' };
      }
      return { ok: true, action: { type: 'select', round: candidate.round, candidate: slot } };
    }

    if (candidate.type === 'answer') {
      if (asking) {
        return { ok: false, code: 'invalid_action', message: 'You are asking this one.' };
      }
      if (round.phase === 'selecting') {
        return { ok: false, code: 'invalid_action', message: 'They have not picked one yet.' };
      }
      if (round.phase !== 'answering') {
        return { ok: false, code: 'invalid_action', message: 'You have already answered.' };
      }
      if (!isOption(candidate.option)) {
        return { ok: false, code: 'invalid_action', message: 'That is not one of the two.' };
      }
      return {
        ok: true,
        action: { type: 'answer', round: candidate.round, option: candidate.option },
      };
    }

    if (candidate.type === 'predict') {
      if (!asking) {
        return { ok: false, code: 'invalid_action', message: 'You are answering this one.' };
      }
      // The refusal that is actually load-bearing. `predicting` is reached only once the answer is
      // in, so a prediction can never arrive before the thing it predicts — and the Asker's view has
      // nothing in it to predict *from* until then. Two fences, one enum.
      if (round.phase === 'selecting' || round.phase === 'answering') {
        return { ok: false, code: 'invalid_action', message: 'They have not answered yet.' };
      }
      if (round.phase !== 'predicting') {
        return { ok: false, code: 'invalid_action', message: 'You have already called it.' };
      }
      if (!isOption(candidate.option)) {
        return { ok: false, code: 'invalid_action', message: 'That is not one of the two.' };
      }
      return {
        ok: true,
        action: { type: 'predict', round: candidate.round, option: candidate.option },
      };
    }

    if (candidate.type === 'next') {
      if (round.phase !== 'revealed') {
        return { ok: false, code: 'invalid_action', message: 'Nothing has been revealed yet.' };
      }
      if (round.next[player]) {
        return { ok: false, code: 'invalid_action', message: 'You are already waiting on them.' };
      }
      return { ok: true, action: { type: 'next', round: candidate.round } };
    }

    return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
  },

  applyAction(state, player, action, _at, _context) {
    const round = state.round;

    if (action.type === 'select') {
      return {
        state: { ...state, round: { ...round, selected: action.candidate, phase: 'answering' } },
        events: [{ type: EVENTS.game.stateUpdated }],
      };
    }

    if (action.type === 'answer') {
      // Both are told the shape of the state changed. Neither frame says which way it went: the
      // Asker's view gates `answer` on the phase, which is now `predicting`, not `revealed`.
      return {
        state: { ...state, round: { ...round, answer: action.option, phase: 'predicting' } },
        events: [{ type: EVENTS.game.stateUpdated }],
      };
    }

    if (action.type === 'predict') {
      const correct: [number, number] = [...state.correct];
      // The Asker is the predictor, so the point is theirs.
      if (action.option === round.answer) correct[round.asker] += 1;

      const wasLast = round.number >= ROUNDS;
      const revealed: RoundState = { ...round, prediction: action.option, phase: 'revealed' };

      const events: GameEvent[] = [{ type: EVENTS.game.roundEnded }];
      if (wasLast) events.push({ type: EVENTS.game.finished });

      return {
        state: {
          ...state,
          round: revealed,
          // The last round is never waited on: the reveal is also the end of the match, and the
          // results screen keeps it on display.
          history: wasLast ? [...state.history, revealed] : state.history,
          correct,
          complete: wasLast,
        },
        events,
      };
    }

    const next: [boolean, boolean] = player === 0 ? [true, round.next[1]] : [round.next[0], true];

    // One of them is ready: tell both, so the other sees they are being waited on.
    if (!next[0] || !next[1]) {
      return {
        state: { ...state, round: { ...round, next } },
        events: [{ type: EVENTS.game.stateUpdated }],
      };
    }

    // Both. On to the next dilemma with the roles swapped — three each, guaranteed, rather than
    // left to a coin that could hand somebody five turns at being the cruel one.
    return {
      state: {
        ...state,
        round: openRound(round.number + 1, opponentOf(round.asker)),
        history: [...state.history, { ...round, next }],
      },
      events: [{ type: EVENTS.game.roundStarted }],
    };
  },

  // Turn-based in the loose sense: always waiting on a person, never on the clock.
  tick(state) {
    return still(state);
  },

  nextTickAt() {
    return null;
  },

  /**
   * Whoever is holding things up.
   *
   * Simpler than Guess My Answer's, because the machine is sequential: there is always exactly one
   * person the game is waiting on, except in the moment after a reveal when both are reading. The
   * platform's 120-second move clock is the only clock this game asks for, and that is the point —
   * a stopwatch on "which of these two would you actually do" would change the answers.
   */
  turnOf(state) {
    if (state.complete) return null;
    const round = state.round;

    if (round.phase === 'selecting' || round.phase === 'predicting') return round.asker;
    if (round.phase === 'answering') return opponentOf(round.asker);

    // Revealed: nobody is late at the instant of a reveal, because both of them are reading it.
    const [zero, one] = round.next;
    if (zero === one) return null;
    return zero ? 1 : 0;
  },

  // Nothing is in flight to discard. A selection already made is a fact, an answer already given is
  // a fact, and the platform refuses every action while somebody is missing anyway. These exist
  // because the contract asks every game for them, and doing nothing is the correct answer.
  pause(state) {
    return state;
  },

  resume(state) {
    return still(state);
  },

  getView(state, player): WouldYouRatherView {
    // The fork is on the **seat**, and on nothing connection-scoped. Seats are fixed when the
    // session is created, so a reconnect cannot land the Answerer in the Asker's branch.
    return state.round.asker === player ? askerView(state, player) : answererView(state, player);
  },

  isComplete(state) {
    return state.complete;
  },

  getResult(state): GameResult {
    const [zero, one] = state.correct;

    return {
      // Unlike Guess My Answer, this game names a winner. `scoringKind` is `competitive`, and the
      // reason is in `meta.ts`: the Asker chose the ground before they placed the bet.
      winner: zero === one ? null : zero > one ? 0 : 1,
      draw: zero === one,
      scores: [zero, one],
    };
  },
};
