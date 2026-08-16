import { describe, expect, it } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import type { GameContext, PlayerIndex, Transition } from '../contract';
import { COLUMNS, ROWS, SQUARES } from './protocol';
import { rules, type FourInARowState } from './server';

/**
 * The rules are pure, so a whole game is played out here with no timers, no sockets and no board on
 * screen. Everything this game can be got wrong about — playing out of turn, playing twice, playing
 * into a full column, a line that is a disc short — is arithmetic, and arithmetic is testable.
 */

/** Seat 0 goes first. The coin-flip is the only random thing in the game. */
const context: GameContext = { random: () => 0 };
const secondSeatStarts: GameContext = { random: () => 0.9 };

const ALICE: PlayerIndex = 0;
const BOB: PlayerIndex = 1;

/** Never mind the timing: this game does not read it. */
const AT = { receivedAt: 0, compensationMs: 0 };

function drop(
  state: FourInARowState,
  player: PlayerIndex,
  column: number,
): Transition<FourInARowState> {
  const validation = rules.validateAction(state, player, { type: 'drop', column });
  if (!validation.ok) throw new Error(`refused: ${validation.code} — ${validation.message}`);
  return rules.applyAction(state, player, validation.action, AT, context);
}

/** Plays a list of columns, taking turns from whoever's turn it is. */
function play(state: FourInARowState, columns: number[]): FourInARowState {
  return columns.reduce((current, column) => drop(current, current.turn, column).state, state);
}

const refusal = (state: FourInARowState, player: PlayerIndex, action: unknown) => {
  const result = rules.validateAction(state, player, action);
  if (result.ok) throw new Error('expected the move to be refused');
  return result;
};

const fresh = () => rules.createMatch(0, context);

const types = (transition: Transition<FourInARowState>) =>
  transition.events.map((event) => event.type);

/** Alice takes the bottom row while Bob stacks a column of his own, three high. */
const ALICE_WINS_ALONG_THE_BOTTOM = [0, 6, 1, 6, 2, 6, 3];

describe('a new board', () => {
  it('is empty, with nobody having moved', () => {
    const view = rules.getView(fresh(), ALICE);

    expect(view.board).toHaveLength(ROWS);
    expect(view.board.every((row) => row.length === COLUMNS)).toBe(true);
    expect(view.board.flat().every((cell) => cell === null)).toBe(true);
    expect(view.discsPlaced).toBe(0);
    expect(view.playable).toEqual(Array.from({ length: COLUMNS }, () => true));
    expect(view.complete).toBe(false);
  });

  it('coin-flips who goes first, and tells each of them the same story about it', () => {
    const aliceFirst = rules.createMatch(0, context);
    const bobFirst = rules.createMatch(0, secondSeatStarts);

    expect(aliceFirst.turn).toBe(ALICE);
    expect(bobFirst.turn).toBe(BOB);

    expect(rules.getView(aliceFirst, ALICE).youStarted).toBe(true);
    expect(rules.getView(aliceFirst, BOB).youStarted).toBe(false);
    expect(rules.getView(bobFirst, BOB).yourTurn).toBe(true);
    expect(rules.getView(bobFirst, ALICE).yourTurn).toBe(false);
  });

  it('asks the platform for no clock at all', () => {
    // The whole point of the second game: it exercises none of the timing machinery the first one
    // leaned on, and the platform arms no timer for a game that answers null.
    const state = play(fresh(), [3, 3, 4]);
    expect(rules.nextTickAt(state)).toBeNull();
    expect(rules.tick(state, 10_000, context)).toEqual({ state, events: [] });
  });
});

describe('dropping a disc', () => {
  it('lands on the floor, then stacks on what is already there', () => {
    const state = play(fresh(), [3, 3, 3]);

    expect(state.board[0]?.[3]).toBe(ALICE);
    expect(state.board[1]?.[3]).toBe(BOB);
    expect(state.board[2]?.[3]).toBe(ALICE);
    expect(state.board[3]?.[3]).toBeNull();
  });

  it('passes the turn, and says so to both of them', () => {
    const after = drop(fresh(), ALICE, 3);

    expect(after.state.turn).toBe(BOB);
    expect(rules.getView(after.state, ALICE).yourTurn).toBe(false);
    expect(rules.getView(after.state, BOB).yourTurn).toBe(true);
    // Nothing is secret in this game: both of them see the same board, so one event goes to both.
    expect(types(after)).toEqual([EVENTS.game.stateUpdated]);
    expect(after.events.every((event) => event.to === undefined)).toBe(true);
  });

  it('closes a column once it is full', () => {
    const state = play(fresh(), Array.from({ length: ROWS }, () => 2));
    const view = rules.getView(state, ALICE);

    expect(view.playable[2]).toBe(false);
    expect(view.playable[3]).toBe(true);
    expect(view.discsPlaced).toBe(ROWS);
  });

  it('points at the disc that just landed, from both sides', () => {
    const state = play(fresh(), [3, 5]);

    expect(rules.getView(state, ALICE).lastMove).toEqual({ column: 5, row: 0, mine: false });
    expect(rules.getView(state, BOB).lastMove).toEqual({ column: 5, row: 0, mine: true });
  });
});

