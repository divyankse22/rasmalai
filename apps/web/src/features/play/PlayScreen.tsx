'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EVENTS,
  REACTIONS,
  type GameEventPayload,
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
import { RETURN_DELAY_MS, endingMessage, returnPathFor } from '@/features/play/sessionEnding';
import { formatClock, useCountdown } from '@/features/play/useCountdown';
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

  // A deliberate concession, present the whole time — the opposite story from a timeout, and the
  // real scoreline is worth printing here: nobody vanished, the board is exactly what it says.
  if (result.byGiveUp) {
    return (
      <>
        <span className="text-4xl" aria-hidden="true">
          🏳️
        </span>
        <p className="font-display text-xl font-bold text-ink">
          {result.outcome === 'won' ? 'They gave up' : 'You gave up'}
        </p>
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
              This one goes to you. <PersonName name={partner.nickname} gender={partner.gender} />{' '}
              was away too long.
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
  /** Where an ended session puts you, and when. Both null until there is an ending to leave. */
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [returnAt, setReturnAt] = useState<number | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false);
  const [floating, setFloating] = useState<FloatingReaction[]>([]);
  /** The partner's last `game.event`. Opaque to this screen — only the game itself reads it. */
  const [partnerSignal, setPartnerSignal] = useState<unknown>(null);

  const countdown = useCountdown(session?.startsAt ?? null);
  const moveSeconds = useCountdown(session?.turnDeadline ?? null);
  const returnSeconds = useCountdown(returnAt);

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

  /**
   * The last view we held, for the listener to read without depending on it.
   *
   * An ending needs to know whether this was a tournament game to decide where to send you, and the
   * frame that carries the ending cannot always answer: a series the engine has finished with is
   * dropped from its live map, so `session.tournament` comes back null on the very frame that most
   * needs it. What the screen was showing a moment earlier is the reliable answer.
   */
  const sessionRef = useRef<SessionView | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

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

  /** A game's own ephemeral signal to its partner. Fire-and-forget, unlike `act`. */
  const sendSignal = useCallback(
    (signal: unknown) => {
      send(EVENTS.game.event, { sessionId, event: signal });
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

    endedRef.current = true;
    send(EVENTS.lobby.leave, { sessionId });
    // Putting a series down (D-5) belongs on the series card, next to the clock it now runs on and
    // the button that picks it up again.
    router.push(returnPathFor(session?.tournament));
  }, [send, sessionId, router, session?.phase, session?.tournament]);

  /**
   * A third way out, mid-match only: decide it right here rather than ask.
   *
   * Unlike `leave`, needs nobody's agreement — that is the whole point of a concession. The server
   * turns it into a walkover result (or, for a game with no winner to award, an ending) and the
   * screen finds out what happened the same way it finds out about any other ending.
   */
  const giveUp = useCallback(() => {
    send(EVENTS.lobby.giveUp, { sessionId });
    setConfirmingGiveUp(false);
  }, [send, sessionId]);

  /**
   * This game is over, for whatever reason. Says so, stops talking to the server about it, and
   * starts the short walk back.
   *
   * First call wins. A decline says so locally for an instant answer, and the `lobby.ended` frame
   * confirming it lands a millisecond later with a blunter sentence — the first one is the one that
   * knows why, so it keeps the screen.
   */
  const finish = useCallback((message: string, destination: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setEnded(message);
    setReturnTo(destination);
    setReturnAt(Date.now() + RETURN_DELAY_MS);
  }, []);

  /**
   * An ending is not a place to stand.
   *
   * Two seconds is long enough to read one sentence and short enough that nobody has to find a
   * button to leave a game that is already over. `Go now` skips it, and `returnTo` going back to
   * null cancels it — which is what stops a tournament moving to its next game from being undone by
   * a redirect armed a moment earlier.
   */
  useEffect(() => {
    if (!returnTo) return;
    const timer = setTimeout(() => router.push(returnTo), RETURN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [returnTo, router]);

  /**
   * "No, thanks."
   *
   * A rematch has no protocol of its own — offering one is readying up on a finished session, so
   * refusing one is leaving it, and leaving a match that is already over needs nobody's agreement
   * and no second confirmation. Said locally as well as sent, so the answer is on screen before the
   * round trip: a button that appears to do nothing is the whole reason this exists.
   */
  const declineRematch = useCallback(() => {
    send(EVENTS.lobby.leave, { sessionId });
    finish('No rematch — heading back.', '/dashboard');
  }, [send, sessionId, finish]);

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
          const payload = envelope.payload as SessionEndedPayload;
          if (payload.session && payload.session.id !== sessionId) return;

          finish(
            endingMessage(payload),
            returnPathFor(payload.session?.tournament ?? sessionRef.current?.tournament),
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
          // Disarms the walk back to the dashboard first. `endSession` broadcasts the ending and
          // *then* opens the next game, so without this the redirect armed two seconds ago fires
          // into a game the player has only just arrived in.
          setReturnTo(null);
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
            current && current.tournament?.id === tournament.id
              ? { ...current, tournament }
              : current,
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

        if (envelope.type === EVENTS.game.event) {
          const { event, fromUserId } = envelope.payload as GameEventPayload;
          // The relay sends to both players (same as a reaction); only the partner's copy is worth
          // keeping here, since the sender's own signal is already whatever local state produced it.
          if (fromUserId !== session?.you.userId) setPartnerSignal(event);
          return;
        }

        if (envelope.type === EVENTS.error) {
          const error = envelope.payload as ProtocolError;

          // One socket carries the whole app, so an error naming a different game is not this
          // screen's business — and that is the common case, because the frame a page sends on its
          // way out routinely lands after the server has forgotten the session it named.
          if (error.sessionId !== undefined && error.sessionId !== sessionId) return;

          if (error.code === 'session_not_found') {
            finish(
              'That game is no longer running.',
              returnPathFor(sessionRef.current?.tournament),
            );
            return;
          }

          // Deliberately its own message rather than sharing the one above: `not_authorized` also
          // comes back from perfectly ordinary refusals mid-match, and blanking a live game for one
          // of those would be inventing an ending.
          if (error.code === 'not_authorized') {
            finish('That game is not yours.', returnPathFor(sessionRef.current?.tournament));
          }
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
        {returnSeconds !== null && (
          <p className="text-sm text-muted" role="timer">
            Returning in {Math.min(returnSeconds, RETURN_DELAY_MS / 1000)}…
          </p>
        )}
        <Button onClick={() => router.push(returnTo ?? '/dashboard')}>Go now</Button>
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

      {/* The full standings live on the tournament's own page, not here — this screen stays focused
          on the game being played. Just enough to say where things stand and how to get there. */}
      {tournament && !seriesOver && (
        <Link
          href={`/tournament/${tournament.id}`}
          className="flex items-center justify-center gap-2 self-center rounded-pill bg-cream px-4 py-1.5 text-sm text-muted transition-transform duration-quick ease-bounce active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
        >
          <span aria-hidden="true">🏆</span>
          <span className="font-display font-semibold tabular-nums text-ink">
            {tournament.yourTotalPoints}–{tournament.partnerTotalPoints}
          </span>
          <span>Series →</span>
        </Link>
      )}

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

      {session.phase === 'finished' && session.result && (
        <Card className="flex flex-col items-center gap-2 text-center">
          <ResultBanner result={session.result} partner={session.partner} />

          {/* D-2: each game is played once, so there is no rematch inside a series. Both of them
              readying moves the evening on to the next game instead. */}
          {seriesOver && tournament ? (
            // The finale — winner, final score — lives on the tournament's own page, not here.
            <div className="mt-2 flex w-full flex-col items-center gap-1">
              <Button
                className="w-full"
                onClick={() => router.push(`/tournament/${tournament.id}`)}
              >
                See the final score →
              </Button>
            </div>
          ) : !tournament && session.partner.ready && !session.you.ready ? (
            /* They asked first, so this is a response rather than an offer: ✓ is the same ready
               toggle as always, and ✗ closes the session then and there. Both answers land where
               the question was asked — an ✗ that only revealed a confirmation card down in the
               page footer, below the whole finished board, read as a button that did nothing. */
            <div className="mt-2 flex w-full flex-col items-center gap-1">
              <p className="text-xs text-muted">
                <PersonName name={session.partner.nickname} gender={session.partner.gender} /> wants
                a rematch.
              </p>
              <div className="flex w-full gap-2">
                <Button
                  variant="soft"
                  className="flex-1"
                  aria-label="Decline the rematch"
                  onClick={declineRematch}
                >
                  ✗
                </Button>
                <Button className="flex-1" aria-label="Accept the rematch" onClick={toggleReady}>
                  ✓
                </Button>
              </div>
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
          partnerSignal={partnerSignal}
          sendSignal={sendSignal}
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
                  Ask <PersonName name={session.partner.nickname} gender={session.partner.gender} />{' '}
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
        ) : confirmingGiveUp ? (
          // Unlike `requestLeave`, this needs nobody's agreement — it decides the match right here,
          // which is exactly why it gets its own confirmation rather than sharing the one above.
          <Card className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-ink">Give up? This one ends right here — no take-backs.</p>
            <div className="flex w-full gap-2">
              <Button variant="soft" className="flex-1" onClick={() => setConfirmingGiveUp(false)}>
                Keep playing
              </Button>
              <Button className="flex-1" onClick={giveUp}>
                Give up 🏳️
              </Button>
            </div>
          </Card>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              disabled={session.leaveRequest !== null}
              onClick={() => setConfirmingLeave(true)}
            >
              {session.leaveRequest !== null ? 'Asked…' : matchRunning ? 'Ask to stop' : 'Leave'}
            </Button>
            {matchRunning && (
              <Button variant="ghost" onClick={() => setConfirmingGiveUp(true)}>
                Give up
              </Button>
            )}
          </div>
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
