/**
 * What crosses the wire for Would You Rather. Safe for the browser: no rules, no deck, and nothing
 * the reader has not earned the right to see.
 *
 * **The deck is deliberately not here.** Guess My Answer publishes its fourteen questions in its
 * protocol, and that is right for that game: both seats are handed the same question anyway, so
 * knowing the bank exists costs nothing. This game is the opposite. The Asker is shown three
 * dilemmas and the Answerer must see exactly one, so a deck in the browser bundle would put the
 * other two on the Answerer's machine and leave the secret resting on the renderer's good manners.
 * It lives in `deck.ts`, which `packages/games/package.json` does not publish and the web app's
 * eslint config forbids. The axis and the difficulty never cross at all.
 */

/** Six dilemmas: three you set, three you answer. */
export const ROUNDS = 6;

/** How many the Asker chooses between. Three is a choice; two is a coin flip. */
export const CANDIDATES = 3;

/** Two sides to every dilemma, always, and neither of them is the right one. */
export const OPTIONS = 2;

/** How many rounds each of them spends asking — the denominator of the score. */
export const ASKS_EACH = ROUNDS / 2;

/** A side of a dilemma. The client never names them; it draws position 0 and position 1. */
export type Option = 0 | 1;

/** Which side of the table a seat is on this round. */
export type WouldYouRatherRole = 'asking' | 'answering';

/**
 * Where the round is — **and the only gate on any secret in this game.**
 *
 * Strictly sequential: nothing skips, nothing runs backwards, and every phase has exactly one
 * person in it. No view field is derived from whether a secret happens to be filled in yet; every
 * one of them is gated on this enum instead. `round.answer` is set a whole phase before the Asker
 * is allowed to see it, so "is it null yet" is precisely the wrong question, and asking it is how
 * this game would leak.
 */
export type WouldYouRatherPhase = 'selecting' | 'answering' | 'predicting' | 'revealed';

/**
 * One dilemma as it crosses the wire: a prompt and two sides.
 *
 * No id, no axis, no difficulty. An Answerer who could read that their dilemma is rated 5 knows
 * something the game is built on them not knowing, and an axis label turns a conversation into a
 * personality quiz — which `docs/01` section 8 and this game's own spec both refuse.
 */
export interface Dilemma {
  prompt: string;
  optionA: string;
  optionB: string;
}

/**
 * One finished round, as this reader sees it.
 *
 * Deliberately the *same* for both of them apart from `youAsked`: the two dilemmas the Asker turned
 * down are in here for neither reader. The Answerer is never entitled to them, and the Asker does
 * not need them twice — a recap that forked would be a second place this game could leak from.
 */
export interface WouldYouRatherRecap {
  number: number;
  dilemma: Dilemma;
  /** Whether the reader was the one asking. It reads differently from each side. */
  youAsked: boolean;
  /** What the Answerer really took. */
  answer: Option;
  /** What the Asker predicted they would take. */
  prediction: Option;
  correct: boolean;
}

/** What both of them are told, whichever side they are on. */
interface Shared {
  rounds: number;
  roundNumber: number;
  phase: WouldYouRatherPhase;
  /** Out of this many each, so the client never divides `rounds` by two itself. */
  asksEach: number;
  /** Set at the reveal and not one moment before, for either reader. */
  answer: Option | null;
  prediction: Option | null;
  correct: boolean | null;
  youReady: boolean;
  theyReady: boolean;
  /** Correct predictions you made while asking, and they made while asking. */
  yourCorrect: number;
  theirCorrect: number;
  history: readonly WouldYouRatherRecap[];
  complete: boolean;
}

export interface AskerView extends Shared {
  yourRole: 'asking';
  /** The three you were dealt, positionally. */
  candidates: readonly Dilemma[];
  /** Which of the three you took, by position, or null before you have. */
  selected: number | null;
  /** Your own prediction, straight back to you — you made it. */
  yourPrediction: Option | null;
}

export interface AnswererView extends Shared {
  yourRole: 'answering';
  /**
   * The one they chose, and null while they are still choosing.
   *
   * **There is no `candidates` field on this type. Not a nullable one: none.** That is the highest
   * priority correctness property in this game, and expressing it as an absent property rather than
   * a null one is what makes a leak fail the build instead of failing a test.
   */
  dilemma: Dilemma | null;
  /** Your own answer, straight back to you. */
  yourAnswer: Option | null;
}

export type WouldYouRatherView = AskerView | AnswererView;

/** Asker to server: "that one, of the three." Positional — deck indices never leave the server. */
export interface SelectAction {
  type: 'select';
  round: number;
  candidate: number;
}

/** Answerer to server: which side they would actually take. */
export interface AnswerAction {
  type: 'answer';
  round: number;
  option: Option;
}

/** Asker to server: which side they think their partner took. */
export interface PredictAction {
  type: 'predict';
  round: number;
  option: Option;
}

/** "I have read it." Both have to say so, so neither skips a reveal for the other. */
export interface WouldYouRatherNextAction {
  type: 'next';
  round: number;
}

export type WouldYouRatherAction =
  | SelectAction
  | AnswerAction
  | PredictAction
  | WouldYouRatherNextAction;