describe('refusing a move', () => {
  it('will not let a player move out of turn', () => {
    expect(refusal(fresh(), BOB, { type: 'drop', column: 3 }).code).toBe('invalid_action');
  });

  it('will not let the same player move twice', () => {
    const state = drop(fresh(), ALICE, 3).state;
    expect(refusal(state, ALICE, { type: 'drop', column: 4 }).code).toBe('invalid_action');
  });

  it('will not accept a column that is full', () => {
    const state = play(fresh(), Array.from({ length: ROWS }, () => 2));
    expect(refusal(state, state.turn, { type: 'drop', column: 2 }).message).toMatch(/full/i);
  });

  it('will not accept a column that is not on the board', () => {
    const state = fresh();
    for (const column of [-1, COLUMNS, 99, 1.5]) {
      expect(refusal(state, ALICE, { type: 'drop', column }).code).toBe('invalid_action');
    }
  });

  it('will not accept something that is not a move', () => {
    const state = fresh();
    for (const action of [null, undefined, 'drop', 7, {}, { type: 'tap', round: 1 }]) {
      expect(refusal(state, ALICE, action).code).toBe('invalid_action');
    }
  });

  it('will not accept anything at all once the board is decided', () => {
    const state = play(fresh(), ALICE_WINS_ALONG_THE_BOTTOM);

    expect(state.complete).toBe(true);
    expect(refusal(state, BOB, { type: 'drop', column: 5 }).code).toBe('invalid_game_state');
    expect(refusal(state, ALICE, { type: 'drop', column: 5 }).code).toBe('invalid_game_state');
  });
});

describe('winning', () => {
  it('spots four across, and names the squares', () => {
    const after = drop(play(fresh(), [0, 0, 1, 1, 2, 2]), ALICE, 3);

    expect(after.state.winner).toBe(ALICE);
    expect(after.state.winningLine).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 2, row: 0 },
      { column: 3, row: 0 },
    ]);
    expect(types(after)).toEqual([EVENTS.game.stateUpdated, EVENTS.game.finished]);
  });

  it('spots four stacked', () => {
    const after = drop(play(fresh(), [2, 3, 2, 3, 2, 3]), ALICE, 2);

    expect(after.state.winner).toBe(ALICE);
    expect(after.state.winningLine).toEqual([
      { column: 2, row: 0 },
      { column: 2, row: 1 },
      { column: 2, row: 2 },
      { column: 2, row: 3 },
    ]);
  });

  it('spots a rising diagonal', () => {
    //   row 3  . . . A          A = Alice, b = Bob, and the disc she has just dropped
    //   row 2  . . A b          into column 3 finishes 0,0 → 3,3.
    //   row 1  . A A b
    //   row 0  A b b b
    const after = drop(play(fresh(), [0, 1, 1, 2, 2, 3, 2, 3, 3, 6]), ALICE, 3);

    expect(after.state.winner).toBe(ALICE);
    expect(after.state.winningLine).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 1 },
      { column: 2, row: 2 },
      { column: 3, row: 3 },
    ]);
  });

  it('spots a falling diagonal', () => {
    // The same board mirrored, so the other diagonal is walked as well.
    const after = drop(play(fresh(), [6, 5, 5, 4, 4, 3, 4, 3, 3, 0]), ALICE, 3);

    expect(after.state.winner).toBe(ALICE);
    expect(after.state.winningLine).toEqual([
      { column: 3, row: 3 },
      { column: 4, row: 2 },
      { column: 5, row: 1 },
      { column: 6, row: 0 },
    ]);
  });

  it('reports every square of a line longer than four', () => {
    // Alice fills the bottom row from 0 to 4 with the gap at 3 filled last.
    const state = play(fresh(), [0, 6, 1, 5, 2, 6, 4, 5, 3]);

    expect(state.winner).toBe(ALICE);
    expect(state.winningLine).toHaveLength(5);
  });

  it('does not count three, or four with a gap', () => {
    const three = play(fresh(), [0, 6, 1, 6, 2]);
    expect(three.complete).toBe(false);

    // Columns 0, 1, 2 and 4 — a hole at 3 is not a line.
    const gapped = play(fresh(), [0, 6, 1, 6, 2, 6, 4]);
    expect(gapped.complete).toBe(false);
    expect(gapped.winningLine).toBeNull();
  });

  it('does not join two players into one line', () => {
    // Alice, Bob, Alice, Alice along the bottom row: four discs, two owners, no winner.
    const state = play(fresh(), [0, 1, 2, 5, 3]);
    expect(state.complete).toBe(false);
  });

  it('freezes the turn and tells both of them how it went', () => {
    const state = play(fresh(), ALICE_WINS_ALONG_THE_BOTTOM);

    const alice = rules.getView(state, ALICE);
    const bob = rules.getView(state, BOB);

    expect(alice.outcome).toBe('won');
    expect(bob.outcome).toBe('lost');
    expect(alice.yourTurn).toBe(false);
    expect(bob.yourTurn).toBe(false);
    expect(alice.winningLine).toHaveLength(4);
    expect(bob.winningLine).toEqual(alice.winningLine);

    expect(rules.isComplete(state)).toBe(true);
    expect(rules.getResult(state)).toEqual({ winner: ALICE, draw: false, scores: [1, 0] });
  });

  it('scores a win by the second seat the other way round', () => {
    const state = play(rules.createMatch(0, secondSeatStarts), ALICE_WINS_ALONG_THE_BOTTOM);

    expect(state.winner).toBe(BOB);
    expect(rules.getResult(state)).toEqual({ winner: BOB, draw: false, scores: [0, 1] });
  });
});

