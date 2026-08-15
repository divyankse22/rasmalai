import type { CatalogueGame } from '@rasmalai/shared';
import { ButtonLink } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { gameGlyph } from './gameGlyphs';

/** How many glyphs to show before giving up and counting the rest. Four fits one row on a phone. */
const PREVIEW = 4;

/**
 * The way into the games from the dashboard.
 *
 * A taste rather than the whole catalogue: the dashboard is about the two of them and how they are
 * doing, and seventeen game cards buried the part it exists to show. The glyphs come from the real
 * catalogue, so this cannot advertise a game that is not there.
 */
export function PlayTeaser({ games }: { games: CatalogueGame[] }) {
  const preview = games.slice(0, PREVIEW);
  const remaining = games.length - preview.length;

  return (
    <Card className="flex flex-col items-center gap-3 text-center">
      <span className="text-2xl" aria-hidden="true">
        🎮
      </span>
      <h2 className="font-display text-base font-semibold text-ink">Want to play some games?</h2>

      {preview.length > 0 && (
        <p className="flex flex-wrap items-center justify-center gap-2 text-xl" aria-hidden="true">
          {preview.map((game) => (
            <span
              key={game.slug}
              className="flex size-9 items-center justify-center rounded-pill bg-cream"
            >
              {gameGlyph(game.slug)}
            </span>
          ))}
          {remaining > 0 && <span className="text-sm text-muted">+{remaining} more</span>}
        </p>
      )}

      <ButtonLink href="/games">Play games</ButtonLink>
    </Card>
  );
}
