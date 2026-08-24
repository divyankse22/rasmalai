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
import { usePartnerPresence } from '@/features/presence/usePartnerPresence';
import { CreateTournamentModal } from '@/features/tournament/CreateTournamentModal';
import { getFromApi, postToApi } from '@/lib/clientApi';
import { useRealtimeEvent, useResyncOnReconnect } from '@/realtime/RealtimeProvider';

/**
 * The tournament entry point, in whichever of its states the couple is in: nothing yet, running,
 * paused, or between games. A request waiting on an answer is the one state it does not draw —
 * that belongs to `TournamentRequestCentre`, which is in the layout and so is on every page.
 *
 * The card asks the server once on mount and is kept live by the socket after that — the same
 * arrangement as everything else that two people can change from two devices. Without it, one
 * partner starting a series would leave the other looking at a "Start a tournament" button that
 * cannot work.
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
  const { online } = usePartnerPresence();
  const [tournament, setTournament] = useState<TournamentView | null>(null);
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

  /**
   * A request neither of them has answered yet belongs to `TournamentRequestCentre`, which is in
   * the layout and therefore on whichever page the person is actually reading.
   *
   * Nothing here rather than the "Start a tournament" button below: a second request would be
   * refused with a 409, and the sheet asking about the first one is already on screen.
   */
  if (tournament && tournament.status === 'pending') return null;

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
          <p className="text-xs text-muted">
            They are offline. Try when they are online next time.
          </p>
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
