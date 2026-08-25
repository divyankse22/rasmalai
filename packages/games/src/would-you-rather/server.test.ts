import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerIndex, Transition } from '../contract';
import { DECK, DIFFICULTY_BANDS, bandForRound, type Axis } from './deck';
import {
  ASKS_EACH,
  CANDIDATES,
  ROUNDS,
  type AnswererView,
  type AskerView,
  type Option,
  type WouldYouRatherAction,
} from './protocol';
import { deal, rules, type WouldYouRatherState } from './server';

const context: GameContext = { random: () => 0 };
const AT = { receivedAt: 0, compensationMs: 0 };

const fresh = (draw: GameContext = context) => rules.createMatch(0, draw);

/** Every action goes through `validateAction` first, exactly as the platform does. */
function act(
  state: WouldYouRatherState,
  player: PlayerIndex,
  action: unknown,
): Transition<WouldYouRatherState> {
  const validation = rules.validateAction(state, player, action);
  if (!validation.ok) throw new Error(`refused: ${validation.code} — ${validation.message}`);
  return rules.applyAction(state, player, validation.action as WouldYouRatherAction, AT, context);
}

function refusal(state: WouldYouRatherState, player: PlayerIndex, action: unknown): string {
  const validation = rules.validateAction(state, player, action);
  if (validation.ok) throw new Error('that was allowed, and should not have been');
  return validation.message;
}

const askerOf = (state: WouldYouRatherState): PlayerIndex => state.round.asker;
const answererOf = (state: WouldYouRatherState): PlayerIndex =>
  (1 - state.round.asker) as PlayerIndex;

const askerViewOf = (state: WouldYouRatherState) =>
  rules.getView(state, askerOf(state)) as AskerView;
const answererViewOf = (state: WouldYouRatherState) =>
  rules.getView(state, answererOf(state)) as AnswererView;

/** Drives one round to the reveal. */
function playRound(state: WouldYouRatherState, answer: Option, prediction: Option) {
  let next = act(state, askerOf(state), { type: 'select', round: state.round.number, candidate: 0 })
    .state;
  next = act(next, answererOf(next), { type: 'answer', round: next.round.number, option: answer })
    .state;
  return act(next, askerOf(next), {
    type: 'predict',
    round: next.round.number,
    option: prediction,
  }).state;
}

/** Reveal, then both move on. */
function finishRound(state: WouldYouRatherState, answer: Option, prediction: Option) {
  const revealed = playRound(state, answer, prediction);
  if (revealed.complete) return revealed;
  const one = act(revealed, 0, { type: 'next', round: revealed.round.number }).state;
  return act(one, 1, { type: 'next', round: one.round.number }).state;
}

describe('the deck', () => {
  it('holds enough for a whole match with room to spare', () => {
    expect(DECK.length).toBeGreaterThanOrEqual(ROUNDS * CANDIDATES);
    expect(DECK.length).toBeGreaterThanOrEqual(60);
  });

  it('gives every band more cards than a whole match could take from it', () => {
    // This is the test that makes the widening fallback in `nextCard` a safety net rather than the
    // mechanism. If it fails, the deck was rebalanced and rounds will start sliding out of band.
    for (const [low, high] of DIFFICULTY_BANDS) {
      const inBand = DECK.filter((d) => d.difficulty >= low && d.difficulty <= high).length;
      expect(inBand).toBeGreaterThan(ROUNDS * CANDIDATES);
    }
  });

  it('carries at least three axes in every band, so three distinct candidates are always possible', () => {
    for (const [low, high] of DIFFICULTY_BANDS) {
      const axes = new Set<Axis>(
        DECK.filter((d) => d.difficulty >= low && d.difficulty <= high).map((d) => d.axis),
      );
      expect(axes.size).toBeGreaterThanOrEqual(CANDIDATES);
    }
  });

  it('keeps the round count even and divisible by the number of bands', () => {
    // Both halves of the design assume these: roles alternate into exactly ASKS_EACH each, and
    // `bandForRound` splits the match into equal thirds.
    expect(ROUNDS % 2).toBe(0);
    expect(ROUNDS % DIFFICULTY_BANDS.length).toBe(0);
    expect(ASKS_EACH).toBe(ROUNDS / 2);
  });

  it('ships no empty side, and no dilemma whose two sides are the same', () => {
    for (const dilemma of DECK) {
      expect(dilemma.prompt.length).toBeGreaterThan(0);
      expect(dilemma.optionA.length).toBeGreaterThan(0);
      expect(dilemma.optionB.length).toBeGreaterThan(0);
      expect(dilemma.optionA).not.toBe(dilemma.optionB);
    }
    const pairs = new Set(DECK.map((d) => `${d.optionA}|${d.optionB}`));
    expect(pairs.size).toBe(DECK.length);
  });

  it('warms up: rounds are banded from gentle to brutal', () => {
    expect(bandForRound(1, 6)).toEqual([1, 2]);
    expect(bandForRound(2, 6)).toEqual([1, 2]);
    expect(bandForRound(3, 6)).toEqual([2, 4]);
    expect(bandForRound(4, 6)).toEqual([2, 4]);
    expect(bandForRound(5, 6)).toEqual([3, 5]);
    expect(bandForRound(6, 6)).toEqual([3, 5]);
    // Clamped rather than undefined if a round ever runs past the table.
    expect(bandForRound(99, 6)).toEqual([3, 5]);
  });
});

