import { describe, expect, it } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import type { GameContext, PlayerIndex, Transition } from '../contract';
import { CARDS, FACES, PAIRS, PEEK_MS } from './protocol';
import { rules, type MemoryState } from './server';

/**
 * The rules are pure, so a whole game is played out here with no timers, no sockets and no table on
 * screen.
 *
 * The tests that matter most in this file are not about who won. They are about what the *other*
 * player is allowed to know: this is the first game whose authoritative state would hand over the
 * result if it were sent to the browser, so "the view never carries a face-down card's face" is
 * checked directly, in every state the board can be in, rather than trusted to a careful renderer.
 */

/** Seat 0 goes first: the coin-flip is drawn after the deck, so a zero sequence answers both. */
const context: GameContext = { random: () => 0 };

const ALICE: PlayerIndex = 0;
const BOB: PlayerIndex = 1;

/** Card `n` and card `n + 10` are a pair. Nothing in the rules knows that; the tests do. */
const DECK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** The partner of a card under `DECK`. */
const twin = (card: number) => (card + PAIRS) % CARDS;

/** A board with a known layout, so a test can name the card it means. */
function table(overrides: Partial<MemoryState> = {}): MemoryState {
  return {
    faces: [...DECK],
    matchedBy: Array.from({ length: CARDS }, () => null),
    faceUp: [],
    turn: ALICE,
    startedBy: ALICE,
    pairsWon: [0, 0],
    peekUntil: null,
    lastFlipMatched: null,
    paused: false,
    complete: false,
    ...overrides,
  };
}

/** Never mind the wire: only `receivedAt` is read, and only to time the peek. */
const at = (receivedAt = 0) => ({ receivedAt, compensationMs: 0 });

function flip(
  state: MemoryState,
  player: PlayerIndex,
  card: number,
  receivedAt = 0,
): Transition<MemoryState> {
  const validation = rules.validateAction(state, player, { type: 'flip', card });
  if (!validation.ok) throw new Error(`refused: ${validation.code} — ${validation.message}`);
  return rules.applyAction(state, player, validation.action, at(receivedAt), context);
}

/** Turns over a run of cards, always as whoever's turn it currently is. */
function play(state: MemoryState, cards: number[], receivedAt = 0): MemoryState {
  return cards.reduce(
    (current, card) => flip(current, current.turn, card, receivedAt).state,
    state,
  );
}

const refusal = (state: MemoryState, player: PlayerIndex, action: unknown) => {
  const result = rules.validateAction(state, player, action);
  if (result.ok) throw new Error('expected the move to be refused');
  return result;
};

const types = (transition: Transition<MemoryState>) => transition.events.map((event) => event.type);

/** Every face this reader can see, in card order — the thing a leak would show up in. */
const visibleFaces = (state: MemoryState, player: PlayerIndex) =>
  rules.getView(state, player).cards.map((card) => card.face);

describe('a fresh table', () => {
  it('deals every face exactly twice, all of them face down', () => {
    const state = rules.createMatch(0, context);

    expect(state.faces).toHaveLength(CARDS);
    for (let face = 0; face < PAIRS; face += 1) {
      expect(state.faces.filter((dealt) => dealt === face)).toHaveLength(2);
    }

    const view = rules.getView(state, ALICE);
    expect(view.cards).toHaveLength(CARDS);
    expect(view.cards.every((card) => card.face === null)).toBe(true);
    expect(view.cards.every((card) => card.matched === null && !card.faceUp)).toBe(true);
    expect(view.yourPairs).toBe(0);
    expect(view.theirPairs).toBe(0);
    expect(view.complete).toBe(false);
  });

  it('shuffles: two deals with different randomness are not the same table', () => {
    const sequence = (values: number[]): GameContext => {
      let index = 0;
      return { random: () => values[index++ % values.length]! };
    };

    const one = rules.createMatch(0, sequence([0.1, 0.7, 0.3, 0.9, 0.5]));
    const other = rules.createMatch(0, sequence([0.8, 0.2, 0.6, 0.4]));

    expect(one.faces).not.toEqual(other.faces);
    // Still a legal deck, however it came out.
    for (const deal of [one.faces, other.faces]) {
      for (let face = 0; face < PAIRS; face += 1) {
        expect(deal.filter((dealt) => dealt === face)).toHaveLength(2);
      }
    }
  });

  it('coin-flips who goes first, and tells each of them the same story about it', () => {
    const aliceFirst = rules.createMatch(0, { random: () => 0 });
    const bobFirst = rules.createMatch(0, { random: () => 0.9 });

    expect(aliceFirst.turn).toBe(ALICE);
    expect(bobFirst.turn).toBe(BOB);

    expect(rules.getView(aliceFirst, ALICE).youStarted).toBe(true);
    expect(rules.getView(aliceFirst, BOB).youStarted).toBe(false);
    expect(rules.getView(bobFirst, BOB).yourTurn).toBe(true);
    expect(rules.getView(bobFirst, ALICE).yourTurn).toBe(false);
  });

  it('asks for no clock until a pair is judged', () => {
    expect(rules.nextTickAt(table())).toBeNull();
    expect(rules.nextTickAt(play(table(), [3]))).toBeNull();
  });
});

