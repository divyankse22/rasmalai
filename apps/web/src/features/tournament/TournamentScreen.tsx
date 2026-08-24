'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  EVENTS,
  type TournamentNextGamePayload,
  type TournamentUpdatedPayload,
  type TournamentView,
} from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { TournamentFinale, TournamentScoreboard } from '@/features/tournament/TournamentScoreboard';
import { getFromApi } from '@/lib/clientApi';
import { useRealtimeEvent, useResyncOnReconnect } from '@/realtime/RealtimeProvider';

/**
 * One tournament's own page: the standings while it runs, the finale once it is done.
 *
 * Deliberately its own route rather than a card on the live game (`PlayScreen`) or a section of the
 * dashboard — the series is a thing you check on, not a thing that has to share the screen with
 * whichever game is currently being played, and the finale needs somewhere to be shown that
 * outlives the last game's own result screen.
 */

/** A tournament with nothing to show for it — declined, cancelled, expired, or abandoned before it
 * ended naturally. `TournamentFinale` is for a series that reached its last game; this is for one
 * that never did. */
function TournamentAbsence({ tournament }: { tournament: TournamentView }) {
  const sentence: Record<'abandoned' | 'declined' | 'expired' | 'cancelled', string> = {
    abandoned: 'This one was given up partway through.',
    declined: 'This request was not accepted.',
    expired: 'Nobody answered this request in time.',
    cancelled: 'This request was withdrawn.',
  };

  return (
    <Card className="flex flex-col items-center gap-2 text-center">
      <span className="text-4xl" aria-hidden="true">
        🌙
      </span>
      <p className="font-display text-lg font-semibold text-ink">{tournament.name}</p>
      <p className="text-sm text-muted">
        {sentence[tournament.status as 'abandoned' | 'declined' | 'expired' | 'cancelled']}
      </p>
    </Card>
  );
}

export function TournamentScreen({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const [tournament, setTournament] = useState<TournamentView | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const data = await getFromApi<{ tournament: TournamentView }>(`/api/tournaments/${tournamentId}`);
    if (!data) {
      setNotFound(true);
      return;
    }
    setTournament(data.tournament);
  }, [tournamentId]);

  // Asked for once on mount and kept live by the socket after that. The cancel flag is what stops a
  // slow answer from landing on a page that has already been navigated away from.
  useEffect(() => {
    let cancelled = false;

    void getFromApi<{ tournament: TournamentView }>(`/api/tournaments/${tournamentId}`).then(
      (data) => {
        if (cancelled) return;
        if (!data) {
          setNotFound(true);
          return;
        }
        setTournament(data.tournament);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  // A socket that dropped missed whatever happened while it was down, so the whole answer is asked
  // for again rather than patched up from what the page was showing.
  useResyncOnReconnect(() => void load());

  useRealtimeEvent(
    useCallback(
      (envelope) => {
        // The series moved on to a game this page cannot show — go with it, the same way the
        // dashboard's tournament card does, so neither partner is left looking at a stale scoreboard
        // for a game that has already started.
        if (envelope.type === EVENTS.results.tournamentNextGame) {
          const { sessionId, tournament: next } = envelope.payload as TournamentNextGamePayload;
          if (next.id !== tournamentId) return;
          router.push(`/play/${sessionId}`);
          return;
        }

        if (
          envelope.type === EVENTS.results.tournamentUpdated ||
          envelope.type === EVENTS.results.tournamentGameResult
        ) {
          const { tournament: next } = envelope.payload as TournamentUpdatedPayload;
          if (next.id === tournamentId) setTournament(next);
        }
      },
      [tournamentId, router],
    ),
  );

  if (notFound) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <span className="text-4xl" aria-hidden="true">
          🌙
        </span>
        <p className="text-muted">That tournament does not exist.</p>
        <Button onClick={() => router.push('/dashboard')}>Back to the dashboard</Button>
      </main>
    );
  }

  if (!tournament) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-muted" role="status">
          Finding your tournament…
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-center gap-2">
        <span className="text-2xl" aria-hidden="true">
          🏆
        </span>
        <h1 className="font-display text-xl font-bold text-ink">{tournament.name}</h1>
      </div>

      {tournament.status === 'completed' ? (
        <TournamentFinale tournament={tournament} />
      ) : tournament.status === 'active' || tournament.status === 'paused' ? (
        <TournamentScoreboard tournament={tournament} />
      ) : (
        <TournamentAbsence tournament={tournament} />
      )}

      <Button variant="soft" onClick={() => router.push('/dashboard')}>
        Back to the dashboard
      </Button>
    </main>
  );
}