describe('the two of them see different things', () => {
  it('never lets the Answerer see the two dilemmas that were not chosen', () => {
    let state = fresh();
    const losing = state.deal[0]!.slice(1).map((index) => DECK[index]!);

    // Every phase of a whole round, including the reveal.
    const phases: WouldYouRatherState[] = [state];
    state = act(state, askerOf(state), { type: 'select', round: 1, candidate: 0 }).state;
    phases.push(state);
    state = act(state, answererOf(state), { type: 'answer', round: 1, option: 0 }).state;
    phases.push(state);
    state = act(state, askerOf(state), { type: 'predict', round: 1, option: 0 }).state;
    phases.push(state);

    for (const at of phases) {
      const view = answererViewOf(at);
      // Structural: the property does not exist on the Answerer's type at all.
      expect('candidates' in view).toBe(false);
      // And by text, the way bomb-defusal proves the manual never reaches the defuser.
      const serialized = JSON.stringify(view);
      for (const dilemma of losing) {
        expect(serialized).not.toContain(dilemma.optionA);
        expect(serialized).not.toContain(dilemma.optionB);
      }
    }
  });

  it("proves that sweep means something, by finding the same text on the Asker's screen", () => {
    const state = fresh();
    const losing = DECK[state.deal[0]![1]!]!;
    // If this failed, the assertion above would be passing for the wrong reason.
    expect(JSON.stringify(askerViewOf(state))).toContain(losing.optionA);
  });

  it('never lets the Asker see the answer before their prediction is in', () => {
    let state = fresh();
    state = act(state, askerOf(state), { type: 'select', round: 1, candidate: 0 }).state;
    state = act(state, answererOf(state), { type: 'answer', round: 1, option: 1 }).state;

    const asker = askerViewOf(state);
    expect(asker.phase).toBe('predicting');
    expect(asker.answer).toBeNull();
    expect(asker.correct).toBeNull();
    expect(JSON.stringify(asker)).not.toContain('"answer":1');

    // The sanity guard: the Answerer *does* have it at this exact moment, so the negative above is
    // a real withholding rather than a value that simply does not exist yet.
    expect(answererViewOf(state).yourAnswer).toBe(1);

    const revealed = act(state, askerOf(state), { type: 'predict', round: 1, option: 1 }).state;
    expect(askerViewOf(revealed).answer).toBe(1);
    expect(askerViewOf(revealed).correct).toBe(true);
  });

  it('never puts an axis, a difficulty or a deck index on the wire', () => {
    let state = fresh();
    state = act(state, askerOf(state), { type: 'select', round: 1, candidate: 0 }).state;
    state = act(state, answererOf(state), { type: 'answer', round: 1, option: 0 }).state;
    state = act(state, askerOf(state), { type: 'predict', round: 1, option: 0 }).state;

    for (const view of [askerViewOf(state), answererViewOf(state)]) {
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain('axis');
      expect(serialized).not.toContain('difficulty');
    }
  });

  it('tells the Answerer nothing at all while the Asker is choosing', () => {
    const state = fresh();
    const view = answererViewOf(state);
    expect(view.dilemma).toBeNull();

    // Not even how many they are being chosen between. Asserted over the view's own keys rather
    // than by hunting for "3" in the JSON — `asksEach` is legitimately 3, so a substring sweep here
    // would fail for a reason that has nothing to do with secrecy.
    const keys = Object.keys(view);
    expect(keys).not.toContain('candidates');
    expect(keys.some((key) => /candidate/i.test(key))).toBe(false);

    // And no field carries the count by another name: every dilemma the Asker is weighing is absent.
    const serialized = JSON.stringify(view);
    for (const card of state.deal[0]!) {
      expect(serialized).not.toContain(DECK[card]!.optionA);
    }
  });
});

