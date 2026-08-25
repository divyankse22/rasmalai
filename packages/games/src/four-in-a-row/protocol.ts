/**
 * What crosses the wire for Four in a Row. Safe for the browser: no rules, no server state.
 *
 * Everything is already resolved to one reader's point of view — `you` and `them` — for the same
 * reason `SessionView` is. A renderer that had to work out which seat it was drawing for would get
 * it wrong eventually, and it would get it wrong in front of somebody mid-game.
 */

/** The classic board: seven columns, six rows, four to win. */
export const COLUMNS = 7;
export const ROWS = 6;
export const CONNECT = 4;

/** Every square on the board, for anyone who needs the total. */
export const SQUARES = COLUMNS * ROWS;

/** A square, from the reader's side. Never a seat index — the platform owns that translation. */
export type CellOwner = 'you' | 'them' | null;

/**
 * A square's address.
 *
 * `row` counts from the **bottom**, the way gravity does, on both sides of the wire. The renderer
 * draws it upside down exactly once, in one loop, rather than the rules being written against the
 * order a browser happens to lay out a grid.
 */
export interface Coord {
  column: number;
  row: number;
}

export interface FourInARowView {
  columns: number;
  rows: number;
  /** `board[row][column]`, row 0 the bottom. */
  board: CellOwner[][];
  /** The only thing that decides whether your taps do anything. */
  yourTurn: boolean;
  /**
   * Which columns still have room, by index.
   *
   * The server owns legality, so the renderer is told rather than working it out: two answers to
   * "can I play here" is one answer too many, and the one on screen would be the one that is wrong.
   */
  playable: boolean[];
  /** The disc that just landed, so the board can point at it. */
  lastMove: (Coord & { mine: boolean }) | null;
  /** The four (or more) squares that ended it, for the board to light up. Null until then. */
  winningLine: Coord[] | null;
  outcome: 'won' | 'lost' | 'drawn' | null;
  /** Who went first — a server coin-flip, flipped again for a rematch. */
  youStarted: boolean;
  discsPlaced: number;
  complete: boolean;
}

/**
 * The only thing a player can do: drop a disc down a column.
 *
 * A column and not a square, because gravity decides the row. A client that named a row would be
 * asserting an outcome, and clients send intents (`docs/04` section 1).
 */
export interface DropAction {
  type: 'drop';
  column: number;
}

export type FourInARowAction = DropAction;
