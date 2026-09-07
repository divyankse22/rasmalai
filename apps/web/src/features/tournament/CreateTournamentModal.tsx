'use client';

import { useState } from 'react';
import {
  TOURNAMENT_MAX_GAMES,
  TOURNAMENT_MIN_GAMES,
  type CatalogueGame,
  type TournamentView,
} from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { TextField } from '@/design-system/Field';
import { CATEGORY_LABEL, gameGlyph } from '@/features/dashboard/gameGlyphs';
import { postToApi } from '@/lib/clientApi';

/**
 * Building a tournament: a name and a run of games, locked once it starts.
 *
 * Only games with a module behind them are offered — the catalogue lists what the product will be,
 * but a series that reached an unbuilt game would simply stop. Each may be picked once (D-2), which
 * is also why the list is checkboxes rather than a counter.
 *
 * Submitting sends a *request* rather than starting anything — the partner still has to answer it,
 * the same way a game invitation works. `onCreated` hands the pending tournament straight to the
 * caller so the dashboard can show "waiting for them" immediately, without a blink before the
 * `tournament.request.created` socket echo confirms the same thing a moment later.
 */
export function CreateTournamentModal({
  games,
  onClose,
  onCreated,
}: {
  games: CatalogueGame[];
  onClose: () => void;
  onCreated: (tournament: TournamentView) => void;
}) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const playable = games.filter((game) => game.enabled);
  const enough = picked.length >= TOURNAMENT_MIN_GAMES;
  const full = picked.length >= TOURNAMENT_MAX_GAMES;

  function toggle(slug: string) {
    setError(undefined);
    setPicked((current) =>
      current.includes(slug)
        ? current.filter((candidate) => candidate !== slug)
        : // Order is the order they were picked, which is the order they will be played. Silently
          // reordering somebody's evening would be a surprise at game three.
          current.length >= TOURNAMENT_MAX_GAMES
          ? current
          : [...current, slug],
    );
  }

  async function submit() {
    setBusy(true);
    setError(undefined);

    const result = await postToApi<{ tournament: TournamentView }>('/api/tournaments', {
      name: name.trim(),
      gameSlugs: picked,
    });

    if (result.ok) {
      onCreated(result.data.tournament);
      onClose();
      return;
    }

    setBusy(false);
    setError(result.error.message);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Start a tournament"
    >
      <Card className="flex w-full max-w-app flex-col gap-4">
        <div className="flex flex-col gap-1 text-center">
          <span className="text-2xl" aria-hidden="true">
            🏆
          </span>
          <h2 className="font-display text-lg font-bold text-ink">Start a tournament</h2>
          <p className="text-sm text-muted">
            Pick {TOURNAMENT_MIN_GAMES}–{TOURNAMENT_MAX_GAMES} games. They are locked once your
            partner accepts, and played in the order you pick them.
          </p>
        </div>

        <TextField
          label="Call it something"
          value={name}
          maxLength={40}
          placeholder="Friday night"
          onChange={(event) => setName(event.target.value)}
        />

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-sm font-semibold text-ink">Games</span>
            <span className={`text-xs ${enough ? 'text-muted' : 'text-berry'}`} role="status">
              {picked.length} of {TOURNAMENT_MIN_GAMES}–{TOURNAMENT_MAX_GAMES}
            </span>
          </div>

          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {playable.map((game) => {
              const at = picked.indexOf(game.slug);
              const chosen = at !== -1;

              return (
                <li key={game.slug}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-soft px-3 py-2 ${
                      chosen ? 'bg-blush' : 'bg-cream'
                    } ${!chosen && full ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-berry"
                      checked={chosen}
                      // Not `disabled`: a full list must still let you take something back out, and
                      // only the unchecked ones are out of reach.
                      disabled={!chosen && full}
                      onChange={() => toggle(game.slug)}
                    />
                    <span className="text-xl" aria-hidden="true">
                      {gameGlyph(game.slug)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-display text-sm font-semibold text-ink">
                        {game.name}
                      </span>
                      <span className="text-xs text-muted">
                        {CATEGORY_LABEL[game.category]?.title ?? game.category}
                        {game.category !== 'competitive' && ' · unscored'}
                      </span>
                    </span>
                    {chosen && (
                      <span
                        className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-berry font-display text-xs font-bold text-shell tabular-nums"
                        aria-label={`Game ${at + 1}`}
                      >
                        {at + 1}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>

          {/* P-4, said once rather than on every row it applies to. */}
          {picked.some((slug) => playable.find((game) => game.slug === slug)?.category !== 'competitive') && (
            <p className="text-xs text-muted">
              Only competitive games score. The rest still count as rounds you played together.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-berry" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="soft" className="flex-1" onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button
            className="flex-1"
            disabled={busy || !enough || name.trim().length === 0}
            onClick={() => void submit()}
          >
            {busy ? 'Asking…' : 'Ask 🏆'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
