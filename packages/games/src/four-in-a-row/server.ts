import { EVENTS, RECONNECT_WINDOW_MS } from '@rasmalai/shared';
import {
  opponentOf,
  type GameEvent,
  type GameResult,
  type GameRules,
  type PlayerIndex,
  type Transition,
  type ValidationResult,
} from '../contract';
import { meta } from './meta';
import {
  COLUMNS,
  CONNECT,
  ROWS,
  SQUARES,
  type CellOwner,
  type Coord,
  type FourInARowAction,
  type FourInARowView,
} from './protocol';

/**
 * Four in a Row, decided entirely on the server.
 *
 * ```text
 * board created → server coin-flips who goes first
 *   → the player whose turn it is drops a disc down a column
 *   → the server places it, because gravity is not the client's to decide
 *   → four in a line ends it; a full board with no line is a draw
 * ```
 *
 * One board is one match, and a rematch is a fresh board with a fresh coin-flip. The alternative —
 * best of three with alternating starts — buys away the first-move advantage at the cost of tripling
 * how long two people sit still, and V1 is meant to be quick.
 *
 * **This game asks the clock for nothing.** `nextTickAt` returns null, so the platform arms no timer
 * at all, and a player is free to take as long as they like over a move. Reaction Speed leaned on
 * every timing facility the runner has; this leans on none of them, which is the more useful test of
 * whether the runner really is optional infrastructure rather than a second set of rules.
 *
 * Nothing here reads a clock, holds a socket, or knows a user id. Seats `0` and `1`, a board, and
 * whose turn it is.
 */

/** A square's occupant in the server's own state: a seat, never a person. */
type Cell = PlayerIndex | null;

export interface FourInARowState {
  /** `board[row][column]`, row 0 the bottom — the same way up gravity works. */
  board: Cell[][];
  turn: PlayerIndex;
  startedBy: PlayerIndex;
  moves: number;
  lastMove: (Coord & { player: PlayerIndex }) | null;
  winner: PlayerIndex | null;
  winningLine: Coord[] | null;
  draw: boolean;
  complete: boolean;
}

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLUMNS }, () => null));
}

/**
 * One square, or null for empty — and null for off the board too, which is what lets a line be
 * walked to the edge without a bounds check at every step.
 */
function cellAt(board: Cell[][], row: number, column: number): Cell {
  return board[row]?.[column] ?? null;
}

/** The row a disc dropped down this column would come to rest in, or -1 when it is full. */
function landingRow(board: Cell[][], column: number): number {
  for (let row = 0; row < ROWS; row += 1) {
    if (cellAt(board, row, column) === null) return row;
  }
  return -1;
}

/** The four directions a line can run. Their opposites are walked too, so four is enough. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], // →
  [1, 0], // ↑
  [1, 1], // ↗
  [1, -1], // ↘ read upwards, ↖ downwards
];

/**
 * The winning line through the square just filled, or null.
 *
 * Only through that square, because it is the only one that changed: a board with no line before the
 * move cannot have grown one anywhere else. Every square of the run is returned rather than the
 * first four, so a five-long line lights up in full on screen.
 */
function winningLineThrough(board: Cell[][], at: Coord): Coord[] | null {
  const owner = cellAt(board, at.row, at.column);
  if (owner === null) return null;

  for (const [dRow, dColumn] of DIRECTIONS) {
    const line: Coord[] = [at];

    for (const sign of [1, -1]) {
      let row = at.row + sign * dRow;
      let column = at.column + sign * dColumn;

      while (cellAt(board, row, column) === owner) {
        line.push({ row, column });
        row += sign * dRow;
        column += sign * dColumn;
      }
    }

    if (line.length >= CONNECT) {
      // Ordered, so a test can name the line and a renderer gets the same answer twice.
      return line.sort((left, right) => left.column - right.column || left.row - right.row);
    }
  }

  return null;
}

function still(state: FourInARowState): Transition<FourInARowState> {
  return { state, events: [] };
}

