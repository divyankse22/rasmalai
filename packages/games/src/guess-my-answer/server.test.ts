import { describe, expect, it } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import type { GameContext, PlayerIndex, Transition } from '../contract';
import { OPTIONS, QUESTIONS, ROUNDS } from './protocol';
import { rules, type GuessMyAnswerState } from './server';

/**
 * The rules are pure, so six questions are played out here with no timers and no sockets.
 *
 * What this file is really checking is the thing that makes the game a game: that a choice does not
 * travel until both of them have made one. Everything else — who answers which question, who gets
 * the point, when the roles swap — is arithmetic, and arithmetic is testable.
 */

/** Seat 0 answers first: the coin-flip is drawn after the questions, so zeroes answer both. */
const context: GameContext = { random: () => 0 };

const ALICE: PlayerIndex = 0;
const BOB: PlayerIndex = 1;

const AT = { receivedAt: 0, compensationMs: 0 };

const fresh = (draw: GameContext = context) => rules.createMatch(0, draw);

function act(
  state: GuessMyAnswerState,
  player: PlayerIndex,
  action: unknown,
): Transition<GuessMyAnswerState> {
  const validation = rules.validateAction(state, player, action);
  if (!validation.ok) throw new Error(`refused: ${validation.code} — ${validation.message}`);
  return rules.applyAction(state, player, validation.action, AT, context);
}

const choose = (state: GuessMyAnswerState, player: PlayerIndex, option: number) =>
  act(state, player, { type: 'choose', round: state.round.number, option });

const next = (state: GuessMyAnswerState, player: PlayerIndex) =>
  act(state, player, { type: 'next', round: state.round.number });

const refusal = (state: GuessMyAnswerState, player: PlayerIndex, action: unknown) => {
  const result = rules.validateAction(state, player, action);
  if (result.ok) throw new Error('expected the move to be refused');
  return result;
};

const types = (transition: Transition<GuessMyAnswerState>) =>
  transition.events.map((event) => event.type);

/** Plays one whole round: the answerer picks `answer`, the guesser picks `guess`. */
function round(
  state: GuessMyAnswerState,
  answer: number,
  guess: number,
): Transition<GuessMyAnswerState> {
  const answerer = state.round.answerer;
  const guesser: PlayerIndex = answerer === 0 ? 1 : 0;
  const half = choose(state, answerer, answer).state;
  return choose(half, guesser, guess);
}

/** Plays a round and both players move past the reveal. */
function past(state: GuessMyAnswerState, answer: number, guess: number): GuessMyAnswerState {
  const revealed = round(state, answer, guess).state;
  if (revealed.complete) return revealed;
  return next(next(revealed, ALICE).state, BOB).state;
}

describe('a new match', () => {
  it('draws six distinct questions and opens on the first', () => {
    const state = fresh();

    expect(state.questions).toHaveLength(ROUNDS);
    expect(new Set(state.questions).size).toBe(ROUNDS);
    expect(state.questions.every((index) => index >= 0 && index < QUESTIONS.length)).toBe(true);
    expect(state.round.number).toBe(1);
    expect(state.round.question).toBe(state.questions[0]);
    expect(state.correct).toEqual([0, 0]);
  });

  it('coin-flips who answers first, and phrases the question for each side', () => {
    const aliceAnswers = fresh({ random: () => 0 });
    const bobAnswers = fresh({ random: () => 0.9 });

    expect(aliceAnswers.round.answerer).toBe(ALICE);
    expect(bobAnswers.round.answerer).toBe(BOB);

    const mine = rules.getView(aliceAnswers, ALICE);
    const theirs = rules.getView(aliceAnswers, BOB);

    expect(mine.yourRole).toBe('answering');
    expect(theirs.yourRole).toBe('guessing');
    // Two phrasings of one question, so neither of them is reading a sentence about themselves in
    // the third person.
    expect(mine.prompt).not.toBe(theirs.prompt);
    expect(mine.options).toEqual(theirs.options);
    expect(mine.options).toHaveLength(OPTIONS);
  });

  it('asks the platform for no clock at all, ever', () => {
    let state = fresh();
    expect(rules.nextTickAt(state)).toBeNull();

    state = round(state, 1, 1).state;
    expect(rules.nextTickAt(state)).toBeNull();
    // And a tick, should one somehow arrive, changes nothing.
    expect(rules.tick(state, 999_999, context).state).toBe(state);
  });

  it('draws a different set of questions for a different match', () => {
    const sequence = (values: number[]): GameContext => {
      let index = 0;
      return { random: () => values[index++ % values.length]! };
    };

    const one = fresh(sequence([0.1, 0.8, 0.35, 0.62, 0.05]));
    const other = fresh(sequence([0.77, 0.24, 0.91, 0.48]));
    expect(one.questions).not.toEqual(other.questions);
  });
});

