'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GAME_META } from '@rasmalai/games';
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
import { formatClock, useCountdown } from '@/features/play/useCountdown';
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

/** Time left on an invitation, as m:ss — the same countdown the play screen counts a match with. */
function useExpiryCountdown(expiresAt: string | undefined): string {
  const seconds = useCountdown(expiresAt ? new Date(expiresAt).getTime() : null);
  return seconds === null ? '' : formatClock(seconds);
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
  /**
   * The invitation the "something else" picker is open over, or null.
   *
   * The id rather than a boolean, so the picker cannot outlive what it is countering: an invitation
   * that is answered, withdrawn or replaced while the chips are on screen leaves them offering to
   * counter something that is no longer there. Derived rather than reset in an effect — a `setState`
   * in an effect is a second render nobody needs, and the lint rule that says so is right.
   */
  const [counteringFor, setCounteringFor] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  /**
   * What a counter-proposal may propose: every game with a module behind it.
   *
   * `GAME_META` rather than the catalogue from `/api/dashboard`, which this component does not
   * fetch and should not start a request for to draw three chips. The two agree by construction —
   * `games.enabled` is flipped in a migration when a module lands (`0009`), and the server refuses
   * anything unplayable with a `409` regardless, so the worst a drift could do is show a chip that
   * comes back with a message rather than a game.
   */
  const alternatives = useMemo(
    () =>
      Object.values(GAME_META)
        .filter((game) => game.slug !== invitation?.gameSlug)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [invitation?.gameSlug],
  );

  const expiresIn = useExpiryCountdown(invitation?.expiresAt);

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

  /**
   * Answering — and, when `counterGameSlug` is given, answering with something else in mind (P-7).
   *
   * A counter is a decline and a fresh invitation in one transaction on the server, so it is one
   * call from here too. What comes back is the new invitation, pointing the other way: the person
   * who was being asked is now the one asking.
   */
  async function answer(accept: boolean, counterGameSlug?: string) {
    if (!invitation) return;
    setBusy(true);
    setError(undefined);

    const result = await postToApi<{
      accepted: boolean;
      sessionId?: string;
      counterInvitation?: InvitationView | null;
    }>(`/api/invitations/${invitation.id}/respond`, {
      accept,
      ...(counterGameSlug ? { counterGameSlug } : {}),
    });
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
      return;
    }

    // Applied straight from the reply rather than waiting for the socket to say the same thing. The
    // `game.invitation.created` frame is still coming and still authoritative; this only stops the
    // sheet blinking empty for a round trip.
    setInvitation(result.data.counterInvitation ?? null);
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
  const countering = counteringFor === invitation.id;

  const who = (
    <PersonName name={invitation.otherUser.nickname} gender={invitation.otherUser.gender} />
  );

  /**
   * "Not that one — this one instead."
   *
   * P-7 has always allowed a decline to carry a counter-proposal, and the server, the protocol and
   * the transaction behind it have been done and tested since slice 6. What was missing was
   * anywhere to press: with one game in the catalogue there was nothing to counter *with*, so the
   * picker was deferred. Six games later it is three lines of chips.
   */
  const picker = (
    <div className="flex flex-col gap-2">
      <p className="text-center text-sm text-muted">…how about one of these?</p>
      <ul className="flex flex-wrap justify-center gap-2">
        {alternatives.map((game) => (
          <li key={game.slug}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void answer(false, game.slug)}
              className="flex items-center gap-1.5 rounded-pill bg-cream px-3 py-1.5 text-sm text-ink transition-colors duration-quick enabled:hover:bg-blush disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
            >
              <span aria-hidden="true">{gameGlyph(game.slug)}</span>
              {game.name}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" disabled={busy} onClick={() => setCounteringFor(null)}>
        Back
      </Button>
    </div>
  );

  const actions = incoming ? (
    countering ? (
      picker
    ) : (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => void answer(true)}>
            ❤️ PLAY
          </Button>
          <Button
            variant="soft"
            className="flex-1"
            disabled={busy}
            onClick={() => void answer(false)}
          >
            🙈 NOT NOW
          </Button>
        </div>
        {alternatives.length > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => setCounteringFor(invitation.id)}>
            🎲 Something else instead
          </Button>
        )}
      </div>
    )
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