export const rules: GameRules<FourInARowState, FourInARowAction, FourInARowView> = {
  meta,

  reconnectPolicy: {
    windowMs: RECONNECT_WINDOW_MS,
    // Nothing is running down, so there is nothing to stop. More importantly, the board must come
    // back exactly as it was left: a turn-based game that threw away its position on a dropped
    // connection would punish bad wifi far harder than a timed one ever could. The platform still
    // refuses actions while a player is missing, so the absent player cannot be played around.
    pauseOnDisconnect: false,
    // Two minutes is long enough that this is walking out, not bad wifi.
    onExpire: 'forfeit',
  },

  createMatch(_now, context) {
    // A coin-flip, from the server's own randomness. Connect Four rewards moving first, and there is
    // nothing here to earn the advantage with, so the fairest available answer is chance — flipped
    // again for every rematch rather than inherited from the match before.
    const startedBy: PlayerIndex = context.random() < 0.5 ? 0 : 1;

    return {
      board: emptyBoard(),
      turn: startedBy,
      startedBy,
      moves: 0,
      lastMove: null,
      winner: null,
      winningLine: null,
      draw: false,
      complete: false,
    };
  },

  validateAction(state, player, action): ValidationResult<FourInARowAction> {
    if (state.complete) {
      return { ok: false, code: 'invalid_game_state', message: 'That game is already over.' };
    }

    const candidate = action as Partial<FourInARowAction> | null;
    const column = candidate?.column;
    if (!candidate || candidate.type !== 'drop' || typeof column !== 'number' || !Number.isInteger(column)) {
      return { ok: false, code: 'invalid_action', message: 'That is not a move in this game.' };
    }

    if (column < 0 || column >= COLUMNS) {
      return { ok: false, code: 'invalid_action', message: 'That column is not on the board.' };
    }

    // Turn ownership, which is this game's whole answer to "can a client fake an outcome". A frame
    // that arrives out of turn is refused whether it was sent early, twice, or on purpose.
    if (state.turn !== player) {
      return { ok: false, code: 'invalid_action', message: 'It is not your turn.' };
    }

    if (landingRow(state.board, column) === -1) {
      return { ok: false, code: 'invalid_action', message: 'That column is full.' };
    }

    return { ok: true, action: { type: 'drop', column } };
  },

  applyAction(state, player, action, _at, _context) {
    const row = landingRow(state.board, action.column);
    const at: Coord = { column: action.column, row };

    const board = state.board.map((cells, rowIndex) =>
      rowIndex === row ? cells.map((cell, column) => (column === action.column ? player : cell)) : cells,
    );

    const winningLine = winningLineThrough(board, at);
    const moves = state.moves + 1;
    const draw = winningLine === null && moves === SQUARES;
    const complete = winningLine !== null || draw;

    const events: GameEvent[] = [{ type: EVENTS.game.stateUpdated }];
    if (complete) events.push({ type: EVENTS.game.finished });

    return {
      state: {
        ...state,
        board,
        // The turn freezes where it was once the board is decided; nothing may be played into it.
        turn: complete ? state.turn : opponentOf(player),
        moves,
        lastMove: { ...at, player },
        winner: winningLine === null ? null : player,
        winningLine,
        draw,
        complete,
      },
      events,
    };
  },

  // Turn-based: the game is always waiting on a person, never on the clock. Both of these exist to
  // satisfy the contract, and the platform arms no timer for a game that answers null.
  tick(state) {
    return still(state);
  },

  nextTickAt() {
    return null;
  },

  // Which is not to say nobody is on a clock — the platform gives whoever is to move two minutes to
  // do it. Frozen once the board is decided, so a finished game puts nobody under a clock while its
  // result is on screen.
  turnOf(state) {
    return state.complete ? null : state.turn;
  },

  // Nothing is in flight to discard, and the board is the one thing that must survive. The platform
  // only calls these when `pauseOnDisconnect` is set, which this game does not — they are here
  // because the contract asks every game for them, and doing nothing is the correct answer.
  pause(state) {
    return state;
  },

  resume(state) {
    return still(state);
  },

  getView(state, player) {
    const board: CellOwner[][] = state.board.map((cells) =>
      cells.map((cell) => (cell === null ? null : cell === player ? 'you' : 'them')),
    );

    const outcome = !state.complete
      ? null
      : state.draw || state.winner === null
        ? ('drawn' as const)
        : state.winner === player
          ? ('won' as const)
          : ('lost' as const);

    return {
      columns: COLUMNS,
      rows: ROWS,
      board,
      yourTurn: !state.complete && state.turn === player,
      playable: Array.from({ length: COLUMNS }, (_, column) => landingRow(state.board, column) !== -1),
      lastMove: state.lastMove
        ? {
            column: state.lastMove.column,
            row: state.lastMove.row,
            mine: state.lastMove.player === player,
          }
        : null,
      winningLine: state.winningLine,
      outcome,
      youStarted: state.startedBy === player,
      discsPlaced: state.moves,
      complete: state.complete,
    };
  },

  isComplete(state) {
    return state.complete;
  },

  getResult(state): GameResult {
    // A full board with nothing connected. Zero each rather than one each: the margin between them
    // is what feeds "most competitive game", and a draw is the closest a match can be.
    if (state.winner === null) return { winner: null, draw: true, scores: [0, 0] };

    return {
      winner: state.winner,
      draw: false,
      scores: state.winner === 0 ? [1, 0] : [0, 1],
    };
  },
};