describe('choosing is secret until both are in', () => {
  it('tells the partner that a choice happened and nothing about what it was', () => {
    const state = fresh();
    const answerer = state.round.answerer;
    const guesser: PlayerIndex = answerer === 0 ? 1 : 0;

    const transition = choose(state, answerer, 2);
    expect(types(transition)).toEqual([EVENTS.game.stateUpdated]);

    const waiting = rules.getView(transition.state, guesser);
    expect(waiting.theyHaveChosen).toBe(true);
    // The three fields that could give it away, all still empty.
    expect(waiting.revealed).toBe(false);
    expect(waiting.answer).toBeNull();
    expect(waiting.guess).toBeNull();
    expect(waiting.correct).toBeNull();
    // And their own choice is still their own business.
    expect(waiting.yourChoice).toBeNull();

    // The one who chose gets their own pick straight back — they made it.
    expect(rules.getView(transition.state, answerer).yourChoice).toBe(2);
    expect(rules.getView(transition.state, answerer).theyHaveChosen).toBe(false);
  });

  it('opens the round the moment the second one is in', () => {
    const state = fresh();
    const transition = round(state, 2, 2);

    expect(types(transition)).toEqual([EVENTS.game.roundEnded]);
    const view = rules.getView(transition.state, BOB);
    expect(view.revealed).toBe(true);
    expect(view.answer).toBe(2);
    expect(view.guess).toBe(2);
    expect(view.correct).toBe(true);
  });

  it('gives the point to the guesser, and only when they were right', () => {
    const right = round(fresh(), 3, 3).state;
    const wrong = round(fresh(), 3, 1).state;

    // Seat 0 answers first, so seat 1 is the one guessing.
    expect(right.correct).toEqual([0, 1]);
    expect(wrong.correct).toEqual([0, 0]);

    expect(rules.getView(right, BOB).yourCorrect).toBe(1);
    expect(rules.getView(right, ALICE).theirCorrect).toBe(1);
    expect(rules.getView(right, ALICE).yourCorrect).toBe(0);
  });

  it('refuses a second choice, an answer that is not on the list, and a stale round', () => {
    const state = choose(fresh(), ALICE, 1).state;

    expect(refusal(state, ALICE, { type: 'choose', round: 1, option: 2 }).message).toBe(
      'You have already locked that in.',
    );
    expect(refusal(state, BOB, { type: 'choose', round: 1, option: OPTIONS }).code).toBe(
      'invalid_action',
    );
    expect(refusal(state, BOB, { type: 'choose', round: 1, option: -1 }).code).toBe(
      'invalid_action',
    );
    expect(refusal(state, BOB, { type: 'choose', round: 2, option: 0 }).message).toBe(
      'That question has already gone.',
    );
    expect(refusal(state, BOB, { type: 'shrug', round: 1 }).code).toBe('invalid_action');
    expect(refusal(state, BOB, null).code).toBe('invalid_action');
  });

  it('refuses a choice once the round is open', () => {
    const revealed = round(fresh(), 1, 2).state;
    expect(refusal(revealed, ALICE, { type: 'choose', round: 1, option: 0 }).message).toBe(
      'That question has already gone.',
    );
  });
});

describe('who is being waited on', () => {
  it('names nobody while they are both still deciding', () => {
    // Putting seat 0 on a 120-second clock for being seat 0 would be indefensible.
    expect(rules.turnOf(fresh())).toBeNull();
  });

  it('names the straggler once their partner is in', () => {
    const state = fresh();
    const answerer = state.round.answerer;
    const guesser: PlayerIndex = answerer === 0 ? 1 : 0;

    expect(rules.turnOf(choose(state, answerer, 0).state)).toBe(guesser);
    expect(rules.turnOf(choose(state, guesser, 0).state)).toBe(answerer);
  });

  it('names nobody on a fresh reveal, then the one who has not moved on', () => {
    const revealed = round(fresh(), 0, 0).state;
    expect(rules.turnOf(revealed)).toBeNull();
    expect(rules.turnOf(next(revealed, ALICE).state)).toBe(BOB);
  });

  it('names nobody once the match is over', () => {
    let state = fresh();
    for (let index = 0; index < ROUNDS; index += 1) state = past(state, 0, 0);
    expect(rules.turnOf(state)).toBeNull();
  });
});

