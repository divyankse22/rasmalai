'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  EVENTS,
  REACTIONS,
  type MatchResultView,
  type Reaction,
  type ReactionPayload,
  type SessionEndedPayload,
  type SessionPlayer,
  type SessionView,
} from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { PersonName } from '@/design-system/PersonName';
import { gameGlyph } from '@/features/dashboard/gameGlyphs';
import { avatarGlyph } from '@/features/onboarding/avatars';
import { GameMount } from '@/games/GameMount';
import { useRealtime, useRealtimeEvent, useResyncOnReconnect } from '@/realtime/RealtimeProvider';

/** A reaction that has been shown but not yet faded. Ephemeral, never stored (docs/04 section 9). */
interface FloatingReaction {
  key: number;
  reaction: Reaction;
  mine: boolean;
}

const REACTION_LIFETIME_MS = 1600;

/**
 * Every event that carries a fresh session view. The name says what happened; the payload says
 * where things now stand.
 *
 * The game's own events are in here too, and deliberately handled no differently: a round starting
 * is a change to the session view like any other, so there is one code path, one state, and no
 * chance of a game update and a lobby update arriving out of order and disagreeing.
 */
const SESSION_EVENTS = new Set<string>([
  EVENTS.lobby.joined,
  EVENTS.lobby.playerReady,
  EVENTS.lobby.playerUnready,
  EVENTS.lobby.starting,
  EVENTS.lobby.started,
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

function PlayerChip({ player, label }: { player: SessionPlayer; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`flex size-14 items-center justify-center rounded-pill text-3xl transition-opacity duration-soft ${
          player.online ? 'bg-blush' : 'bg-cream opacity-50'
        }`}
        aria-hidden="true"
      >
        {avatarGlyph(player.avatarKey)}
      </span>
      <PersonName name={player.nickname} gender={player.gender} className="text-sm" />
      <span className="text-xs text-muted">
        {!player.online ? 'away' : player.ready ? `${label} ready ✓` : 'not ready'}
      </span>
    </div>
  );
}

/**
 * Counts down to a server-set deadline by subtracting the local clock, never by keeping its own.
 *
 * The clock is held in state and only ever read from a callback, because reading `Date.now()`
 * during render is impure and React's rules forbid it. The zero-delay timer re-syncs the moment a
 * new deadline arrives — without it, a countdown starting after a long wait in the lobby would
 * briefly render against a clock from when the screen was opened.
 */
function useSecondsUntil(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;

    const sync = () => setNow(Date.now());
    const immediate = setTimeout(sync, 0);
    const timer = setInterval(sync, 200);

    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [deadline]);

  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** How a finished match is announced. P-3: only a competitive game is a win over somebody. */
function ResultBanner({ result, partner }: { result: MatchResultView; partner: SessionPlayer }) {
  if (!result.competitive) {
    return (
      <>
        <span className="text-4xl" aria-hidden="true">
          💞
        </span>
        <p className="font-display text-xl font-bold text-ink">Played together</p>
      </>
    );
  }

  const headline =
    result.outcome === 'won'
      ? { glyph: '🏆', text: 'You win!' }
      : result.outcome === 'lost'
        ? { glyph: '😤', text: 'They got you' }
        : { glyph: '🤝', text: 'A dead heat' };

  return (
    <>
      <span className="text-4xl" aria-hidden="true">
        {headline.glyph}
      </span>
      <p className="font-display text-xl font-bold text-ink">{headline.text}</p>
      <p className="font-display text-lg text-muted tabular-nums">
        <span className="text-ink">{result.yourScore}</span>
        <span className="px-2">—</span>
        <span className="text-ink">{result.theirScore}</span>
      </p>
      <p className="text-xs text-muted">
        you · <PersonName name={partner.nickname} gender={partner.gender} />
      </p>
    </>
  );
}

export function PlayScreen({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { send, status } = useRealtime();
  const [session, setSession] = useState<SessionView | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [floating, setFloating] = useState<FloatingReaction[]>([]);

  const countdown = useSecondsUntil(session?.startsAt ?? null);
  const reconnectSeconds = useSecondsUntil(session?.reconnectDeadline ?? null);

  /** Asks the server where things stand. The answer is the only version that counts. */
  const join = useCallback(() => {
    send(EVENTS.lobby.join, { sessionId });
  }, [send, sessionId]);

  useEffect(() => {
    if (status === 'connected') join();
  }, [status, join]);

  // A socket that dropped missed every frame in between, so the whole view is asked for again
  // rather than patched up from what it was showing. This is also the reconnect path for a game in
  // progress: one frame back, and the board is exactly as the server has it.
  useResyncOnReconnect(join);

  /** A player's intent. The server decides what, if anything, it meant. */
  const act = useCallback(
    (action: unknown) => {
      send(EVENTS.game.actionRequest, { sessionId, action });
    },
    [send, sessionId],
  );

  const leave = useCallback(() => {
    send(EVENTS.lobby.leave, { sessionId });
    router.push('/dashboard');
  }, [send, sessionId, router]);

  useRealtimeEvent(
    useCallback(
      (envelope) => {
        if (SESSION_EVENTS.has(envelope.type)) {
          const next = (envelope.payload as { session?: SessionView }).session;
          // Frames for a different session belong to a game this screen is not showing.
          if (next && next.id === sessionId) setSession(next);
          return;
        }

        if (envelope.type === EVENTS.lobby.ended) {
          const { session: next, reason, byUserId } = envelope.payload as SessionEndedPayload;
          if (next && next.id !== sessionId) return;

          setEnded(
            reason === 'left'
              ? byUserId === next?.you.userId
                ? 'You left the game.'
                : `${next?.partner.nickname ?? 'They'} left the game.`
              : reason === 'server_stopped'
                ? 'Rasmalai restarted, so the game stopped. Nothing was lost but this round.'
                : 'Someone could not make it back in time. The game was called off.',
          );
          return;
        }

        if (envelope.type === EVENTS.reaction.sent) {
          const { reaction, fromUserId } = envelope.payload as ReactionPayload;
          const key = Date.now() + Math.random();
          setFloating((current) => [
            ...current,
            { key, reaction, mine: fromUserId === session?.you.userId },
          ]);
          // Ephemeral by construction: it is removed on a timer and never written anywhere.
          setTimeout(
            () => setFloating((current) => current.filter((item) => item.key !== key)),
            REACTION_LIFETIME_MS,
          );
          return;
        }

        if (envelope.type === EVENTS.error) {
          const { code } = envelope.payload as { code?: string };
          if (code === 'session_not_found' || code === 'not_authorized') {
            setEnded('That game is no longer running.');
          }
        }
      },
      [sessionId, session?.you.userId],
    ),
  );

  if (ended) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <span className="text-4xl" aria-hidden="true">
          🌙
        </span>
        <p className="font-display text-lg font-semibold text-ink">{ended}</p>
        <Button onClick={() => router.push('/dashboard')}>Back to the dashboard</Button>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-muted" role="status">
          Finding your game…
        </p>
      </main>
    );
  }

  const waitingForPartner = session.reconnectDeadline !== null;
  const playing = session.phase === 'active' || session.phase === 'finished';
  const toggleReady = () =>
    send(session.you.ready ? EVENTS.lobby.playerUnready : EVENTS.lobby.playerReady, { sessionId });

  return (
    <main className="relative flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-center gap-2">
        <span className="text-2xl" aria-hidden="true">
          {gameGlyph(session.gameSlug)}
        </span>
        <h1 className="font-display text-xl font-bold text-ink">{session.gameName}</h1>
      </div>

      {/* The two of them, until the game itself takes over the screen and shows its own scoreline. */}
      {!playing && (
        <Card className="flex items-start justify-center gap-8">
          <PlayerChip player={session.you} label="you're" />
          <span className="pt-4 text-xl" aria-hidden="true">
            ⚔️
          </span>
          <PlayerChip player={session.partner} label="they're" />
        </Card>
      )}

      {waitingForPartner ? (
        <Card className="flex flex-col items-center gap-2 text-center">
          <span className="text-2xl" aria-hidden="true">
            📡
          </span>
          <p className="font-display font-semibold text-ink">
            Waiting for{' '}
            <PersonName name={session.partner.nickname} gender={session.partner.gender} /> to come
            back
          </p>
          <p className="text-sm text-muted" role="timer">
            {reconnectSeconds ?? 0}s left. The round restarts when they make it.
          </p>
        </Card>
      ) : session.phase === 'countdown' ? (
        <Card className="flex flex-col items-center gap-2 py-8 text-center">
          <span
            className="font-display text-6xl font-bold text-berry tabular-nums"
            role="timer"
            aria-live="assertive"
          >
            {countdown === 0 ? 'GO' : countdown}
          </span>
          <p className="text-sm text-muted">Both ready — here we go</p>
        </Card>
      ) : session.phase === 'lobby' ? (
        <Card className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted">
            {session.partner.ready
              ? 'They are ready and waiting for you.'
              : 'Tell them when you are ready.'}
          </p>
          <Button variant={session.you.ready ? 'soft' : 'primary'} onClick={toggleReady}>
            {session.you.ready ? 'Not ready after all' : "I'm ready ✨"}
          </Button>
        </Card>
      ) : null}

      {session.phase === 'finished' && session.result && (
        <Card className="flex flex-col items-center gap-2 text-center">
          <ResultBanner result={session.result} partner={session.partner} />

          <div className="mt-2 flex w-full flex-col items-center gap-1">
            <Button
              className="w-full"
              variant={session.you.ready ? 'soft' : 'primary'}
              onClick={toggleReady}
            >
              {session.you.ready ? 'Waiting for them…' : 'Rematch ✨'}
            </Button>
            <p className="text-xs text-muted">
              {session.partner.ready
                ? 'They want another go.'
                : 'A rematch needs both of you to say so.'}
            </p>
          </div>
        </Card>
      )}

      {/* The game itself. It stays up on the results screen so the round-by-round is still there to
          argue about. */}
      {playing && session.game && (
        <GameMount
          snapshot={session.game}
          you={session.you}
          partner={session.partner}
          act={act}
        />
      )}

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex justify-center gap-2" aria-label="Send a reaction">
          {REACTIONS.map((reaction) => (
            <button
              key={reaction}
              type="button"
              aria-label={`React with ${reaction}`}
              onClick={() => send(EVENTS.reaction.sent, { sessionId, reaction })}
              className="flex size-12 items-center justify-center rounded-pill bg-shell text-2xl shadow-soft transition-transform duration-quick ease-bounce active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
            >
              <span aria-hidden="true">{reaction}</span>
            </button>
          ))}
        </div>

        {/* Leaving asks first, because it ends the game for both of them — unlike a closed tab or
            a dropped connection, which is a disconnect and gets the 120-second window instead. */}
        {confirmingLeave ? (
          <Card className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-ink">
              Leave the game? It ends for{' '}
              <PersonName name={session.partner.nickname} gender={session.partner.gender} /> too.
            </p>
            <div className="flex w-full gap-2">
              <Button variant="soft" className="flex-1" onClick={() => setConfirmingLeave(false)}>
                Stay
              </Button>
              <Button className="flex-1" onClick={leave}>
                Leave
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmingLeave(true)}>
            Leave
          </Button>
        )}
      </div>

      {/* Reactions float over everything and vanish. They are deliberately aria-hidden: announcing
          a stream of emoji to a screen reader mid-game would be noise, not information. */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        {floating.map((item) => (
          <span
            key={item.key}
            className="absolute bottom-32 animate-[float_1.6s_ease-out_forwards] text-4xl"
            style={{ left: item.mine ? '25%' : '65%' }}
          >
            {item.reaction}
          </span>
        ))}
      </div>
    </main>
  );
}
