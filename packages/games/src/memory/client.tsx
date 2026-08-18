'use client';

import { useCallback, useRef, type KeyboardEvent } from 'react';
import type { GameRenderProps } from '../contract';
import type { MemoryCard, MemoryView } from './protocol';

/**
 * Memory, on screen.
 *
 * This component decides nothing and — more importantly for this game — **knows** nothing. A card
 * that is face down arrives with `face: null`, so there is no hidden value in the DOM, no
 * `data-face` attribute, and nothing to read out of a React devtools tree. The secrecy is the
 * server's; this is just what it looks like.
 *
 * Input, per `docs/06`: every card is an ordinary button, so tap, click, Tab and Enter all work
 * with nothing added. Arrow keys walk the grid the way anyone who has used one expects, because on
 * a twenty-card board Tab alone is a lot of presses.
 *
 * Colour is never the only signal. A claimed pair is dimmed *and* ringed *and* says whose it is in
 * its label; the two players are a light ring and a dark one, a lightness difference rather than a
 * hue one, so it survives colour blindness.
 */

/** What a card says to a screen reader — the same information the picture gives, in words. */
function label(card: MemoryCard, index: number, partner: string): string {
  const where = `Card ${index + 1}`;
  if (card.matched === 'you') return `${where}, ${card.face}, matched by you`;
  if (card.matched === 'them') return `${where}, ${card.face}, matched by ${partner}`;
  if (card.faceUp) return `${where}, ${card.face}`;
  return `${where}, face down`;
}

/** The line above the board, which is the only instruction this game ever needs. */
function status(view: MemoryView, partner: string): string {
  if (view.complete) {
    if (view.outcome === 'won') return 'More pairs than them — yours 🎉';
    if (view.outcome === 'lost') return `${partner} remembered better 😤`;
    return 'Five each. Dead heat 🤝';
  }
  if (view.paused) return 'Holding the cards there…';
  if (view.peeking) return view.yourTurn ? 'Not a pair…' : 'Look at those two 👀';
  if (view.yourTurn) return view.lastFlipMatched ? 'A pair! Go again' : 'Your turn — turn one over';
  return `${partner} is looking…`;
}

export default function MemoryGame({ view, you, partner, act }: GameRenderProps<MemoryView>) {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);

  const turn = useCallback(
    (index: number) => {
      const card = view.cards[index];
      if (!view.yourTurn || !card || card.matched !== null || card.faceUp) return;
      act({ type: 'flip', card: index });
    },
    [act, view.yourTurn, view.cards],
  );

  // Left/right walk the row, up/down the column, Home and End jump to the ends of the board.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = view.cards.length - 1;
      const target =
        event.key === 'ArrowLeft'
          ? Math.max(0, index - 1)
          : event.key === 'ArrowRight'
            ? Math.min(last, index + 1)
            : event.key === 'ArrowUp'
              ? Math.max(0, index - view.columns)
              : event.key === 'ArrowDown'
                ? Math.min(last, index + view.columns)
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? last
                    : null;

      if (target === null) return;
      event.preventDefault();
      cards.current[target]?.focus();
    },
    [view.cards.length, view.columns],
  );

  return (
    <section className="flex flex-col gap-3" aria-label="Memory">
      <p
        className="text-center font-display text-lg font-semibold text-ink"
        // Polite, not assertive: a turn passing is worth knowing about, but it should wait for a
        // gap rather than cut across whatever the player is already being read.
        aria-live="polite"
      >
        {status(view, partner.nickname)}
      </p>

      <div
        className="mx-auto grid w-full max-w-sm gap-2 rounded-card bg-lilac p-2 shadow-soft sm:p-3"
        style={{ gridTemplateColumns: `repeat(${view.columns}, minmax(0, 1fr))` }}
      >
        {view.cards.map((card, index) => {
          const claimed = card.matched !== null;
          const showing = card.faceUp || claimed;
          const playable = view.yourTurn && !claimed && !card.faceUp;

          return (
            <button
              key={index}
              type="button"
              ref={(node) => {
                cards.current[index] = node;
              }}
              onClick={() => turn(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              disabled={!playable}
              aria-label={label(card, index, partner.nickname)}
              // `touch-none` stops a quick second tap being read as a zoom; `select-none` stops a
              // drag across the board selecting emoji instead of playing.
              className={`flex aspect-square touch-none select-none items-center justify-center rounded-soft text-3xl transition-all duration-soft ease-bounce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry sm:text-4xl ${
                showing ? 'bg-shell' : 'bg-berry/90 text-transparent'
              } ${claimed ? 'opacity-60 ring-4' : ''} ${
                card.matched === 'you' ? 'ring-berry' : card.matched === 'them' ? 'ring-ink' : ''
              } ${playable ? 'hover:scale-105 hover:bg-berry' : 'cursor-default'} ${
                // The pair being looked at is the thing on screen worth looking at.
                card.faceUp && !claimed ? 'scale-105 ring-4 ring-butter' : ''
              }`}
            >
              {/* Face down draws a back rather than an empty box — and the back is the same for
                  every card, because a card that looked different from its neighbours would be
                  giving something away. */}
              <span aria-hidden="true">{card.face ?? '✳︎'}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-5 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-pill bg-berry" aria-hidden="true" />
          {you.nickname} · {view.yourPairs}
          {view.youStarted && <span className="text-muted/70">· went first</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-pill bg-ink" aria-hidden="true" />
          {partner.nickname} · {view.theirPairs}
          {!view.youStarted && <span className="text-muted/70">· went first</span>}
        </span>
      </div>
    </section>
  );
}