describe('moving on', () => {
  it('needs both of them, and swaps who is answering', () => {
    const revealed = round(fresh(), 0, 0).state;
    const answerer = revealed.round.answerer;

    const one = next(revealed, ALICE);
    expect(types(one)).toEqual([EVENTS.game.stateUpdated]);
    expect(one.state.round.number).toBe(1);
    expect(rules.getView(one.state, ALICE).youReady).toBe(true);
    expect(rules.getView(one.state, BOB).theyReady).toBe(true);

    const both = next(one.state, BOB);
    expect(types(both)).toEqual([EVENTS.game.roundStarted]);
    expect(both.state.round.number).toBe(2);
    expect(both.state.round.answerer).not.toBe(answerer);
    expect(both.state.round.answer).toBeNull();
    expect(both.state.round.guess).toBeNull();
    expect(both.state.history).toHaveLength(1);
  });

  it('refuses "next" before the round is open, and twice from the same person', () => {
    const state = fresh();
    expect(refusal(state, ALICE, { type: 'next', round: 1 }).message).toBe(
      'Nobody has answered yet.',
    );

    const readied = next(round(state, 0, 0).state, ALICE).state;
    expect(refusal(readied, ALICE, { type: 'next', round: 1 }).message).toBe(
      'You are already waiting on them.',
    );
  });

  it('keeps a recap of every round that has gone, phrased from each side', () => {
    const state = past(fresh(), 1, 1);
    const question = QUESTIONS[state.questions[0]!]!;

    const answerer = rules.getView(state, ALICE).history[0]!;
    const guesser = rules.getView(state, BOB).history[0]!;

    expect(answerer.youGuessed).toBe(false);
    expect(answerer.question).toBe(question.mine);
    expect(guesser.youGuessed).toBe(true);
    expect(guesser.question).toBe(question.theirs);

    expect(answerer.answer).toBe(question.options[1]);
    expect(answerer.guess).toBe(question.options[1]);
    expect(answerer.correct).toBe(true);
    // Both of them are told the same facts about what happened.
    expect(guesser.correct).toBe(true);
  });
});

describe('playing it out', () => {
  it('gives each of them three questions to answer and three to guess', () => {
    let state = fresh();
    const answerers: PlayerIndex[] = [];

    for (let index = 0; index < ROUNDS; index += 1) {
      answerers.push(state.round.answerer);
      state = past(state, 0, 0);
    }

    expect(answerers.filter((seat) => seat === ALICE)).toHaveLength(ROUNDS / 2);
    expect(answerers.filter((seat) => seat === BOB)).toHaveLength(ROUNDS / 2);
    // Strictly alternating, so neither of them answers twice in a row.
    expect(answerers).toEqual([ALICE, BOB, ALICE, BOB, ALICE, BOB]);
  });

  it('ends on the last reveal rather than making them tap past it', () => {
    let state = fresh();
    for (let index = 0; index < ROUNDS - 1; index += 1) state = past(state, 0, 0);

    expect(state.round.number).toBe(ROUNDS);
    const last = round(state, 0, 0);

    expect(types(last)).toEqual([EVENTS.game.roundEnded, EVENTS.game.finished]);
    expect(last.state.complete).toBe(true);
    expect(rules.isComplete(last.state)).toBe(true);
    // The final round is in the recap too, so the results screen shows all six.
    expect(rules.getView(last.state, ALICE).history).toHaveLength(ROUNDS);
    expect(refusal(last.state, ALICE, { type: 'next', round: ROUNDS }).code).toBe(
      'invalid_game_state',
    );
  });

  it('carries the scoreline and names no winner (P-3)', () => {
    // Alice guesses right every time she guesses; Bob never does.
    let state = fresh();
    for (let index = 0; index < ROUNDS; index += 1) {
      const aliceIsGuessing = state.round.answerer === BOB;
      state = past(state, 2, aliceIsGuessing ? 2 : 3);
    }

    expect(state.correct).toEqual([ROUNDS / 2, 0]);

    const result = rules.getResult(state);
    expect(result.winner).toBeNull();
    expect(result.draw).toBe(false);
    expect(result.scores).toEqual([ROUNDS / 2, 0]);
  });

  it('files itself as social, which is what keeps it out of the win column', () => {
    expect(rules.meta.category).toBe('social');
    expect(rules.meta.scoringKind).toBe('social');
  });
});

describe('somebody drops', () => {
  it('keeps a locked-in answer rather than making them give it twice', () => {
    const state = choose(fresh(), ALICE, 3).state;
    const back = rules.resume(rules.pause(state, 0), 60_000, context);

    expect(back.state).toBe(state);
    expect(rules.getView(back.state, ALICE).yourChoice).toBe(3);
  });
});
