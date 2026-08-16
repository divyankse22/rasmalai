'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import {
  AWAY_GRACE_MS,
  EVENTS,
  RECONNECT_WINDOW_MS,
  type SessionView,
} from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { PersonName } from '@/design-system/PersonName';
import { formatClock, useCountdown } from '@/features/play/useCountdown';
import { useRealtime, useRealtimeEvent } from '@/realtime/RealtimeProvider';

/**
 * The sheet that follows you around when something is wrong with your game.
 *
 * It lives in the app layout rather than on `/play` on purpose: the person it most needs to reach is
 * the one who has **left** that page. Somebody who wanders off to their dashboard mid-match has two
 * minutes before they forfeit, and finding that out by losing would be indefensible — so the warning
 * goes wherever they are, with a way back.
 *
 * Four things it says, and it only ever says one at a time:
 *
 * - **They want to stop.** A mid-match leave needs your agreement (or your silence, which is a no).
 * - **You are away.** You are about to forfeit. Here is the clock and a button back.
 * - **They are away.** You are waiting; here is the same clock, counting in your favour.
 * - **You are both away.** Neither of you is at the table, and whoever gets back first takes it.
 */

/** Every frame that carries a fresh session view — the same envelope the play screen reads. */
const SESSION_EVENTS = new Set<string>([
  EVENTS.lobby.joined,
  EVENTS.lobby.playerReady,
  EVENTS.lobby.playerUnready,
  EVENTS.lobby.starting,
  EVENTS.lobby.started,
  EVENTS.lobby.leaveRequested,
  EVENTS.lobby.leaveResolved,
  EVENTS.presence.playerConnected,
  EVENTS.presence.playerDisconnected,
  EVENTS.presence.playerReconnected,
  EVENTS.presence.reconnectWindowStarted,
  EVENTS.presence.reconnectWindowExpired,
  EVENTS.game.stateUpdated,
  EVENTS.game.roundStarted,
  EVENTS.game.roundEnded,
  EVENTS.game.finished,
  EVENTS.results.matchResult,
]);

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-3">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-card border border-line bg-shell p-4 shadow-lift">
        {children}
      </div>
    </div>
  );
}

export function SessionWatch() {
  const router = useRouter();
  const { send } = useRealtime();
  const [session, setSession] = useState<SessionView | null>(null);

  useRealtimeEvent(
    useCallback((envelope) => {
      if (SESSION_EVENTS.has(envelope.type)) {
        const next = (envelope.payload as { session?: SessionView }).session;
        if (next) setSession(next);
        return;
      }

      if (envelope.type === EVENTS.lobby.ended) {
        // The play screen owns explaining an ending; this one just stops talking about it.
        setSession(null);
      }
    }, []),
  );

  const youAway = session?.you.awayUntil ?? null;
  const themAway = session?.partner.awayUntil ?? null;
  const request = session?.leaveRequest ?? null;

  /**
   * The moment this is decided, which is the **latest** of the pending clocks and not the earliest.
   *
   * It has to match what the server resolves on (`sessionRegistry.resolveClock`), because it is the
   * number both of them are reading while they decide whether to bother coming back. Two people who
   * walked off a minute apart are each on their own two minutes, and the one who left second still
   * has time on theirs after the first has run out.
   */
  const deadline =
    youAway === null && themAway === null ? null : Math.max(youAway ?? 0, themAway ?? 0);

  const secondsLeft = useCountdown(deadline);
  const requestSeconds = useCountdown(request?.expiresAt ?? null);

  /**
   * A refresh drops the socket for a second or two, and shouting "they left!" twice a match would
   * make the honest signal worthless.
   *
   * Counted from the window's own start — the deadline minus its fixed length — rather than from
   * when this component noticed, so the **server's clock is the one that runs** and nobody buys
   * themselves three seconds by reloading. It is a second countdown rather than a timer and a piece
   * of state because a component that sets its own state from an effect is a re-render waiting to
   * go wrong.
   */
  const graceLeft = useCountdown(
    deadline === null ? null : deadline - RECONNECT_WINDOW_MS + AWAY_GRACE_MS,
  );
  const graced = deadline !== null && (graceLeft ?? 1) <= 0;

  if (!session) return null;

  const sessionId = session.id;

  if (request) {
    const mine = request.byUserId === session.you.userId;

    if (mine) {
      return (
        <Sheet>
          <p className="text-center text-sm text-ink">
            Asked <PersonName name={session.partner.nickname} gender={session.partner.gender} /> if
            you can stop. <span className="text-muted tabular-nums">{requestSeconds ?? 0}s</span>
          </p>
          <Button
            variant="soft"
            onClick={() => send(EVENTS.lobby.leaveRespond, { sessionId, accept: false })}
          >
            Never mind, keep playing
          </Button>
        </Sheet>
      );
    }

    return (
      <Sheet>
        <p className="text-center text-sm text-ink">
          <PersonName name={session.partner.nickname} gender={session.partner.gender} /> wants to
          stop this game. Nobody wins or loses.
        </p>
        <div className="flex w-full gap-2">
          <Button
            variant="soft"
            className="flex-1"
            onClick={() => send(EVENTS.lobby.leaveRespond, { sessionId, accept: false })}
          >
            Keep playing
          </Button>
          <Button
            className="flex-1"
            onClick={() => send(EVENTS.lobby.leaveRespond, { sessionId, accept: true })}
          >
            Stop
          </Button>
        </div>
        <p className="text-center text-xs text-muted" role="timer">
          {requestSeconds ?? 0}s — ignoring this just carries on
        </p>
      </Sheet>
    );
  }

  if (deadline === null || !graced) return null;

  const atStake = session.phase === 'active';
  const clock = (
    <span className="shrink-0 font-display text-sm text-berry tabular-nums" role="timer">
      {formatClock(secondsLeft ?? 0)}
    </span>
  );
  const back = <Button onClick={() => router.push(`/play/${sessionId}`)}>Back to the game</Button>;
  const them = <PersonName name={session.partner.nickname} gender={session.partner.gender} />;

  // Neither of you is at the table. Whoever gets back is the last one in the room and takes it; if
  // neither of you does, nobody won anything.
  if (youAway !== null && themAway !== null) {
    return (
      <Sheet>
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            🚪
          </span>
          <p className="flex-1 text-sm text-ink">
            You both walked off your game.{' '}
            <span className="text-muted">
              {atStake ? 'First one back takes it.' : 'It closes if neither of you comes back.'}
            </span>
          </p>
          {clock}
        </div>
        {back}
      </Sheet>
    );
  }

  if (youAway !== null) {
    return (
      <Sheet>
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            ⏳
          </span>
          <p className="flex-1 text-sm text-ink">
            You walked away from your game with {them}.{' '}
            <span className="text-muted">
              {atStake ? 'Come back or you lose this one.' : 'It closes if you do not come back.'}
            </span>
          </p>
          {clock}
        </div>
        {back}
      </Sheet>
    );
  }

  return (
    <Sheet>
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">
          📡
        </span>
        <p className="flex-1 text-sm text-ink">
          {them} left the game.{' '}
          <span className="text-muted">Waiting for them to come back…</span>
        </p>
        {clock}
      </div>
      <p className="text-center text-xs text-muted">
        {atStake
          ? 'If they do not make it, this one goes to you.'
          : 'Nothing is running, so nothing is at stake.'}
      </p>
    </Sheet>
  );
}
