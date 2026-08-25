'use client';

import type { HowToPlay } from '@rasmalai/games';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';

/**
 * A game's rules, shown once before the first match of a session.
 *
 * Deliberately dumb: it is handed its copy and resolves nothing, so it has no opinion about
 * sessions and can be tested with a literal. `PlayScreen` decides whether it is on screen.
 *
 * `<h2>` rather than `<h1>`, because `PlayScreen` keeps the game's name as the page's `<h1>` above
 * this — the reader can already see which game they are about to play, and saying it twice would
 * put two page headings on one screen.
 *
 * There is no dialog role and no focus trap, and there should not be: this *replaces* the lobby
 * rather than floating over it, so there is nothing behind it to trap focus away from. The property
 * that matters — nobody can be counted down into a game they are still reading about — comes from
 * the ready button not existing yet, not from an overlay swallowing clicks.
 */
export function HowToPlayScreen({
  howToPlay,
  gameName,
  onDismiss,
}: {
  howToPlay: HowToPlay;
  gameName: string;
  onDismiss: () => void;
}) {
  return (
    <Card className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-display text-lg font-bold text-blueberry-deep">How to play</h2>
        <p className="text-sm text-ink">{howToPlay.tagline}</p>
      </div>

      <ol className="flex flex-col gap-3" aria-label={`How to play ${gameName}`}>
        {howToPlay.steps.map((step, index) => (
          <li key={step} className="flex items-start gap-3 text-sm text-muted">
            {/* The <ol> already numbers this for a screen reader. The drawn numeral is decoration,
                and announcing it would read every step twice. */}
            <span
              className="mt-px flex size-6 shrink-0 items-center justify-center rounded-pill bg-sky font-display text-xs font-bold tabular-nums text-ink"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <Button className="mt-auto w-full" onClick={onDismiss}>
        Got it ✨
      </Button>
    </Card>
  );
}