describe('a new match', () => {
  it('deals every round three candidates, all distinct across the whole match', () => {
    const state = fresh();
    expect(state.deal).toHaveLength(ROUNDS);
    for (const triple of state.deal) expect(triple).toHaveLength(CANDIDATES);
    const all = state.deal.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('draws each round from its own difficulty band', () => {
    const state = fresh();
    state.deal.forEach((triple, index) => {
      const [low, high] = bandForRound(index + 1, ROUNDS);
      for (const card of triple) {
        expect(DECK[card]!.difficulty).toBeGreaterThanOrEqual(low);
        expect(DECK[card]!.difficulty).toBeLessThanOrEqual(high);
      }
    });
  });

  it('never offers three candidates on one axis', () => {
    const state = fresh();
    for (const triple of state.deal) {
      expect(new Set(triple.map((card) => DECK[card]!.axis)).size).toBe(CANDIDATES);
    }
  });

  it('coin-flips who asks first, and opens on selecting', () => {
    expect(fresh({ random: () => 0 }).round.asker).toBe(0);
    expect(fresh({ random: () => 0.9 }).round.asker).toBe(1);
    expect(fresh().round.phase).toBe('selecting');
    expect(fresh().round.number).toBe(1);
  });

  it('deals differently from a different random sequence', () => {
    let seed = 0;
    const wandering: GameContext = { random: () => ((seed = (seed * 9301 + 49297) % 233280) / 233280) };
    expect(deal(wandering).flat()).not.toEqual(deal(context).flat());
  });

  it('asks the platform for no clock at all, ever', () => {
    let state = fresh();
    expect(rules.nextTickAt(state)).toBeNull();
    state = act(state, askerOf(state), { type: 'select', round: 1, candidate: 0 }).state;
    expect(rules.nextTickAt(state)).toBeNull();
    state = act(state, answererOf(state), { type: 'answer', round: 1, option: 0 }).state;
    expect(rules.nextTickAt(state)).toBeNull();
    state = act(state, askerOf(state), { type: 'predict', round: 1, option: 0 }).state;
    expect(rules.nextTickAt(state)).toBeNull();
    expect(rules.tick(state, 10_000, context).state).toBe(state);
  });
});

describe('choosing the dilemma', () => {
  it('lets only the Asker choose', () => {
    const state = fresh();
    expect(refusal(state, answererOf(state), { type: 'select', round: 1, candidate: 0 })).toBe(
      'You are answering this one.',
    );
  });

  it('refuses a slot that is not one of the three', () => {
    const state = fresh();
    const asker = askerOf(state);
    expect(refusal(state, asker, { type: 'select', round: 1, candidate: 3 })).toBe(
      'That is not one of the three.',
    );
    expect(refusal(state, asker, { type: 'select', round: 1, candidate: -1 })).toBe(
      'That is not one of the three.',
    );
    expect(refusal(state, asker, { type: 'select', round: 1, candidate: 1.5 })).toBe(
      'That is not one of the three.',
    );
  });

  it('refuses a second choice, and hands the round to the Answerer', () => {
    let state = fresh();
    state = act(state, askerOf(state), { type: 'select', round: 1, candidate: 1 }).state;
    expect(state.round.phase).toBe('answering');
    expect(rules.turnOf(state)).toBe(answererOf(state));
    expect(refusal(state, askerOf(state), { type: 'select', round: 1, candidate: 0 })).toBe(
      'You have already picked one.',
    );
  });
});

describe('answering', () => {
  it('lets only the Answerer answer, and not before a dilemma is chosen', () => {
    const start = fresh();
    expect(refusal(start, answererOf(start), { type: 'answer', round: 1, option: 0 })).toBe(
      'They have not picked one yet.',
    );
    const chosen = act(start, askerOf(start), { type: 'select', round: 1, candidate: 0 }).state;
    expect(refusal(chosen, askerOf(chosen), { type: 'answer', round: 1, option: 0 })).toBe(
      'You are asking this one.',
    );
  });

  it('refuses anything that is not one of the two sides', () => {
    const state = act(fresh(), askerOf(fresh()), { type: 'select', round: 1, candidate: 0 }).state;
    const answerer = answererOf(state);
    expect(refusal(state, answerer, { type: 'answer', round: 1, option: 2 })).toBe(
      'That is not one of the two.',
    );
    expect(refusal(state, answerer, { type: 'answer', round: 1, option: '0' })).toBe(
      'That is not one of the two.',
    );
  });

  it('refuses a second answer', () => {
    let state = fresh();
    state = act(state, askerOf(state), { type: 'select', round: 1, candidate: 0 }).state;
    state = act(state, answererOf(state), { type: 'answer', round: 1, option: 0 }).state;
    expect(refusal(state, answererOf(state), { type: 'answer', round: 1, option: 1 })).toBe(
      'You have already answered.',
    );
  });
});

describe('predicting', () => {
  it('refuses a prediction before they have answered', () => {
    const start = fresh();
    expect(refusal(start, askerOf(start), { type: 'predict', round: 1, option: 0 })).toBe(
      'They have not answered yet.',
    );
    const chosen = act(start, askerOf(start), { type: 'select', round: 1, candidate: 0 }).state;
    expect(refusal(chosen, askerOf(chosen), { type: 'predict', round: 1, option: 0 })).toBe(
      'They have not answered yet.',
    );
  });

  it('lets only the Asker predict', () => {
    let state = fresh();
    state = act(state, askerOf(state), { type: 'select', round: 1, candidate: 0 }).state;
    state = act(state, answererOf(state), { type: 'answer', round: 1, option: 0 }).state;
    expect(refusal(state, answererOf(state), { type: 'predict', round: 1, option: 0 })).toBe(
      'You are answering this one.',
    );
  });

  it('scores the Asker, and only when they called it right', () => {
    const start = fresh();
    const asker = askerOf(start);

    const right = playRound(start, 1, 1);
    expect(right.correct[asker]).toBe(1);
    expect(right.correct[1 - asker]).toBe(0);

    const wrong = playRound(start, 1, 0);
    expect(wrong.correct[asker]).toBe(0);
  });

  it('opens the reveal to both, with the guess and the truth', () => {
    const state = playRound(fresh(), 1, 0);
    for (const view of [askerViewOf(state), answererViewOf(state)]) {
      expect(view.phase).toBe('revealed');
      expect(view.answer).toBe(1);
      expect(view.prediction).toBe(0);
      expect(view.correct).toBe(false);
    }
  });

  it('refuses a second prediction', () => {
    const state = playRound(fresh(), 0, 0);
    expect(refusal(state, askerOf(state), { type: 'predict', round: 1, option: 1 })).toBe(
      'You have already called it.',
    );
  });
});

describe('stale and malformed frames', () => {
  it('refuses an action for a round that has already gone', () => {
    const second = finishRound(fresh(), 0, 0);
    expect(second.round.number).toBe(2);
    // Specifically a `select` from round 1 arriving after the roles swapped — the case the
    // stale-round check has to catch *before* the role check, or it could be allowed.
    expect(refusal(second, askerOf(second), { type: 'select', round: 1, candidate: 0 })).toBe(
      'That one has already gone.',
    );
  });

  it('refuses nonsense', () => {
    const state = fresh();
    const asker = askerOf(state);
    expect(refusal(state, asker, null)).toBe('That is not a move in this game.');
    expect(refusal(state, asker, { type: 'select' })).toBe('That is not a move in this game.');
    expect(refusal(state, asker, { type: 'nope', round: 1 })).toBe(
      'That is not a move in this game.',
    );
  });

  it('refuses everything once the match is over', () => {
    let state = fresh();
    for (let round = 1; round <= ROUNDS; round += 1) state = finishRound(state, 0, 0);
    expect(state.complete).toBe(true);
    expect(refusal(state, 0, { type: 'next', round: state.round.number })).toBe(
      'That game is already over.',
    );
  });
});

describe('moving on, and swapping roles', () => {
  it('needs both of them before the next dilemma', () => {
    const revealed = playRound(fresh(), 0, 0);
    const one = act(revealed, 0, { type: 'next', round: 1 }).state;
    expect(one.round.number).toBe(1);
    expect(refusal(one, 0, { type: 'next', round: 1 })).toBe('You are already waiting on them.');
    const both = act(one, 1, { type: 'next', round: 1 }).state;
    expect(both.round.number).toBe(2);
  });

  it('refuses a move-on before anything is revealed', () => {
    expect(refusal(fresh(), 0, { type: 'next', round: 1 })).toBe('Nothing has been revealed yet.');
  });

  it('gives each of them exactly half the rounds as Asker, strictly alternating', () => {
    let state = fresh();
    const askers: PlayerIndex[] = [];
    for (let round = 1; round <= ROUNDS; round += 1) {
      askers.push(state.round.asker);
      state = finishRound(state, 0, 0);
    }
    expect(askers.filter((seat) => seat === 0)).toHaveLength(ASKS_EACH);
    expect(askers.filter((seat) => seat === 1)).toHaveLength(ASKS_EACH);
    for (let index = 1; index < askers.length; index += 1) {
      expect(askers[index]).not.toBe(askers[index - 1]);
    }
  });

  it('ends on the last reveal rather than making them tap past it', () => {
    let state = fresh();
    for (let round = 1; round < ROUNDS; round += 1) state = finishRound(state, 0, 0);
    expect(state.complete).toBe(false);
    state = playRound(state, 0, 0);
    expect(state.complete).toBe(true);
    // And the last round is on display in the history rather than lost.
    expect(state.history).toHaveLength(ROUNDS);
    expect(askerViewOf(state).history).toHaveLength(ROUNDS);
  });
});

describe('who is being waited on', () => {
  it('names the Asker while selecting and predicting, the Answerer while answering', () => {
    let state = fresh();
    const asker = askerOf(state);
    expect(rules.turnOf(state)).toBe(asker);
    state = act(state, asker, { type: 'select', round: 1, candidate: 0 }).state;
    expect(rules.turnOf(state)).toBe(1 - asker);
    state = act(state, answererOf(state), { type: 'answer', round: 1, option: 0 }).state;
    expect(rules.turnOf(state)).toBe(asker);
  });

  it('names nobody on a fresh reveal, then the straggler, then nobody once complete', () => {
    const revealed = playRound(fresh(), 0, 0);
    expect(rules.turnOf(revealed)).toBeNull();
    const one = act(revealed, 0, { type: 'next', round: 1 }).state;
    expect(rules.turnOf(one)).toBe(1);

    let state = fresh();
    for (let round = 1; round <= ROUNDS; round += 1) state = finishRound(state, 0, 0);
    expect(rules.turnOf(state)).toBeNull();
  });
});

describe('the result', () => {
  it('names the better predictor, and files itself competitive', () => {
    let state = fresh();
    const first = askerOf(state);
    // The first Asker calls all three of theirs; the other calls none.
    for (let round = 1; round <= ROUNDS; round += 1) {
      const rightNow = state.round.asker === first;
      state = finishRound(state, 0, rightNow ? 0 : 1);
    }

    const result = rules.getResult(state);
    expect(result.winner).toBe(first);
    expect(result.draw).toBe(false);
    expect(result.scores[first]).toBe(ASKS_EACH);
    expect(result.scores[1 - first]).toBe(0);

    // The deliberate divergence from Guess My Answer, asserted so it cannot drift back.
    expect(rules.meta.category).toBe('social');
    expect(rules.meta.scoringKind).toBe('competitive');
  });

  it('calls an equal scoreline a draw, with nobody named', () => {
    let state = fresh();
    for (let round = 1; round <= ROUNDS; round += 1) state = finishRound(state, 0, 0);
    const result = rules.getResult(state);
    expect(result.draw).toBe(true);
    expect(result.winner).toBeNull();
    expect(result.scores).toEqual([ASKS_EACH, ASKS_EACH]);
  });

  it('formats a score out of three', () => {
    expect(rules.meta.formatScore?.(2)).toBe('2 of 3 read right');
  });
});

describe('somebody drops', () => {
  it('keeps the round exactly where it was', () => {
    let state = fresh();
    state = act(state, askerOf(state), { type: 'select', round: 1, candidate: 2 }).state;
    state = act(state, answererOf(state), { type: 'answer', round: 1, option: 1 }).state;

    const paused = rules.pause(state, 5_000);
    const resumed = rules.resume(paused, 9_000, context).state;

    // The dilemma is not re-dealt and the answer is not asked for twice.
    expect(resumed.round.selected).toBe(2);
    expect(resumed.round.answer).toBe(1);
    expect(resumed.round.phase).toBe('predicting');
    expect(resumed.deal).toEqual(state.deal);
  });

  it('still tells a reconnecting Answerer nothing about the other two', () => {
    let state = fresh();
    const losing = state.deal[0]!.slice(1).map((index) => DECK[index]!);
    state = act(state, askerOf(state), { type: 'select', round: 1, candidate: 0 }).state;

    const resumed = rules.resume(rules.pause(state, 5_000), 9_000, context).state;
    const view = answererViewOf(resumed);

    expect('candidates' in view).toBe(false);
    const serialized = JSON.stringify(view);
    for (const dilemma of losing) expect(serialized).not.toContain(dilemma.optionA);
  });
});
