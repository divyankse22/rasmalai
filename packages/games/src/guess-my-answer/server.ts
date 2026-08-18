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
  OPTIONS,
  QUESTIONS,
  ROUNDS,
  type GuessMyAnswerAction,
  type GuessMyAnswerView,
  type Question,
  type RoundRecap,
  type Role,
} from './protocol';

/**
 * Guess My Answer, decided entirely on the server.
 *
 * ```text
 * six questions drawn server-side → server coin-flips who answers first
 *   → one of you answers about yourself, the other guesses what you said — at the same time,
 *     in secret, neither waiting on the other
 *   → both in → the round opens and the guess is right or it is not
 *   → both say "next" → the roles swap and the next question comes up
 *   → six rounds → how well each of you read the other
 * ```
 *
 * **Simultaneous and secret** is the shape this game adds. Three games in, every one of them had
 * either a strict turn order or a shared stimulus; here both seats act at once and neither is shown
 * anything until they both have. `theyHaveChosen` on the view is the whole compromise: the fact
 * travels immediately, because a screen that looks frozen while your partner thinks is a bad
 * screen, and the choice does not travel at all until the round opens.
 *
 * **It asks the platform for no clock.** Like Four in a Row, `nextTickAt` is null throughout: there
 * is nothing to run down, and a social game between two people is the last place to put a
 * stopwatch on an answer about yourself. `turnOf` still names the person holding things up once
 * their partner is in, so somebody who wanders off mid-question is on the ordinary 120 seconds.
 *
 * Nothing here reads a clock, holds a socket, or knows a user id. Seats `0` and `1`, six questions,
 * and who is answering which.
 */

interface RoundState {
  number: number;
  /** Index into `QUESTIONS`. */
  question: number;
  answerer: PlayerIndex;
  /** The answerer's real answer, and the guesser's guess. Option indices. */
  answer: number | null;
  guess: number | null;
  revealed: boolean;
  /** Who has asked to move on. Meaningless before the reveal. */
  next: [boolean, boolean];
}

export interface GuessMyAnswerState {
  /** The six questions this match drew, in order. */
  questions: number[];
  round: RoundState;
  /** Every round that has been read and moved past, oldest first. */
  history: RoundState[];
  /** Per seat: how many times **that seat** guessed their partner correctly. */
  correct: [number, number];
  complete: boolean;
}

/**
 * Six distinct questions, in a server-decided order.
 *
 * Distinct matters more than it looks: the same question twice in one evening, with the roles
 * swapped, is the one way this game can accidentally test whether somebody remembers what their
 * partner said four minutes ago rather than what they know about them.
 */
function drawQuestions(context: GameContext): number[] {
  const pool = QUESTIONS.map((_, index) => index);

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.min(Math.floor(context.random() * (index + 1)), index);
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }

  return pool.slice(0, ROUNDS);
}

function openRound(number: number, question: number, answerer: PlayerIndex): RoundState {
  return {
    number,
    question,
    answerer,
    answer: null,
    guess: null,
    revealed: false,
    next: [false, false],
  };
}

const questionOf = (round: RoundState): Question => QUESTIONS[round.question]!;

const roleOf = (round: RoundState, player: PlayerIndex): Role =>
  round.answerer === player ? 'answering' : 'guessing';

/** What that seat has locked in this round, whichever side of the question they are on. */
const choiceOf = (round: RoundState, player: PlayerIndex): number | null =>
  round.answerer === player ? round.answer : round.guess;

function still(state: GuessMyAnswerState): Transition<GuessMyAnswerState> {
  return { state, events: [] };
}

function recapOf(round: RoundState, player: PlayerIndex): RoundRecap {
  const question = questionOf(round);
  const youGuessed = round.answerer !== player;

  return {
    number: round.number,
    // The recap is read back after the fact, so it is phrased from the reader's side exactly as the
    // question was when they were looking at it.
    question: youGuessed ? question.theirs : question.mine,
    answer: question.options[round.answer ?? 0] ?? '',
    guess: question.options[round.guess ?? 0] ?? '',
    correct: round.answer === round.guess,
    youGuessed,
  };
}

