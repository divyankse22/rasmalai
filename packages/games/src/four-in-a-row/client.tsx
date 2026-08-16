'use client';

import { useCallback, useRef, type KeyboardEvent } from 'react';
import type { GameRenderProps } from '../contract';
import type { CellOwner, Coord, FourInARowView } from './protocol';

/**
 * Four in a Row, on screen.
 *
 * This component decides nothing. It draws the board the server sent and reports a *column* back as
 * an intent — never a square, because gravity is the server's to apply, and never an outcome.
 *
 * Input, per `docs/06`: the whole column is the target, so a thumb anywhere above a column drops
 * there, and the columns are ordinary buttons so Tab and Enter work with no help. Arrow keys move
 * along the board the way anyone who has played this expects.
 *
 * Colour is never the only signal. The two players are a light disc and a dark one — a lightness
 * difference rather than a hue one, so it survives colour blindness — the legend names them both,
 * every column says its contents in words for a screen reader, and the winning line is a ring rather
 * than a shade.
 */

const DISC: Record<Exclude<CellOwner, null>, string> = {
  you: 'bg-berry',
  them: 'bg-ink',
};

/** Where a disc dropped down this column would land, for the ghost that previews it.
 *
 * Derived from the authoritative board rather than deciding anything: the move sent is still only a
 * column, and the server places it. Reading the board it was given is not the renderer forming an
 * opinion about the rules.
 */
function landingRow(board: CellOwner[][], column: number): number {
  for (let row = 0; row < board.length; row += 1) {
    if ((board[row]?.[column] ?? null) === null) return row;
  }
  return -1;
}

function isIn(line: Coord[] | null, row: number, column: number): boolean {
  return line !== null && line.some((cell) => cell.row === row && cell.column === column);
}

/** What the line above the board says, which is the only instruction this game ever needs. */
function status(view: FourInARowView, partner: string): string {
  if (view.complete) {
    if (view.outcome === 'won') return 'Four in a row — yours 🎉';
    if (view.outcome === 'lost') return `${partner} got there first 😤`;
    return 'Board full, nobody connected four 🤝';
  }
  if (view.yourTurn) return view.discsPlaced === 0 ? 'You go first — pick a column' : 'Your turn';
  return view.discsPlaced === 0 ? `${partner} goes first…` : `${partner} is thinking…`;
}

export default function FourInARowGame({
  view,
  you,
  partner,
  act,
}: GameRenderProps<FourInARowView>) {
  const columns = useRef<(HTMLButtonElement | null)[]>([]);

  const drop = useCallback(
    (column: number) => {
      if (!view.yourTurn || !view.playable[column]) return;
      act({ type: 'drop', column });
    },
    [act, view.yourTurn, view.playable],
  );

  // Left and right walk the board. Home and End jump to its edges, which is what every other
  // grid-shaped widget on the web does and costs two lines here.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, column: number) => {
      const last = view.columns - 1;
      const target =
        event.key === 'ArrowLeft'
          ? Math.max(0, column - 1)
          : event.key === 'ArrowRight'
            ? Math.min(last, column + 1)
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? last
                : null;

      if (target === null) return;
      event.preventDefault();
      columns.current[target]?.focus();
    },
    [view.columns],
  );

  return (
    <section className="flex flex-col gap-3" aria-label="Four in a Row">
      <p
        className="text-center font-display text-lg font-semibold text-ink"
        // Polite, not assertive: a turn passing is worth knowing about, but it should wait for a
        // gap rather than cut across whatever the player is already being read.
        aria-live="polite"
      >
        {status(view, partner.nickname)}
      </p>

      <div
        className="mx-auto grid w-full max-w-md gap-1 rounded-card bg-lilac p-2 shadow-soft sm:gap-1.5 sm:p-3"
        style={{ gridTemplateColumns: `repeat(${view.columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: view.columns }, (_, column) => {
          const open = view.playable[column] ?? false;
          const mine = view.yourTurn && open;
          const filled = view.board.reduce(
            (total, row) => total + (row[column] ? 1 : 0),
            0,
          );
          const ghost = mine ? landingRow(view.board, column) : -1;

          return (
            <button
              key={column}
              type="button"
              ref={(node) => {
                columns.current[column] = node;
              }}
              onClick={() => drop(column)}
              onKeyDown={(event) => onKeyDown(event, column)}
              disabled={!mine}
              aria-label={
                !open
                  ? `Column ${column + 1}, full`
                  : view.complete
                    ? // Nobody is waiting for anybody once the board is decided, and a label that
                      // said otherwise would be the only thing on screen still claiming a game.
                      `Column ${column + 1}, ${filled} of ${view.rows} filled`
                    : view.yourTurn
                      ? `Drop in column ${column + 1}, ${filled} of ${view.rows} filled`
                      : `Column ${column + 1}, ${filled} of ${view.rows} filled, waiting for ${partner.nickname}`
              }
              // `flex-col-reverse` is what puts row 0 at the bottom, so the rules can count upwards
              // the way gravity does and nothing has to be flipped anywhere else.
              // `touch-none` stops a quick second tap being read as a zoom.
              className="group flex touch-none select-none flex-col-reverse gap-1 rounded-soft p-1 transition-colors duration-quick enabled:hover:bg-blush/60 disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry sm:gap-1.5"
            >
              {view.board.map((row, rowIndex) => {
                const cell = row[column] ?? null;
                const winning = isIn(view.winningLine, rowIndex, column);
                const last =
                  view.lastMove?.column === column && view.lastMove.row === rowIndex;

                return (
                  <span
                    key={rowIndex}
                    aria-hidden="true"
                    className={`flex aspect-square w-full items-center justify-center rounded-pill transition-all duration-soft ease-bounce ${
                      cell === null ? 'bg-shell' : DISC[cell]
                    } ${winning ? 'scale-105 ring-4 ring-butter' : ''}`}
                  >
                    {/* The disc that just landed carries a dot, so "what did they just do" is
                        answerable without remembering the board from a second ago. */}
                    {last && <span className="size-1.5 rounded-pill bg-shell/80" />}
                    {/* Where your disc would land if you pressed this column. Hover and focus
                        both, so it is never a hover-only affordance (docs/06). */}
                    {cell === null && rowIndex === ghost && (
                      <span className="size-1/2 rounded-pill bg-berry/0 transition-colors duration-quick group-hover:bg-berry/30 group-focus-visible:bg-berry/30" />
                    )}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-5 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-pill bg-berry" aria-hidden="true" />
          {you.nickname}
          {view.youStarted && <span className="text-muted/70">· went first</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-pill bg-ink" aria-hidden="true" />
          {partner.nickname}
          {!view.youStarted && <span className="text-muted/70">· went first</span>}
        </span>
      </div>
    </section>
  );
}
