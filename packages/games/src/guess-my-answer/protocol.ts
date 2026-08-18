/**
 * What crosses the wire for Guess My Answer. Safe for the browser: no rules, and no choice the
 * reader has not earned the right to see.
 *
 * Everything is resolved to one reader's point of view — `you` and `them` — exactly as `SessionView`
 * is, so a renderer never has to work out which seat it is drawing for.
 */

/** Six questions: three where you answer, three where you guess. Long enough to be a game, short
 * enough to be an evening rather than a quiz night. */
export const ROUNDS = 6;

/** Every question offers exactly this many options, so the board never changes shape. */
export const OPTIONS = 4;

/**
 * One question, in both directions.
 *
 * Two phrasings rather than one with a name substituted in: the game module is not allowed to know
 * anybody's name (that is the platform's, and the renderer already has it), and "Their perfect
 * Sunday" reads better than "Alice's perfect Sunday" anyway.
 */
export interface Question {
  /** How it reads to the person answering about themselves. */
  mine: string;
  /** How it reads to the person guessing. */
  theirs: string;
  options: readonly string[];
}

/**
 * The question bank.
 *
 * Public, like Memory's deck: knowing the questions exist is not knowing what your partner answered,
 * and the whole game is the second one. Deliberately gentle — `docs/01` section 8 asks for cute and
 * playful, and a social game between two people who like each other is the wrong place for a
 * question that can start an argument.
 */
export const QUESTIONS: readonly Question[] = [
  {
    mine: 'My perfect Sunday is…',
    theirs: 'Their perfect Sunday is…',
    options: ['Sleeping in', 'Out for food', 'Somewhere new', 'Doing absolutely nothing'],
  },
  {
    mine: 'The snack I would steal off your plate is…',
    theirs: 'The snack they would steal off your plate is…',
    options: ['Something fried', 'Something sweet', 'The last bite', 'All of it'],
  },
  {
    mine: 'If I had a free afternoon I would…',
    theirs: 'With a free afternoon they would…',
    options: ['Nap', 'Go for a walk', 'Start a project', 'Text you'],
  },
  {
    mine: 'The thing I am worst at is…',
    theirs: 'The thing they are worst at is…',
    options: ['Waking up', 'Directions', 'Waiting', 'Letting things go'],
  },
  {
    mine: 'I would rather be…',
    theirs: 'They would rather be…',
    options: ['Too warm', 'Too cold', 'Too early', 'Too full'],
  },
  {
    mine: 'My comfort watch is…',
    theirs: 'Their comfort watch is…',
    options: ['Something funny', 'Something old', 'Something loud', 'Whatever you pick'],
  },
  {
    mine: 'On a long drive I am the one who…',
    theirs: 'On a long drive they are the one who…',
    options: ['Drives', 'Picks the music', 'Falls asleep', 'Gets hungry first'],
  },
  {
    mine: 'The first thing I notice in a room is…',
    theirs: 'The first thing they notice in a room is…',
    options: ['The food', 'The people', 'The exit', 'The temperature'],
  },
  {
    mine: 'I am most myself…',
    theirs: 'They are most themselves…',
    options: ['Early morning', 'Late at night', 'Mid-afternoon', 'Whenever you are around'],
  },
  {
    mine: 'The chore I quietly avoid is…',
    theirs: 'The chore they quietly avoid is…',
    options: ['Dishes', 'Laundry', 'Replying to messages', 'Anything with a phone call'],
  },
  {
    mine: 'If we won a small amount of money I would…',
    theirs: 'With a small windfall they would…',
    options: ['Save it', 'Book a trip', 'Buy you something', 'Spend it that day'],
  },
  {
    mine: 'My love language is closest to…',
    theirs: 'Their love language is closest to…',
    options: ['Being fed', 'Being told', 'Being helped', 'Being nearby'],
  },
  {
    mine: 'I would survive longest without…',
    theirs: 'They would survive longest without…',
    options: ['Coffee', 'My phone', 'A plan', 'Sleep'],
  },
  {
    mine: 'The photo of us I would keep is…',
    theirs: 'The photo of you two they would keep is…',
    options: ['The posed one', 'The blurry one', 'The one mid-laugh', 'The one nobody has seen'],
  },
] as const;

/** Which side of a question a seat is on this round. */
export type Role = 'answering' | 'guessing';

/** One finished round, as this reader sees it. Only ever produced after the reveal. */
export interface RoundRecap {
  number: number;
  question: string;
  /** What the answerer actually picked. */
  answer: string;
  /** What the guesser said they would pick. */
  guess: string;
  correct: boolean;
  /** Whether the reader was the one guessing — the recap reads differently from each side. */
  youGuessed: boolean;
}

export interface GuessMyAnswerView {
  rounds: number;
  roundNumber: number;
  /** The question, already phrased for this reader's side of it. */
  prompt: string;
  options: readonly string[];
  yourRole: Role;
  /**
   * What you picked this round, or null before you have.
   *
   * Your own choice comes back to you immediately — you made it, so withholding it would only make
   * the screen look broken.
   */
  yourChoice: number | null;
  /**
   * Whether they have locked something in.
   *
   * The *fact*, never the choice. Knowing your partner has answered is what stops the screen looking
   * frozen; knowing what they answered would be the whole game.
   */
  theyHaveChosen: boolean;
  /** Both are in and the round is open. Until then nothing about their pick is on the wire. */
  revealed: boolean;
  /** Set once revealed: what the answerer really picked. */
  answer: number | null;
  /** Set once revealed: what the guesser went with. */
  guess: number | null;
  /** Set once revealed: whether the guesser got it. */
  correct: boolean | null;
  /** Whether you have asked to move on, and whether they have. */
  youReady: boolean;
  theyReady: boolean;
  /** How many times you read them right, and they read you right. */
  yourCorrect: number;
  theirCorrect: number;
  history: RoundRecap[];
  complete: boolean;
}

/** Locking in a pick — your own answer if you are answering, your guess if you are not. */
export interface ChooseAction {
  type: 'choose';
  round: number;
  option: number;
}

/** "I have read it, move on." Both have to say so, so nobody skips a reveal for the other. */
export interface NextAction {
  type: 'next';
  round: number;
}

export type GuessMyAnswerAction = ChooseAction | NextAction;
