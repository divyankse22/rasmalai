'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  EVENTS,
  type InvitationAcceptedPayload,
  type InvitationState,
  type InvitationView,
} from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { PersonName } from '@/design-system/PersonName';
import { avatarGlyph } from '@/features/onboarding/avatars';
import { gameGlyph } from '@/features/dashboard/gameGlyphs';
import { getFromApi, postToApi } from '@/lib/clientApi';
import { useRealtimeEvent, useResyncOnReconnect } from '@/realtime/RealtimeProvider';

/** How long the arrival announcement holds the screen before it steps aside. */
const TAKEOVER_MS = 10_000;

/** Events that mean the current invitation is no longer live, whatever the reason. */
const CLOSING_EVENTS = new Set<string>([
  EVENTS.invitation.rejected,
  EVENTS.invitation.expired,
  EVENTS.invitation.cancelled,
  EVENTS.invitation.invalidated,
]);

/**
 * Time left on an invitation, as m:ss.
 *
 * The clock lives in state and is only read from a callback — `Date.now()` during render is impure
 * and React's rules forbid it. The zero-delay sync makes a newly arrived invitation show the right
 * number immediately rather than a second late.
 */
function useCountdown(expiresAt: string | undefined): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;

    const sync = () => setNow(Date.now());
    const immediate = setTimeout(sync, 0);
    const timer = setInterval(sync, 1000);

    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [expiresAt]);

  if (!expiresAt) return '';

  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Invitations, wherever the person happens to be standing.
 *
 * This sits in the signed-in layout rather than on a page because the socket does, and because P-7
 * is explicit that an invitation should arrive instantly with no polling. An arriving invitation
 * takes the screen for ten seconds so it cannot be missed, then steps aside into a sheet that
 * stays until it is answered — unmissable without holding anyone hostage.
 */