describe('the layout is the server’s secret', () => {
  it('never fills in the face of a card that is face down, for either reader', () => {
    // One turned over, one pair already claimed, one mismatch showing: every way a card can be
    // visible, all on the same board.
    const state = table({
      matchedBy: Object.assign(
        Array.from({ length: CARDS }, () => null),
        { 0: ALICE, 10: ALICE },
      ),
      faceUp: [2, 5],
      peekUntil: 500,
      pairsWon: [1, 0],
      turn: ALICE,
    });

    for (const reader of [ALICE, BOB] as PlayerIndex[]) {
      const faces = visibleFaces(state, reader);
      const shown = faces.filter((face) => face !== null);

      // Exactly the four cards anybody looking at the table can see.
      expect(shown).toHaveLength(4);
      expect(faces[0]).toBe(FACES[DECK[0]!]);
      expect(faces[10]).toBe(FACES[DECK[10]!]);
      expect(faces[2]).toBe(FACES[DECK[2]!]);
      expect(faces[5]).toBe(FACES[DECK[5]!]);

      // And nothing else, anywhere.
      for (const card of [1, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
        expect(faces[card]).toBeNull();
      }
    }
  });

  it('leaks nothing through a card the reader has not turned over themselves', () => {
    // Bob's turn, Bob has one card up. Alice sees that card and nothing more — the same as Bob.
    const state = play(table({ turn: BOB }), [7]);

    expect(visibleFaces(state, BOB).filter(Boolean)).toEqual([FACES[DECK[7]!]]);
    expect(visibleFaces(state, ALICE).filter(Boolean)).toEqual([FACES[DECK[7]!]]);
  });

  it('says nothing about the deck order in a finished game it did not need to', () => {
    // Even at the end, only claimed cards carry faces — and by then every card is claimed, which
    // is the one moment the whole layout is legitimately public.
    const finished = table({
      matchedBy: Array.from({ length: CARDS }, (_, card) => (card % 2 === 0 ? ALICE : BOB)),
      pairsWon: [5, 5],
      complete: true,
    });

    expect(visibleFaces(finished, ALICE).every((face) => face !== null)).toBe(true);
  });
});

describe('turning cards over', () => {
  it('shows the first card to both of them and waits', () => {
    const transition = flip(table(), ALICE, 4);

    expect(transition.state.faceUp).toEqual([4]);
    expect(transition.state.turn).toBe(ALICE);
    expect(types(transition)).toEqual([EVENTS.game.stateUpdated]);
    expect(rules.getView(transition.state, BOB).cards[4]!.faceUp).toBe(true);
  });

  it('claims a pair, scores it, and lets the finder go again', () => {
    const first = flip(table(), ALICE, 4).state;
    const transition = flip(first, ALICE, twin(4));

    expect(transition.state.pairsWon).toEqual([1, 0]);
    expect(transition.state.turn).toBe(ALICE);
    expect(transition.state.faceUp).toEqual([]);
    expect(transition.state.lastFlipMatched).toBe(true);
    expect(transition.state.peekUntil).toBeNull();
    expect(types(transition)).toEqual([EVENTS.game.stateUpdated]);

    const mine = rules.getView(transition.state, ALICE);
    const theirs = rules.getView(transition.state, BOB);
    expect(mine.cards[4]!.matched).toBe('you');
    expect(theirs.cards[4]!.matched).toBe('them');
    expect(mine.yourPairs).toBe(1);
    expect(theirs.theirPairs).toBe(1);
    expect(mine.yourTurn).toBe(true);
    expect(theirs.yourTurn).toBe(false);
  });

  it('holds a mismatch up for the peek, then turns it back and passes the turn', () => {
    const state = play(table(), [4, 5], 1_000);

    expect(state.faceUp).toEqual([4, 5]);
    expect(state.peekUntil).toBe(1_000 + PEEK_MS);
    expect(state.lastFlipMatched).toBe(false);
    // The turn has *not* moved yet: the board and whose turn it is must never disagree on screen.
    expect(state.turn).toBe(ALICE);
    expect(rules.getView(state, ALICE).peeking).toBe(true);
    expect(rules.getView(state, ALICE).peekEndsAt).toBe(1_000 + PEEK_MS);

    // Early ticks do nothing at all.
    expect(rules.tick(state, 1_000 + PEEK_MS - 1, context).state).toBe(state);

    const over = rules.tick(state, 1_000 + PEEK_MS, context);
    expect(over.state.faceUp).toEqual([]);
    expect(over.state.peekUntil).toBeNull();
    expect(over.state.turn).toBe(BOB);
    expect(types(over)).toEqual([EVENTS.game.stateUpdated]);
    expect(visibleFaces(over.state, ALICE).every((face) => face === null)).toBe(true);
  });

  it('asks the clock for the peek deadline and nothing else', () => {
    const peeking = play(table(), [4, 5], 1_000);
    expect(rules.nextTickAt(peeking)).toBe(1_000 + PEEK_MS);

    const settled = rules.tick(peeking, 1_000 + PEEK_MS, context).state;
    expect(rules.nextTickAt(settled)).toBeNull();
  });

  it('puts nobody on the move clock while a peek is running', () => {
    // The platform times whoever `turnOf` names. Timing somebody out for waiting where the rules
    // told them to wait would be indefensible.
    const peeking = play(table(), [4, 5], 1_000);
    expect(rules.turnOf(peeking)).toBeNull();
    expect(rules.turnOf(rules.tick(peeking, 1_000 + PEEK_MS, context).state)).toBe(BOB);
  });
});

describe('moves that are refused', () => {
  it('refuses a flip out of turn, and nothing lands on the table', () => {
    const state = table();
    expect(refusal(state, BOB, { type: 'flip', card: 3 }).message).toBe('It is not your turn.');
    expect(state.faceUp).toEqual([]);
  });

  it('refuses a card that is not on the table, and anything that is not a flip', () => {
    const state = table();
    expect(refusal(state, ALICE, { type: 'flip', card: CARDS }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, { type: 'flip', card: -1 }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, { type: 'flip', card: 1.5 }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, { type: 'cut', card: 1 }).code).toBe('invalid_action');
    expect(refusal(state, ALICE, null).code).toBe('invalid_action');
  });

  it('refuses the same card twice — the one free pair in the game', () => {
    const state = play(table(), [6]);
    expect(refusal(state, ALICE, { type: 'flip', card: 6 }).message).toBe(
      'That one is already face up.',
    );
  });

  it('refuses a card whose pair has already gone', () => {
    const state = play(table(), [4, twin(4)]);
    expect(refusal(state, ALICE, { type: 'flip', card: 4 }).message).toBe(
      'That pair has already gone.',
    );
  });

  it('refuses a third card while a mismatch is being looked at', () => {
    const peeking = play(table(), [4, 5], 1_000);
    // From the player whose turn it still is — the strictest version of the check.
    expect(refusal(peeking, ALICE, { type: 'flip', card: 8 }).message).toBe(
      'Wait for those to turn back.',
    );
    expect(refusal(peeking, BOB, { type: 'flip', card: 8 }).code).toBe('invalid_action');
  });

  it('refuses everything once the table is cleared', () => {
    const finished = table({ complete: true });
    expect(refusal(finished, ALICE, { type: 'flip', card: 1 }).code).toBe('invalid_game_state');
    expect(rules.turnOf(finished)).toBeNull();
    expect(rules.nextTickAt(finished)).toBeNull();
  });
});

describe('somebody drops mid-peek', () => {
  it('freezes the cards where they are rather than throwing the move away', () => {
    const peeking = play(table(), [4, 5], 1_000);
    const paused = rules.pause(peeking, 1_200);

    expect(paused.paused).toBe(true);
    // Still showing. This is the whole reason this game pauses on a disconnect.
    expect(paused.faceUp).toEqual([4, 5]);

    const view = rules.getView(paused, BOB);
    expect(view.cards[4]!.faceUp).toBe(true);
    expect(view.cards[5]!.faceUp).toBe(true);
    expect(view.paused).toBe(true);
    // No deadline on screen while no clock is running.
    expect(view.peekEndsAt).toBeNull();

    // And no clock is running.
    expect(rules.nextTickAt(paused)).toBeNull();
    expect(rules.tick(paused, 9_999_999, context).state).toBe(paused);
  });

  it('refuses moves while paused', () => {
    const paused = rules.pause(table(), 0);
    expect(refusal(paused, ALICE, { type: 'flip', card: 1 }).code).toBe('invalid_game_state');
  });

  it('gives the whole peek back when they return, measured from now', () => {
    const peeking = play(table(), [4, 5], 1_000);
    const resumed = rules.resume(rules.pause(peeking, 1_200), 60_000, context);

    expect(resumed.state.paused).toBe(false);
    expect(resumed.state.peekUntil).toBe(60_000 + PEEK_MS);
    expect(resumed.state.faceUp).toEqual([4, 5]);
    expect(types(resumed)).toEqual([EVENTS.game.stateUpdated]);

    // And it still resolves normally from there.
    const over = rules.tick(resumed.state, 60_000 + PEEK_MS, context);
    expect(over.state.turn).toBe(BOB);
  });

  it('resumes a board that was not peeking without inventing a deadline', () => {
    const midMove = play(table(), [4]);
    const resumed = rules.resume(rules.pause(midMove, 10), 60_000, context);

    expect(resumed.state.peekUntil).toBeNull();
    // The card they had already turned over is still turned over.
    expect(resumed.state.faceUp).toEqual([4]);
  });
});

describe('playing it out', () => {
  it('ends when the last pair goes, and names the winner', () => {
    // Alice finds every pair without a single mistake, which is exactly what going again means.
    let state = table();
    for (let card = 0; card < PAIRS; card += 1) {
      state = play(state, [card, twin(card)]);
    }

    expect(state.complete).toBe(true);
    expect(rules.isComplete(state)).toBe(true);
    expect(state.pairsWon).toEqual([PAIRS, 0]);

    const result = rules.getResult(state);
    expect(result).toEqual({ winner: ALICE, draw: false, scores: [PAIRS, 0] });

    expect(rules.getView(state, ALICE).outcome).toBe('won');
    expect(rules.getView(state, BOB).outcome).toBe('lost');
    // Mirrored, which is the a/b slot mapping proving itself inside the game module too.
    expect(rules.getView(state, BOB).yourPairs).toBe(0);
    expect(rules.getView(state, BOB).theirPairs).toBe(PAIRS);
  });

  it('fires game.finished exactly once, with the last pair', () => {
    let state = table();
    const seen: string[][] = [];

    for (let card = 0; card < PAIRS; card += 1) {
      state = flip(state, state.turn, card).state;
      const transition = flip(state, state.turn, twin(card));
      state = transition.state;
      seen.push(types(transition));
    }

    expect(seen.filter((events) => events.includes(EVENTS.game.finished))).toHaveLength(1);
    expect(seen.at(-1)).toEqual([EVENTS.game.stateUpdated, EVENTS.game.finished]);
  });

  it('calls five apiece a draw', () => {
    // Nine pairs gone, four to Alice and five to Bob, and the last one is Alice's to take.
    const matchedBy = Array.from({ length: CARDS }, (_, card) =>
      card === 9 || card === 19 ? null : card % 2 === 0 ? ALICE : BOB,
    ) as (PlayerIndex | null)[];

    const state = play(table({ matchedBy, pairsWon: [4, 5], turn: ALICE }), [9, 19]);

    expect(state.complete).toBe(true);
    expect(rules.getResult(state)).toEqual({ winner: null, draw: true, scores: [5, 5] });
    expect(rules.getView(state, ALICE).outcome).toBe('drawn');
    expect(rules.getView(state, BOB).outcome).toBe('drawn');
  });
});

describe('what it says about itself', () => {
  it('is scored competitively even though it is filed under casual', () => {
    // The pairing the contract explicitly allows, and the reason `0009` moves the catalogue row to
    // match: P-3 reads the database, not this file, and the two disagreeing is the quiet failure.
    expect(rules.meta.category).toBe('casual');
    expect(rules.meta.scoringKind).toBe('competitive');
  });

  it('spells its score in pairs', () => {
    expect(rules.meta.formatScore?.(7)).toBe('7 pairs');
    expect(rules.meta.formatScore?.(1)).toBe('1 pair');
  });
});
