'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  EVENTS,
  type CatalogueGame,
  type TournamentNextGamePayload,
  type TournamentRequestCreatedPayload,
  type TournamentUpdatedPayload,
  type TournamentView,
} from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { PersonName } from '@/design-system/PersonName';
import { gameGlyph } from '@/features/dashboard/gameGlyphs';
import { avatarGlyph } from '@/features/onboarding/avatars';
import { usePartnerPresence } from '@/features/presence/usePartnerPresence';
import { formatClock, useCountdown } from '@/features/play/useCountdown';
import { CreateTournamentModal } from '@/features/tournament/CreateTournamentModal';
import { getFromApi, postToApi } from '@/lib/clientApi';
import { useRealtimeEvent, useResyncOnReconnect } from '@/realtime/RealtimeProvider';

/**
 * The tournament entry point, in whichever of its states the couple is in: nothing yet, a request
 * awaiting an answer either way, running, paused, or between games.
 *
 * The card asks the server once on mount and is kept live by the socket after that — the same
 * arrangement as everything else that two people can change from two devices. Without it, one
 * partner requesting a series would leave the other looking at a "Start a tournament" button that
 * cannot work, or never learning a request arrived at all.
 */

/** Terminal without ever having played a game: the couple is free to try again. */
const TOURNAMENT_TERMINAL_STATUSES = new Set<TournamentView['status']>([
  'completed',
  'abandoned',
  'declined',
  'expired',
  'cancelled',
]);

/** How long a paused series has left, in the roughest units that are still true. */
function timeLeft(pausedUntil: string): string {
  const ms = new Date(pausedUntil).getTime() - Date.now();
  if (ms <= 0) return 'expiring now';

  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)} day${hours >= 48 ? 's' : ''} left`;
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} left`;
  return `${Math.max(1, Math.round(ms / 60_000))} min left`;
}

