'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EVENTS,
  REACTIONS,
  type MatchResultView,
  type ProtocolError,
  type Reaction,
  type ReactionPayload,
  type SessionEndedPayload,
  type SessionPlayer,
  type SessionView,
  type TournamentNextGamePayload,
  type TournamentUpdatedPayload,
} from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { PersonName } from '@/design-system/PersonName';
import { gameGlyph } from '@/features/dashboard/gameGlyphs';
import { avatarGlyph } from '@/features/onboarding/avatars';
import { formatClock, useCountdown } from '@/features/play/useCountdown';
import {
  TournamentFinale,
  TournamentScoreboard,
} from '@/features/tournament/TournamentScoreboard';
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
  EVENTS.lobby.leaveRequested,
  EVENTS.lobby.leaveResolved,
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

  // Won because they never came back, which is not a scoreline worth printing. "You win 1–0" tells
  // nobody anything true about a match that was never finished.
  if (result.byForfeit) {
    return (
      <>
        <span className="text-4xl" aria-hidden="true">
          {result.outcome === 'won' ? '🏆' : '💔'}
        </span>
        <p className="font-display text-xl font-bold text-ink">
          {result.outcome === 'won' ? 'They did not come back' : 'You did not make it back'}
        </p>
        <p className="text-sm text-muted">
          {result.outcome === 'won' ? (
            <>
              This one goes to you.{' '}
              <PersonName name={partner.nickname} gender={partner.gender} /> was away too long.
            </>
          ) : (
            <>
              <PersonName name={partner.nickname} gender={partner.gender} /> waited two minutes, so
              this one is theirs.
            </>
          )}
        </p>
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

  const countdown = useCountdown(session?.startsAt ?? null);
  const moveSeconds = useCountdown(session?.turnDeadline ?? null);

  /** Asks the server where things stand. The answer is the only version that counts. */
  const join = useCallback(() => {
    send(EVENTS.lobby.join, { sessionId });
  }, [send, sessionId]);

  useEffect(() => {
    if (status === 'connected') join();
  }, [status, join]);

  /**
   * Leaving this page is leaving the game.
   *
   * The socket outlives the page deliberately (P-7), so without this frame, routing to the
   * dashboard mid-match would be completely invisible to the server while closing the tab was not —
   * two identical walkouts, treated as if only one of them happened.
   *
   * `sendRef` keeps the unmount cleanup out of the dependency list: a `send` identity change must
   * not fire an "I have left" for a page that is still open.
   */
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  //
  // Not sent once this session is over: there is nothing left to leave, and the frame would come
  // back as a `session_not_found` for a game the server has already forgotten — landing on whatever
  // screen is open by then, which after a rematch is a brand new game that is perfectly fine.
  const endedRef = useRef(false);
  useEffect(() => {
    return () => {
      if (!endedRef.current) sendRef.current(EVENTS.lobby.away, { sessionId });
    };
  }, [sessionId]);

  /**
   * The last moment we can catch somebody before they forfeit.
   *
   * Only during an active match — there is nothing at stake in a lobby, and a browser prompt on
   * every exit would be noise. The wording belongs to the browser; sites cannot set it.
   */
  const matchRunning = session?.phase === 'active';
  useEffect(() => {
    if (!matchRunning) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [matchRunning]);

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

  /**
   * Two ways out, and which one you get depends on whether a match is running.
   *
   * Outside one there is nothing to protect, so leaving closes it for both. Inside one it has to be
   * asked for: the alternative to a free exit is a forfeit, and a free exit needing nobody's
   * agreement is the exit everybody would take.
   */
  const leave = useCallback(() => {
    if (session?.phase === 'active') {
      send(EVENTS.lobby.leaveRequest, { sessionId });
      setConfirmingLeave(false);
      return;
    }

    send(EVENTS.lobby.leave, { sessionId });
    router.push('/dashboard');
  }, [send, sessionId, router, session?.phase]);

  /** This game is over, for whatever reason. Says so, and stops talking to the server about it. */
  const finish = useCallback((message: string) => {
    endedRef.current = true;
    setEnded(message);
  }, []);

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

          finish(
            reason === 'left'
              ? byUserId === next?.you.userId
                ? 'You left the game.'
                : `${next?.partner.nickname ?? 'They'} left the game.`
              : reason === 'server_stopped'
                ? 'Rasmalai restarted, so the game stopped. Nothing was lost but this round.'
                : 'Neither of you made it back in time, so this one goes to nobody.',
          );
          return;
        }

        // The next game of a series is a different game in a different session, so this is a
        // navigation rather than a state change. Both partners get it, which is what moves the one
        // who is not looking at the button they both pressed.
        if (envelope.type === EVENTS.results.tournamentNextGame) {
          const { sessionId: next } = envelope.payload as TournamentNextGamePayload;
          if (next === sessionId) return;
          endedRef.current = true;
          router.push(`/play/${next}`);
          return;
        }

        /**
         * The standings moved.
         *
         * Patched into the session rather than replacing it: the result frame that carries the
         * match is sent before the series has finished scoring it, so these arrive second and must
         * not undo the screen they are catching up with.
         */
        if (
          envelope.type === EVENTS.results.tournamentUpdated ||
          envelope.type === EVENTS.results.tournamentGameResult
        ) {
          const { tournament } = envelope.payload as TournamentUpdatedPayload;
          setSession((current) =>
            current && current.tournament?.id === tournament.id ? { ...current, tournament } : current,
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
          const error = envelope.payload as ProtocolError;

          // One socket carries the whole app, so an error naming a different game is not this
          // screen's business — and that is the common case, because the frame a page sends on its
          // way out routinely lands after the server has forgotten the session it named.
          if (error.sessionId !== undefined && error.sessionId !== sessionId) return;

          if (error.code === 'session_not_found') {
            finish('That game is no longer running.');
            return;
          }

          // Deliberately its own message rather than sharing the one above: `not_authorized` also
          // comes back from perfectly ordinary refusals mid-match, and blanking a live game for one
          // of those would be inventing an ending.
          if (error.code === 'not_authorized') finish('That game is not yours.');
        }
      },
      [sessionId, session?.you.userId, finish, router],
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

  const waitingForPartner = session.partner.awayUntil !== null;
  const playing = session.phase === 'active' || session.phase === 'finished';
  const tournament = session.tournament;
  // The last game of the series has been scored, so there is nothing to be ready for.
  const seriesOver = tournament?.status === 'completed';
  const yourMove = session.turnUserId !== null && session.turnUserId === session.you.userId;
  // Under thirty seconds it stops being a detail and starts being the thing on screen.
  const movePressing = moveSeconds !== null && moveSeconds <= 30;
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

      {/* Where the series stands. Above the game rather than beside it, so it reads the same on a
          phone as on a laptop — and only the games already played are scored (D-3). */}
      {tournament && !seriesOver && <TournamentScoreboard tournament={tournament} />}

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

      {waitingForPartner ? null : session.phase === 'countdown' ? (
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

      {/* The whole series is done, so this is the only scoreline that matters now. */}
      {seriesOver && tournament && <TournamentFinale tournament={tournament} />}

      {session.phase === 'finished' && session.result && (
        <Card className="flex flex-col items-center gap-2 text-center">
          <ResultBanner result={session.result} partner={session.partner} />

          {/* D-2: each game is played once, so there is no rematch inside a series. Both of them
              readying moves the evening on to the next game instead. */}
          {seriesOver ? (
            <div className="mt-2 flex w-full flex-col items-center gap-1">
              <Button className="w-full" onClick={() => router.push('/dashboard')}>
                Back to the dashboard
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex w-full flex-col items-center gap-1">
              <Button
                className="w-full"
                variant={session.you.ready ? 'soft' : 'primary'}
                onClick={toggleReady}
              >
                {session.you.ready
                  ? 'Waiting for them…'
                  : tournament
                    ? 'Next game →'
                    : 'Rematch ✨'}
              </Button>
              <p className="text-xs text-muted">
                {session.partner.ready
                  ? tournament
                    ? 'They are ready for the next one.'
                    : 'They want another go.'
                  : tournament
                    ? 'Both of you have to be ready to carry on.'
                    : 'A rematch needs both of you to say so.'}
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Whose move it is, and how long they have left of it. Only for a game that has turns at
          all — a reaction test is waiting on a stimulus, not on a person, and says so itself. */}
      {session.turnDeadline !== null && moveSeconds !== null && (
        <div
          className={`flex items-center justify-center gap-2 rounded-pill px-4 py-2 text-sm transition-colors duration-soft ${
            movePressing ? 'bg-blush text-ink' : 'bg-cream text-muted'
          }`}
        >
          <span aria-hidden="true">{yourMove ? '👉' : '⏳'}</span>
          <span>
            {yourMove ? (
              'Your move'
            ) : (
              <>
                <PersonName name={session.partner.nickname} gender={session.partner.gender} /> is
                thinking
              </>
            )}
          </span>
          <span className="font-display font-bold tabular-nums" role="timer" aria-live="off">
            {formatClock(moveSeconds)}
          </span>
        </div>
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

        {/* Mid-match this asks them; everywhere else it just closes. Either way it ends the game
            for both — unlike a closed tab or a dropped connection, which is a walkout and gets the
            120-second clock and a forfeit at the end of it. */}
        {confirmingLeave ? (
          <Card className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-ink">
              {matchRunning ? (
                <>
                  Ask{' '}
                  <PersonName
                    name={session.partner.nickname}
                    gender={session.partner.gender}
                  />{' '}
                  to stop here? Nobody wins or loses if they agree.
                </>
              ) : tournament && !seriesOver ? (
                // D-5: the evening is put down where it stands rather than thrown away, and it
                // keeps for two days. Worth saying, because "leave" everywhere else means "over".
                <>
                  Stop here? <span className="font-semibold">{tournament.name}</span> pauses at{' '}
                  {tournament.yourTotalPoints}–{tournament.partnerTotalPoints}, and either of you
                  can pick it up within two days.
                </>
              ) : (
                <>
                  Leave? It ends for{' '}
                  <PersonName name={session.partner.nickname} gender={session.partner.gender} />{' '}
                  too.
                </>
              )}
            </p>
            <div className="flex w-full gap-2">
              <Button variant="soft" className="flex-1" onClick={() => setConfirmingLeave(false)}>
                Stay
              </Button>
              <Button className="flex-1" onClick={leave}>
                {matchRunning ? 'Ask them' : tournament && !seriesOver ? 'Pause it' : 'Leave'}
              </Button>
            </div>
          </Card>
        ) : (
          <Button
            variant="ghost"
            disabled={session.leaveRequest !== null}
            onClick={() => setConfirmingLeave(true)}
          >
            {session.leaveRequest !== null ? 'Asked…' : matchRunning ? 'Ask to stop' : 'Leave'}
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
