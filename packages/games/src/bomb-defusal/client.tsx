'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GameRenderProps } from '../contract';
import type { BombDefusalView, Colour } from './protocol';

/**
 * Bomb Defusal, on screen — both screens.
 *
 * One component, two layouts, chosen by the role the server put this reader in. It decides nothing
 * and knows nothing it should not: the expert's copy of the wires arrives with `colour: null` until
 * it is reported, and the defuser's copy of the manual never arrives at all.
 *
 * Input, per `docs/06`: everything is a full-width button. The defuser taps a wire to tell their
 * partner what colour it is, and holds the same wire's Cut button to cut it — a *second*, separate
 * control, because "tap the thing" and "cut the thing" being the same gesture on a bomb is a way to
 * lose a match to a fat thumb.
 *
 * Colour is never the only signal: every wire says its colour in words as well as in colour, which
 * matters more here than anywhere else in the app — the whole game is one person reading colours
 * out to another.
 */

/** The stripe down a wire. Named in words beside it, always. */
const WIRE_COLOUR: Record<Colour, string> = {
  red: 'bg-berry',
  blue: 'bg-sky',
  yellow: 'bg-butter',
  white: 'bg-shell',
};

/** Seconds left on the fuse, counted down locally from the server's deadline.
 *
 * The server owns when it goes off; this only draws the number. A client whose clock is a second
 * out shows a second's difference and decides nothing by it.
 */
function useFuse(explodesAt: number | null): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (explodesAt === null) {
      setNow(null);
      return;
    }

    const sync = () => setNow(Date.now());
    sync();
    const timer = setInterval(sync, 250);
    return () => clearInterval(timer);
  }, [explodesAt]);

  if (explodesAt === null || now === null) return null;
  return Math.max(0, Math.ceil((explodesAt - now) / 1000));
}

function Fuse({ view }: { view: BombDefusalView }) {
  const seconds = useFuse(view.complete ? null : view.explodesAt);

  const label = view.paused
    ? 'paused'
    : seconds === null
      ? '—'
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted">
      <span>
        Bomb {view.stage} of {view.stages}
      </span>
      <span
        className={`font-display text-lg tabular-nums ${
          seconds !== null && seconds <= 20 ? 'text-berry' : 'text-ink'
        }`}
        role="timer"
      >
        {label}
      </span>
      <span aria-label={`${view.strikes} of ${view.maxStrikes} strikes`}>
        {Array.from({ length: view.maxStrikes }, (_, index) => (
          <span key={index} aria-hidden="true">
            {index < view.strikes ? '✖️' : '·'}
          </span>
        ))}
      </span>
    </div>
  );
}

/** The line at the top, which is the only instruction either of them ever needs. */
function status(view: BombDefusalView, partner: string): string {
  if (view.complete) return view.outcome === 'defused' ? 'Defused. Both of you 🎉' : 'Boom 💥';
  if (view.paused) return 'Fuse held — waiting for them…';
  if (view.lastCut && !view.lastCut.correct) return 'Wrong one. New bomb, same clock 😬';
  if (view.role === 'defuser') {
    return view.pointedAt === null
      ? `Tell ${partner} what you can see`
      : `${partner} says cut wire ${view.pointedAt + 1}`;
  }
  return view.wires.some((wire) => wire.reported)
    ? 'Read the manual. Point at one.'
    : `Waiting for ${partner} to describe it…`;
}

export default function BombDefusalGame({ view, partner, act }: GameRenderProps<BombDefusalView>) {
  const report = useCallback((wire: number) => act({ type: 'report', wire }), [act]);
  const cut = useCallback((wire: number) => act({ type: 'cut', wire }), [act]);
  const point = useCallback((wire: number) => act({ type: 'point', wire }), [act]);

  const live = !view.complete && !view.paused;

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-3" aria-label="Bomb Defusal">
      <Fuse view={view} />

      <p className="text-center font-display text-lg font-semibold text-ink" aria-live="polite">
        {status(view, partner.nickname)}
      </p>

      <p className="text-center text-xs text-muted">
        {view.role === 'defuser'
          ? 'You are holding the bomb. You cannot see the manual.'
          : 'You are holding the manual. You cannot see the bomb.'}
      </p>

      <ul className="flex flex-col gap-2 rounded-card bg-lilac p-2 shadow-soft sm:p-3">
        {view.wires.map((wire, index) => {
          const pointed = view.pointedAt === index;

          return (
            <li
              key={index}
              className={`flex items-center gap-2 rounded-soft bg-cream p-2 transition-all duration-quick ${
                pointed ? 'ring-4 ring-butter' : ''
              } ${wire.cut ? 'opacity-40' : ''}`}
            >
              <span className="w-5 shrink-0 text-center text-xs text-muted" aria-hidden="true">
                {index + 1}
              </span>

              {/* The wire itself. Blank for an expert who has not been told, which is not a
                  rendering choice — the colour is simply not in the frame. */}
              <span
                className={`h-3 flex-1 rounded-pill ${
                  wire.colour ? WIRE_COLOUR[wire.colour] : 'bg-muted/20'
                } ${wire.cut ? 'opacity-30' : ''}`}
                aria-hidden="true"
              />

              <span className="w-16 shrink-0 text-xs text-muted">{wire.colour ?? '???'}</span>

              {view.role === 'defuser' ? (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => report(index)}
                    disabled={!live || wire.reported}
                    aria-label={`Tell ${partner.nickname} that wire ${index + 1} is ${wire.colour}`}
                    className="rounded-pill bg-shell px-3 py-1 text-xs text-ink transition-colors duration-quick enabled:hover:bg-blush disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
                  >
                    {wire.reported ? 'told' : 'tell'}
                  </button>
                  <button
                    type="button"
                    onClick={() => cut(index)}
                    disabled={!live}
                    aria-label={`Cut wire ${index + 1}${pointed ? ', the one they pointed at' : ''}`}
                    className="rounded-pill bg-berry px-3 py-1 text-xs font-semibold text-shell transition-colors duration-quick enabled:hover:bg-berry-deep disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
                  >
                    cut
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => point(index)}
                  disabled={!live}
                  aria-pressed={pointed}
                  aria-label={`Tell ${partner.nickname} to cut wire ${index + 1}`}
                  className="shrink-0 rounded-pill bg-shell px-3 py-1 text-xs text-ink transition-colors duration-quick enabled:hover:bg-blush disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
                >
                  {pointed ? 'pointing' : 'point'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* The expert's half. It simply is not here for the defuser — there is nothing to hide,
          because there is nothing in the frame to hide. */}
      {view.manual && (
        <ol className="flex flex-col gap-1.5 rounded-card bg-cream p-3 text-sm text-ink">
          <li className="font-display text-xs font-semibold text-muted">
            THE MANUAL — first rule that fits
          </li>
          {view.manual.map((rule, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-muted" aria-hidden="true">
                {index + 1}.
              </span>
              <span>{rule}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