export function InvitationCentre() {
  const router = useRouter();
  const pathname = usePathname();
  // Nothing to offer while they are already in the game: a new invitation would be refused by the
  // server anyway, and a "back to your game" button on top of the game itself is nonsense.
  const inGame = pathname.startsWith('/play/');
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [announcing, setAnnouncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const expiresIn = useCountdown(invitation?.expiresAt);

  /** The server is the authority on what is live; this is how a stale screen catches up. */
  const resync = useCallback(async () => {
    const state = await getFromApi<InvitationState>('/api/invitations');
    if (!state) return;

    setInvitation(state.active);
    setResumeSessionId(state.activeSessionId);
    // An invitation already waiting when the page loads is not an *arrival*, so it goes straight
    // to the sheet without taking over a screen the person just chose to open.
    setAnnouncing(false);
  }, []);

  // Whatever is already waiting when this mounts. Applied in the promise callback, and guarded so
  // a reply arriving after the component has gone cannot set state on it.
  useEffect(() => {
    let cancelled = false;

    void getFromApi<InvitationState>('/api/invitations').then((state) => {
      if (cancelled || !state) return;
      setInvitation(state.active);
      setResumeSessionId(state.activeSessionId);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Frames that fired while this device was asleep are gone for good.
  useResyncOnReconnect(useCallback(() => void resync(), [resync]));

  useRealtimeEvent(
    useCallback(
      (envelope) => {
        if (envelope.type === EVENTS.invitation.created) {
          const next = (envelope.payload as { invitation: InvitationView | null }).invitation;
          if (!next) return;

          setInvitation(next);
          setError(undefined);
          // Only an incoming invitation is announced. Being told about the one you just sent, in
          // a screen-filling takeover, would be absurd.
          setAnnouncing(next.direction === 'incoming');
          return;
        }

        if (envelope.type === EVENTS.invitation.accepted) {
          const { sessionId } = envelope.payload as InvitationAcceptedPayload;
          setInvitation(null);
          setAnnouncing(false);
          setResumeSessionId(sessionId);
          // Both partners follow this, which is what puts them in the same lobby.
          router.push(`/play/${sessionId}`);
          return;
        }

        // This lives in the layout and is never remounted by navigation, so a session that ends
        // while somebody is standing on the dashboard has to be cleared here. Otherwise the way
        // back into a finished game stays on screen, offering a room that no longer exists.
        if (envelope.type === EVENTS.lobby.ended) {
          setResumeSessionId(null);
          return;
        }

        if (CLOSING_EVENTS.has(envelope.type)) {
          setInvitation(null);
          setAnnouncing(false);
        }
      },
      [router],
    ),
  );

  // The takeover steps aside on its own. Keyed to the invitation, so a replacement announces itself
  // rather than inheriting the remainder of the previous one's ten seconds.
  useEffect(() => {
    if (!announcing) return;
    const timer = setTimeout(() => setAnnouncing(false), TAKEOVER_MS);
    return () => clearTimeout(timer);
  }, [announcing, invitation?.id]);

  async function answer(accept: boolean) {
    if (!invitation) return;
    setBusy(true);
    setError(undefined);

    const result = await postToApi<{ accepted: boolean; sessionId?: string }>(
      `/api/invitations/${invitation.id}/respond`,
      { accept },
    );
    setBusy(false);

    if (!result.ok) {
      // An invitation that ran out or was answered elsewhere is not an error worth shouting about;
      // it just is not there any more.
      if (result.error.status === 410 || result.error.status === 409) {
        setInvitation(null);
        setAnnouncing(false);
        return;
      }
      setError(result.error.message);
      return;
    }

    setAnnouncing(false);
    if (result.data.accepted && result.data.sessionId) {
      router.push(`/play/${result.data.sessionId}`);
    } else {
      setInvitation(null);
    }
  }

  async function withdraw() {
    if (!invitation) return;
    setBusy(true);
    await postToApi(`/api/invitations/${invitation.id}/cancel`);
    setBusy(false);
    setInvitation(null);
  }

  if (inGame) return null;

  if (!invitation) {
    // A game running elsewhere still deserves a way back into it.
    if (!resumeSessionId) return null;
    return (
      <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
        <Button className="shadow-lift" onClick={() => router.push(`/play/${resumeSessionId}`)}>
          Back to your game 🎮
        </Button>
      </div>
    );
  }

  const incoming = invitation.direction === 'incoming';

  const who = (
    <PersonName name={invitation.otherUser.nickname} gender={invitation.otherUser.gender} />
  );

  const actions = incoming ? (
    <div className="flex gap-2">
      <Button className="flex-1" disabled={busy} onClick={() => void answer(true)}>
        ❤️ PLAY
      </Button>
      <Button variant="soft" className="flex-1" disabled={busy} onClick={() => void answer(false)}>
        🙈 NOT NOW
      </Button>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm text-muted">Waiting for them to answer…</p>
      <Button variant="ghost" disabled={busy} onClick={() => void withdraw()}>
        Never mind
      </Button>
    </div>
  );

  if (announcing && incoming) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Game invitation"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-cream px-8 text-center"
      >
        <span className="text-6xl" aria-hidden="true">
          {avatarGlyph(invitation.otherUser.avatarKey)}
        </span>
        <p className="font-display text-2xl font-bold text-ink">{who} wants to play</p>
        <p className="flex items-center gap-2 font-display text-xl text-berry">
          <span aria-hidden="true">{gameGlyph(invitation.gameSlug)}</span>
          {invitation.gameName}
        </p>
        <div className="w-full max-w-xs">{actions}</div>
        <p className="text-sm text-muted" role="timer">
          expires in {expiresIn}
        </p>
        {error && (
          <p className="text-sm text-berry" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-3">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-card border border-line bg-shell p-4 shadow-lift">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-pill bg-blush text-2xl"
            aria-hidden="true"
          >
            {avatarGlyph(invitation.otherUser.avatarKey)}
          </span>
          <p className="flex-1 text-sm text-ink">
            {incoming ? <>{who} wants to play</> : <>You asked {who} to play</>}{' '}
            <span className="font-display font-semibold">
              <span aria-hidden="true">{gameGlyph(invitation.gameSlug)}</span> {invitation.gameName}
            </span>
          </p>
          <span className="shrink-0 text-xs text-muted tabular-nums" role="timer">
            {expiresIn}
          </span>
        </div>

        {actions}

        {error && (
          <p className="text-center text-sm text-berry" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
