import type { TournamentView } from '@rasmalai/shared';
import { Card } from '@/design-system/Card';
import { gameGlyph } from '@/features/dashboard/gameGlyphs';

/**
 * Where the series stands, on the play screen.
 *
 * Three things are deliberately *not* shown: the games still to come are named but never scored,
 * an unscored round shows "—" rather than a zero (D-6), and nothing here hints at what is coming
 * after the next game beyond its name. The list is revealed as it is played (D-3), and a scoreboard
 * that quietly previewed the whole evening would undo that.
 *
 * Compact by design — it sits above a live game and must never be the thing competing for the
 * screen.
 */

function Points({ value }: { value: number | null }) {
  // P-4: a cooperative or social round happened, and happened to both of them. Printing a 0 would
  // read as a loss for a game that has no such thing.
  if (value === null) return <span className="text-muted">—</span>;
  return <span className="tabular-nums">{value}</span>;
}

function GameRow({
  game,
  isCurrent,
}: {
  game: TournamentView['games'][number];
  isCurrent: boolean;
}) {
  const done = game.status === 'completed';

  return (
    <li
      className={`flex items-center gap-2 rounded-soft px-2 py-1.5 text-sm ${
        isCurrent ? 'bg-blush' : done ? 'bg-cream' : 'bg-cream/50'
      }`}
    >
      <span className="w-4 text-xs text-muted tabular-nums">{game.position}</span>
      <span className={`text-base ${done || isCurrent ? '' : 'grayscale opacity-60'}`} aria-hidden="true">
        {gameGlyph(game.gameSlug)}
      </span>
      <span className={`min-w-0 flex-1 truncate ${isCurrent ? 'font-semibold text-ink' : 'text-muted'}`}>
        {game.gameName}
      </span>

      {done ? (
        <span className="font-display font-semibold text-ink">
          <Points value={game.yourPoints} />
          <span className="px-1 text-muted">–</span>
          <Points value={game.partnerPoints} />
        </span>
      ) : (
        <span className="text-xs text-muted">{isCurrent ? 'now' : 'to come'}</span>
      )}
    </li>
  );
}

export function TournamentScoreboard({ tournament }: { tournament: TournamentView }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true">🏆</span>
          <h2 className="min-w-0 truncate font-display text-sm font-semibold text-ink">
            {tournament.name}
          </h2>
        </div>
        <p className="shrink-0 font-display text-lg font-bold text-berry tabular-nums">
          {tournament.yourTotalPoints}
          <span className="px-1 text-muted">–</span>
          {tournament.partnerTotalPoints}
        </p>
      </div>

      <p className="text-xs text-muted">
        Game {Math.min(tournament.currentPosition, tournament.games.length)} of{' '}
        {tournament.games.length} · win 3, draw 1, lose 0
      </p>

      <ul className="flex flex-col gap-1">
        {tournament.games.map((game) => (
          <GameRow
            key={game.position}
            game={game}
            isCurrent={game.position === tournament.currentPosition && game.status !== 'completed'}
          />
        ))}
      </ul>
    </Card>
  );
}

/**
 * The end of the series — the only place a tournament announces a winner.
 *
 * A tournament with no competitive games in it has nobody to name, and says so rather than
 * inventing a competition the evening did not have (confirmed assumption 4 in `docs/13`).
 */
export function TournamentFinale({ tournament }: { tournament: TournamentView }) {
  const nobodyWon = tournament.winner === null;
  const drawn = nobodyWon && tournament.yourTotalPoints === tournament.partnerTotalPoints;

  return (
    <Card className="flex flex-col items-center gap-2 text-center">
      <span className="text-4xl" aria-hidden="true">
        {tournament.winner === 'you' ? '🏆' : tournament.winner === 'partner' ? '💔' : '🤝'}
      </span>
      <p className="font-display text-xl font-bold text-ink">
        {tournament.winner === 'you'
          ? 'You took the whole thing!'
          : tournament.winner === 'partner'
            ? 'They took the whole thing'
            : drawn
              ? 'Dead level, all the way'
              : 'That is the lot'}
      </p>
      <p className="font-display text-lg text-muted tabular-nums">
        <span className="text-ink">{tournament.yourTotalPoints}</span>
        <span className="px-2">—</span>
        <span className="text-ink">{tournament.partnerTotalPoints}</span>
      </p>
      <p className="text-xs text-muted">{tournament.name}</p>
    </Card>
  );
}