export function TournamentCard({ games }: { games: CatalogueGame[] }) {
  const router = useRouter();
  const { online, partner } = usePartnerPresence();
  const [tournament, setTournament] = useState<TournamentView | null>(null);
  // Called unconditionally, as every hook must be — `deadline` is only ever non-null while a
  // request is `pending`, which is the only state that renders it.
  const expiresInSeconds = useCountdown(
    tournament?.expiresAt ? new Date(tournament.expiresAt).getTime() : null,
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const data = await getFromApi<{
      tournament: TournamentView | null;
      activeSessionId: string | null;
    }>('/api/tournaments/active');
    if (!data) return;
    setTournament(data.tournament);
    setSessionId(data.activeSessionId);
  }, []);

  // Asked for once on mount and kept live by the socket after that. The cancel flag is what stops a
  // slow answer from landing on a card that has already been unmounted.
  useEffect(() => {
    let cancelled = false;

    void getFromApi<{
      tournament: TournamentView | null;
      activeSessionId: string | null;
    }>('/api/tournaments/active').then((data) => {
      if (cancelled || !data) return;
      setTournament(data.tournament);
      setSessionId(data.activeSessionId);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // A socket that dropped missed whatever happened while it was down, so the whole answer is asked
  // for again rather than patched up from what the card was showing.
  useResyncOnReconnect(() => void load());

  useRealtimeEvent(
    useCallback(
      (envelope) => {
        if (envelope.type === EVENTS.results.tournamentNextGame) {
          const { sessionId: next } = envelope.payload as TournamentNextGamePayload;
          // Both partners get this, which is what moves the one who did not press the button.
          router.push(`/play/${next}`);
          return;
        }

        // A brand-new request, incoming or outgoing — the one moment this card has nothing in
        // state yet to patch, same reason `invitation.created` is its own event.
        if (envelope.type === EVENTS.tournamentRequest.created) {
          const { tournament: next } = envelope.payload as TournamentRequestCreatedPayload;
          setTournament(next);
          setError(undefined);
          return;
        }

        if (
          envelope.type === EVENTS.results.tournamentUpdated ||
          envelope.type === EVENTS.results.tournamentGameResult
        ) {
          const { tournament: next } = envelope.payload as TournamentUpdatedPayload;
          // Terminal with nothing to show for it — completed, abandoned, or a request that was
          // declined, cancelled, or left to expire — and the card goes back to offering a new one.
          setTournament(TOURNAMENT_TERMINAL_STATUSES.has(next.status) ? null : next);
        }
      },
      [router],
    ),
  );

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(undefined);

    const result = await postToApi<{ sessionId?: string }>(path, body);
    if (result.ok) {
      if (result.data.sessionId) router.push(`/play/${result.data.sessionId}`);
      else await load();
      setBusy(false);
      return;
    }

    setBusy(false);
    setError(result.error.message);
  }

  const header = (
    <>
      <span className="text-2xl" aria-hidden="true">
        🏆
      </span>
      <h2 className="font-display text-base font-semibold text-ink">Tournaments</h2>
    </>
  );

  // A request neither of them has answered yet — the other partner accepting or declining, or the
  // creator withdrawing, is what moves it out of this branch (`tournament.updated`) or into a
  // running series (`tournament.next_game`).
  if (tournament && tournament.status === 'pending') {
    return (
      <Card className="flex flex-col items-center gap-2 text-center">
        {header}
        {tournament.direction === 'incoming' ? (
          <>
            <span className="text-3xl" aria-hidden="true">
              {avatarGlyph(partner?.avatarKey ?? 'fox')}
            </span>
            <p className="text-sm text-ink">
              <PersonName name={partner?.nickname ?? 'They'} gender={partner?.gender} /> wants to
              start <span className="font-semibold">{tournament.name}</span>
            </p>
            <ul className="flex flex-wrap justify-center gap-1.5">
              {tournament.games.map((game) => (
                <li
                  key={game.position}
                  className="flex items-center gap-1 rounded-pill bg-cream px-2.5 py-1 text-xs text-ink"
                >
                  <span aria-hidden="true">{gameGlyph(game.gameSlug)}</span>
                  {game.gameName}
                  {!game.scored && <span className="text-muted">· unscored</span>}
                </li>
              ))}
            </ul>
            <div className="flex w-full gap-2">
              <Button
                variant="soft"
                className="flex-1"
                disabled={busy}
                onClick={() => void act(`/api/tournaments/${tournament.id}/respond`, { accept: false })}
              >
                🙈 Not now
              </Button>
              <Button
                className="flex-1"
                disabled={busy}
                onClick={() => void act(`/api/tournaments/${tournament.id}/respond`, { accept: true })}
              >
                ❤️ Play
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Waiting for{' '}
              <PersonName name={partner?.nickname ?? 'them'} gender={partner?.gender} /> to answer{' '}
              <span className="font-semibold text-ink">{tournament.name}</span>…
            </p>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void act(`/api/tournaments/${tournament.id}/cancel`)}
            >
              Never mind
            </Button>
          </>
        )}
        {expiresInSeconds !== null && (
          <p className="text-xs text-muted" role="timer">
            {formatClock(expiresInSeconds)} left to answer
          </p>
        )}
        {error && (
          <p className="text-sm text-berry" role="alert">
            {error}
          </p>
        )}
      </Card>
    );
  }

  // Running right now: the way back in is the session, not a new series.
  if (tournament && tournament.status === 'active') {
    return (
      <Card className="flex flex-col items-center gap-2 text-center">
        {header}
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">{tournament.name}</span> is in progress — game{' '}
          {Math.min(tournament.currentPosition, tournament.games.length)} of{' '}
          {tournament.games.length}, {tournament.yourTotalPoints}–{tournament.partnerTotalPoints}.
        </p>
        {sessionId ? (
          <Button onClick={() => router.push(`/play/${sessionId}`)}>Back to the game</Button>
        ) : (
          <p className="text-xs text-muted">Waiting for the next game to open…</p>
        )}
      </Card>
    );
  }

  // Paused, and on a clock (D-5).
  if (tournament && tournament.status === 'paused') {
    return (
      <Card className="flex flex-col items-center gap-2 text-center">
        {header}
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">{tournament.name}</span> is paused at{' '}
          {tournament.yourTotalPoints}–{tournament.partnerTotalPoints}, with{' '}
          {tournament.games.length - tournament.currentPosition + 1} to play.
        </p>
        {tournament.pausedUntil && (
          <p className="text-xs text-berry">{timeLeft(tournament.pausedUntil)}</p>
        )}

        <div className="flex w-full flex-col items-center gap-1">
          <Button
            className="w-full"
            disabled={busy || online === false}
            onClick={() => void act(`/api/tournaments/${tournament.id}/resume`)}
          >
            {busy ? 'Picking it up…' : 'Resume 🏆'}
          </Button>
          {online === false && (
            <p className="text-xs text-muted">They need to be online to carry on.</p>
          )}
          <Button
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={() => void act(`/api/tournaments/${tournament.id}/abandon`)}
          >
            Give it up
          </Button>
        </div>

        {error && (
          <p className="text-sm text-berry" role="alert">
            {error}
          </p>
        )}
      </Card>
    );
  }

  return (
    <>
      <Card className="flex flex-col items-center gap-2 text-center">
        {header}
        <p className="text-sm text-muted">
          Pick a run of games, lock them in, and play for points. Win 3, draw 1, lose 0.
        </p>
        <Button disabled={online === false} onClick={() => setCreating(true)}>
          Start a tournament
        </Button>
        {/* `null` means our own connection is down, and not being able to tell is no reason to stop
            somebody playing. Only a definite "they are not here" disables the button. */}
        {online === false && (
          <p className="text-xs text-muted">They are offline. Try when they are online next time.</p>
        )}
      </Card>

      {creating && (
        <CreateTournamentModal
          games={games}
          onClose={() => setCreating(false)}
          onCreated={(next) => setTournament(next)}
        />
      )}
    </>
  );
}
