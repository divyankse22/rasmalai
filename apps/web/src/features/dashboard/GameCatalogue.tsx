import { GAME_CATEGORIES, type CatalogueGame } from '@rasmalai/shared';
import { Card } from '@/design-system/Card';
import { CATEGORY_LABEL, gameGlyph } from './gameGlyphs';

/**
 * The catalogue, straight from the database.
 *
 * `enabled` means the game module exists — it is not progression. Everything is unlocked in V1
 * (CLAUDE.md), so an unbuilt game is shown, described and marked as coming rather than hidden:
 * the two of them can see what the product is going to be, and cannot start something that would
 * fail.
 */
function GameRow({ game }: { game: CatalogueGame }) {
  const played = game.plays > 0;

  return (
    <li
      className={`flex items-start gap-3 rounded-soft px-3 py-3 ${
        game.enabled ? 'bg-cream' : 'bg-cream/60'
      }`}
    >
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-pill bg-shell text-xl ${
          game.enabled ? '' : 'grayscale'
        }`}
        aria-hidden="true"
      >
        {gameGlyph(game.slug)}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-display font-semibold text-ink">{game.name}</span>
          {!game.enabled && (
            <span className="rounded-pill bg-butter px-2 py-0.5 text-xs text-muted">soon</span>
          )}
        </div>
        <p className="text-sm text-muted">{game.description}</p>

        {played && (
          <p className="text-xs text-muted">
            {game.plays} {game.plays === 1 ? 'play' : 'plays'} · {game.yourWins}–{game.partnerWins}
            {game.draws > 0 && ` · ${game.draws} drawn`}
            {/* Best score is per game on purpose: a basketball 34 and a five-round win are not
                the same kind of number, and one global "best score" would compare them. */}
            {game.yourBestScore !== null && ` · best ${game.yourBestScore}`}
          </p>
        )}
      </div>
    </li>
  );
}

export function GameCatalogue({ games }: { games: CatalogueGame[] }) {
  return (
    <div className="flex flex-col gap-5">
      {GAME_CATEGORIES.map((category) => {
        const inCategory = games.filter((game) => game.category === category);
        if (inCategory.length === 0) return null;

        const label = CATEGORY_LABEL[category];

        return (
          <Card key={category} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="font-display text-base font-semibold text-ink">{label?.title}</h2>
              <p className="text-xs text-muted">{label?.blurb}</p>
            </div>
            <ul className="flex flex-col gap-2">
              {inCategory.map((game) => (
                <GameRow key={game.slug} game={game} />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