describe('a drawn board', () => {
  /**
   * Forty-two discs with nothing connected — found by playing the real rules until a game reached
   * it, then written down, because a board like this is much easier to search for than to design.
   */
  const DRAW_SEQUENCE = [
    1, 0, 6, 0, 1, 0, 0, 3, 2, 6, 6, 3, 1, 6, 2, 5, 4, 6, 6, 3, 3, 1, 5, 5, 1, 3, 1, 0, 2, 2, 4, 4,
    2, 2, 5, 0, 4, 3, 5, 4, 4, 5,
  ];

  it('ends level once the last square is filled', () => {
    const state = play(fresh(), DRAW_SEQUENCE);

    expect(state.moves).toBe(SQUARES);
    expect(state.draw).toBe(true);
    expect(state.complete).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.winningLine).toBeNull();

    const view = rules.getView(state, ALICE);
    expect(view.outcome).toBe('drawn');
    expect(view.playable.some(Boolean)).toBe(false);

    // Level, and level at zero rather than one each: the margin between the scores is what feeds
    // "most competitive game", and a draw is as close as a match can get.
    expect(rules.getResult(state)).toEqual({ winner: null, draw: true, scores: [0, 0] });
  });

  it('is not called early', () => {
    const nearly = play(fresh(), DRAW_SEQUENCE.slice(0, -1));
    expect(nearly.complete).toBe(false);
    expect(nearly.moves).toBe(SQUARES - 1);
  });
});

describe('somebody dropping out', () => {
  it('keeps the board exactly as it was', () => {
    // The platform never calls these for this game — `pauseOnDisconnect` is false, because a
    // turn-based board must survive a dropped connection rather than restart. They are asserted
    // anyway: the contract asks every game for them, and "does nothing" is a behaviour worth
    // pinning down rather than leaving to be discovered.
    const state = play(fresh(), [3, 3, 4, 4, 5]);

    expect(rules.pause(state, 1_000)).toEqual(state);
    expect(rules.resume(state, 2_000, context)).toEqual({ state, events: [] });
  });

  it('restores the whole board from one view', () => {
    // What a reconnecting player actually gets: `lobby.joined` carries the session, the session
    // carries this, and there is no separate resume path to get wrong.
    const view = rules.getView(play(fresh(), [3, 3, 4, 4, 5, 2]), BOB);

    expect(view.board.flat().filter((cell) => cell === 'you')).toHaveLength(3);
    expect(view.board.flat().filter((cell) => cell === 'them')).toHaveLength(3);
    expect(view.yourTurn).toBe(false);
    expect(view.discsPlaced).toBe(6);
  });
});

describe('what one player is allowed to see', () => {
  it('is the same board, mirrored — never a seat number', () => {
    const state = play(fresh(), [0, 1, 2]);

    expect(rules.getView(state, ALICE).board[0]).toEqual([
      'you',
      'them',
      'you',
      null,
      null,
      null,
      null,
    ]);
    expect(rules.getView(state, BOB).board[0]).toEqual([
      'them',
      'you',
      'them',
      null,
      null,
      null,
      null,
    ]);
  });
});