export const rules: GameRules<GuessMyAnswerState, GuessMyAnswerAction, GuessMyAnswerView> = {
  meta,

  reconnectPolicy: {
    windowMs: RECONNECT_WINDOW_MS,
    // Nothing is running down, and a locked-in answer must survive: throwing it away would make
    // somebody answer the same question about themselves twice, having already seen it.
    pauseOnDisconnect: false,
    // Two minutes is long enough that this is walking out, not bad wifi.
    onExpire: 'forfeit',
  },

  createMatch(_now, context) {
    // Questions first, then the coin-flip, so the two draws are never confused for each other in a
    // test that stubs the sequence.
    const questions = drawQuestions(context);
    const answerer: PlayerIndex = context.random() < 0.5 ? 0 : 1;

    return {
      questions,
      round: openRound(1, questions[0]!, answerer),
      history: [],
      correct: [0, 0],
      complete: false,
    };
  },

  validateAction(state, player, action): ValidationResult<GuessMyAnswerAction> {
    if (state.complete) {
      return { ok: false, code: 'invalid_game_state', message: 'That game is already over.' };
    }

    const candidate = action as Partial<GuessMyAnswerAction> | null;
    if (!candidate || typeof candidate.round !== 'number') {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    // A frame carrying a round we have moved past lost a race with the server. Dropping it is the
    // point: an answer must never land on the question that replaced the one it was written for.
    if (candidate.round !== state.round.number) {
      return { ok: false, code: 'invalid_action', message: 'That question has already gone.' };
    }

    if (candidate.type === 'next') {
      if (!state.round.revealed) {
        return { ok: false, code: 'invalid_action', message: 'Nobody has answered yet.' };
      }
      if (state.round.next[player]) {
        return { ok: false, code: 'invalid_action', message: 'You are already waiting on them.' };
      }
      return { ok: true, action: { type: 'next', round: candidate.round } };
    }

    if (candidate.type !== 'choose') {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    const option = candidate.option;
    if (
      typeof option !== 'number' ||
      !Number.isInteger(option) ||
      option < 0 ||
      option >= OPTIONS
    ) {
      return { ok: false, code: 'invalid_action', message: 'That is not one of the answers.' };
    }

    if (state.round.revealed) {
      return { ok: false, code: 'invalid_action', message: 'That question has already gone.' };
    }

    // No changing your mind. Both of you are choosing at once and neither has seen the other, so a
    // second choice could only ever be a second bite at a question you have already committed to.
    if (choiceOf(state.round, player) !== null) {
      return { ok: false, code: 'invalid_action', message: 'You have already locked that in.' };
    }

    return { ok: true, action: { type: 'choose', round: candidate.round, option } };
  },

  applyAction(state, player, action, _at, _context) {
    const round = state.round;

    if (action.type === 'next') {
      const next: [boolean, boolean] = player === 0 ? [true, round.next[1]] : [round.next[0], true];

      // One of them is ready: tell both, so the other sees they are being waited on.
      if (!next[0] || !next[1]) {
        return {
          state: { ...state, round: { ...round, next } },
          events: [{ type: EVENTS.game.stateUpdated }],
        };
      }

      // Both. On to the next question, with the roles swapped — three each, guaranteed, rather than
      // left to a coin that could hand somebody five.
      const number = round.number + 1;
      return {
        state: {
          ...state,
          round: openRound(number, state.questions[number - 1]!, opponentOf(round.answerer)),
          history: [...state.history, { ...round, next }],
        },
        events: [{ type: EVENTS.game.roundStarted }],
      };
    }

    const answering = round.answerer === player;
    const answer = answering ? action.option : round.answer;
    const guess = answering ? round.guess : action.option;

    // Only one of them is in. Both are told *that* it happened and neither is told what it was.
    if (answer === null || guess === null) {
      return {
        state: { ...state, round: { ...round, answer, guess } },
        events: [{ type: EVENTS.game.stateUpdated }],
      };
    }

    const guesser = opponentOf(round.answerer);
    const correct: [number, number] = [...state.correct];
    if (answer === guess) correct[guesser] += 1;

    const wasLast = round.number >= ROUNDS;
    const revealed: RoundState = { ...round, answer, guess, revealed: true };

    const events: GameEvent[] = [{ type: EVENTS.game.roundEnded }];
    if (wasLast) events.push({ type: EVENTS.game.finished });

    return {
      state: {
        ...state,
        round: revealed,
        // The last round is not waited on: there is no next question to move to, so the reveal is
        // also the end of the match and the results screen keeps it on display.
        history: wasLast ? [...state.history, revealed] : state.history,
        correct,
        complete: wasLast,
      },
      events,
    };
  },

  // Turn-based in the loose sense: the game is always waiting on a person, never on the clock.
  tick(state) {
    return still(state);
  },

  nextTickAt() {
    return null;
  },

  /**
   * Whoever is being waited *on* — which, in a game where both act at once, is nobody until one of
   * them is in.
   *
   * Naming a seat while both are still deciding would put one of them on a 120-second clock for no
   * reason other than being seat 0. Naming the straggler once their partner has committed is
   * exactly the case the clock exists for: somebody who wandered off mid-question.
   */
  turnOf(state) {
    if (state.complete) return null;
    const round = state.round;

    if (round.revealed) {
      const [a, b] = round.next;
      if (a === b) return null;
      return a ? 1 : 0;
    }

    const zero = choiceOf(round, 0) !== null;
    const one = choiceOf(round, 1) !== null;
    if (zero === one) return null;
    return zero ? 1 : 0;
  },

  // Nothing is in flight to discard — a choice already locked in is a fact, and the platform refuses
  // actions while a player is missing anyway. These exist because the contract asks every game for
  // them, and doing nothing is the correct answer.
  pause(state) {
    return state;
  },

  resume(state) {
    return still(state);
  },

  getView(state, player) {
    const round = state.round;
    const question = questionOf(round);
    const role = roleOf(round, player);
    const them = opponentOf(player);

    return {
      rounds: ROUNDS,
      roundNumber: round.number,
      prompt: role === 'answering' ? question.mine : question.theirs,
      options: question.options,
      yourRole: role,
      yourChoice: choiceOf(round, player),
      // The fact, never the choice — the one line in this file that makes the game a game.
      theyHaveChosen: choiceOf(round, them) !== null,
      revealed: round.revealed,
      answer: round.revealed ? round.answer : null,
      guess: round.revealed ? round.guess : null,
      correct: round.revealed ? round.answer === round.guess : null,
      youReady: round.next[player],
      theyReady: round.next[them],
      yourCorrect: state.correct[player],
      theirCorrect: state.correct[them],
      history: state.history.map((past) => recapOf(past, player)),
      complete: state.complete,
    };
  },

  isComplete(state) {
    return state.complete;
  },

  getResult(state): GameResult {
    return {
      // P-3: nobody beats anybody here, whatever the numbers say. The platform reads
      // `scoringKind` and renders "played together"; naming a winner would be this module
      // overruling a product decision it is not allowed an opinion on.
      winner: null,
      draw: false,
      // Still worth carrying: it is what the seven-day history shows, and "you read them 3, they
      // read you 1" is the point of having played.
      scores: [state.correct[0], state.correct[1]],
    };
  },
};
