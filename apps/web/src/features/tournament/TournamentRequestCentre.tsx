'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  EVENTS,
  type TournamentRequestCreatedPayload,
  type TournamentUpdatedPayload,
  type TournamentView,
} from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { PersonName } from '@/design-system/PersonName';
import { gameGlyph } from '@/features/dashboard/gameGlyphs';
import { avatarGlyph } from '@/features/onboarding/avatars';
import { formatClock, useCountdown } from '@/features/play/useCountdown';
import { usePartnerPresence } from '@/features/presence/usePartnerPresence';
import { getFromApi, postToApi } from '@/lib/clientApi';
import { useRealtimeEvent, useResyncOnReconnect } from '@/realtime/RealtimeProvider';

/**
 * A tournament request, wherever the person happens to be standing.
 *
 * This sits in the signed-in layout for the same reason `InvitationCentre` does, and to fix the
 * same bug in the other direction: the server has always sent `tournament.request.created` to both
 * partners, but the only thing listening for it was a card on `/games`. Somebody reading their
 * dashboard — which is where the app puts them — was never told, and the request expired five
 * minutes later having never appeared on a screen.
 *
 * An arriving request takes the screen for ten seconds so it cannot be missed, then steps aside
 * into a sheet that stays until it is answered.
 */

/** How long the arrival announcement holds the screen before it steps aside. */
const TAKEOVER_MS = 10_000;

export function TournamentRequestCentre() {
  const router = useRouter();
  const pathname = usePathname();
  const { partner } = usePartnerPresence();
  // Nothing to offer while they are already in a game: the server refuses a request while the
  // couple has a live session anyway, and the play screen has its own things to say.
  const inGame = pathname.startsWith('/play/');
  const [tournament, setTournament] = useState<TournamentView | null>(null);
  const [announcing, setAnnouncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const expiresIn = useCountdown(
    tournament?.expiresAt ? new Date(tournament.expiresAt).getTime() : null,
  );

  /** The server is the authority on what is live; this is how a stale screen catches up. */
  const resync = useCallback(async () => {
    const data = await getFromApi<{ tournament: TournamentView | null }>('/api/tournaments/active');
    if (!data) return;
    setTournament(data.tournament);
    // A request already waiting when the page loads is not an *arrival*, so it goes straight to the
    // sheet without taking over a screen the person just chose to open.
    setAnnouncing(false);
  }, []);

  // Whatever is already waiting when this mounts. The cancel flag is what stops a slow answer from
  // landing on a component that has already gone.
  useEffect(() => {
    let cancelled = false;

    void getFromApi<{ tournament: TournamentView | null }>('/api/tournaments/active').then(
      (data) => {
        if (cancelled || !data) return;
        setTournament(data.tournament);
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  // Frames that fired while this device was asleep are gone for good.
  useResyncOnReconnect(useCallback(() => void resync(), [resync]));

  useRealtimeEvent(
    useCallback((envelope) => {
      if (envelope.type === EVENTS.tournamentRequest.created) {
        const { tournament: next } = envelope.payload as TournamentRequestCreatedPayload;
        setTournament(next);
        setError(undefined);
        // Only an incoming request is announced. Being told about the one you just sent, in a
        // screen-filling takeover, would be absurd.
        setAnnouncing(next.direction === 'incoming');
        return;
      }

      // The series has started, so there is no longer a request to answer. Moving both partners to
      // the new session belongs to `TournamentCard` and the play screen, which between them cover
      // every page this could be read on.
      if (envelope.type === EVENTS.results.tournamentNextGame) {
        setTournament(null);
        setAnnouncing(false);
        return;
      }

      if (
        envelope.type === EVENTS.results.tournamentUpdated ||
        envelope.type === EVENTS.results.tournamentGameResult
      ) {
        const { tournament: next } = envelope.payload as TournamentUpdatedPayload;
        // Answered, withdrawn, or left to expire — whatever it became, it is not a question now.
        if (next.status !== 'pending') {
          setTournament(null);
          setAnnouncing(false);
        } else {
          setTournament(next);
        }
      }
    }, []),
  );

  // The takeover steps aside on its own. Keyed to the request, so a replacement announces itself
  // rather than inheriting the remainder of the previous one's ten seconds.
  useEffect(() => {
    if (!announcing) return;
    const timer = setTimeout(() => setAnnouncing(false), TAKEOVER_MS);
    return () => clearTimeout(timer);
  }, [announcing, tournament?.id]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(undefined);

    const result = await postToApi<{ sessionId?: string }>(path, body);
    setBusy(false);

    if (!result.ok) {
      // A request that ran out or was answered on another device is not an error worth shouting
      // about; it just is not there any more.
      if (result.error.status === 410 || result.error.status === 409) {
        setTournament(null);
        setAnnouncing(false);
        return;
      }
      setError(result.error.message);
      return;
    }

    setAnnouncing(false);

    // Accepting opens the first game.
    if (result.data.sessionId) {
      router.push(`/play/${result.data.sessionId}`);
      return;
    }

    // Declining or withdrawing answers with nothing. Cleared straight from the reply rather than
    // waiting for the socket to say the same thing: the `tournament.updated` frame is still coming
    // and still authoritative, this only stops the sheet sitting there after it was answered.
    setTournament(null);
  }

  if (inGame || !tournament || tournament.status !== 'pending') return null;

  const incoming = tournament.direction === 'incoming';
  const who = <PersonName name={partner?.nickname ?? 'They'} gender={partner?.gender} />;

  const games = (
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
  );

  const actions = incoming ? (
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
  ) : (
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm text-muted">Waiting for {who} to answer…</p>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => void act(`/api/tournaments/${tournament.id}/cancel`)}
      >
        Never mind
      </Button>
    </div>
  );

  const clock = expiresIn !== null && (
    <p className="text-xs text-muted" role="timer">
      {formatClock(expiresIn)} left to answer
    </p>
  );

  const problem = error && (
    <p className="text-center text-sm text-berry" role="alert">
      {error}
    </p>
  );

  if (announcing && incoming) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tournament request"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-cream px-8 text-center"
      >
        <span className="text-6xl" aria-hidden="true">
          {avatarGlyph(partner?.avatarKey ?? 'fox')}
        </span>
        <p className="font-display text-2xl font-bold text-ink">{who} wants to start</p>
        <p className="flex items-center gap-2 font-display text-xl text-berry">
          <span aria-hidden="true">🏆</span>
          {tournament.name}
        </p>
        {games}
        <div className="w-full max-w-xs">{actions}</div>
        {clock}
        {problem}
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-3">
      <div className="flex w-full max-w-app flex-col gap-3 rounded-card border border-line bg-shell p-4 shadow-lift">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-pill bg-blush text-2xl"
            aria-hidden="true"
          >
            {avatarGlyph(partner?.avatarKey ?? 'fox')}
          </span>
          <p className="flex-1 text-sm text-ink">
            {incoming ? <>{who} wants to start</> : <>You asked {who} to play</>}{' '}
            <span className="font-display font-semibold">
              <span aria-hidden="true">🏆</span> {tournament.name}
            </span>
          </p>
          {expiresIn !== null && (
            <span className="shrink-0 text-xs text-muted tabular-nums" role="timer">
              {formatClock(expiresIn)}
            </span>
          )}
        </div>

        {incoming && games}
        {actions}
        {problem}
      </div>
    </div>
  );
}
