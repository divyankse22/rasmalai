import { randomUUID } from 'node:crypto';
import type { ActionTiming, AnyGameRules, GameContext, GameResult, PlayerIndex } from '@rasmalai/games';
import { findGameRules } from '@rasmalai/games/server';
import {
  COUNTDOWN_MS,
  EVENTS,
  RECONNECT_WINDOW_MS,
  type MatchResultView,
  type Reaction,
  type SessionEndReason,
  type SessionPhase,
  type SessionPlayer,
  type SessionView,
} from '@rasmalai/shared';
import { logger } from '../../logger';
import type { Gender } from '../users/user.schema';
import { startMatch, type RunningMatch } from './matchRunner';
import { SessionError } from './sessionError';

export { SessionError } from './sessionError';

/**
 * Live game sessions, in memory.
 *
 * `docs/02_ARCHITECTURE.md` puts ephemeral session state in backend memory and persistent state in
 * Postgres, and `docs/13` section 6 accepts the consequence explicitly: a restart mid-session
 * returns both players to the dashboard rather than resurrecting a half-finished game. Invitations
 * and matches survive; this does not.
 *
 * Everything here is keyed to the **user**, never to a socket. A person may hold several sockets
 * (a phone and a laptop, or two tabs), so a refresh must be a non-event rather than a disconnect.
 *
 * A session outlives the match inside it. Finishing puts it on the results screen with both players
 * unready; both readying again starts another match in the same session, which is what makes a
 * rematch a rematch rather than a second invitation.
 */

export interface SessionPlayerSeed {
  userId: string;
  nickname: string;
  avatarKey: string;
  gender: Gender;
}

interface PlayerState extends SessionPlayerSeed {
  ready: boolean;
}

interface Session {
  id: string;
  coupleId: string;
  gameSlug: string;
  gameName: string;
  /** Seat 0 and seat 1. The game only ever sees these indices, never a user id. */
  players: [PlayerState, PlayerState];
  phase: SessionPhase;
  /** Where to return if a countdown is called off — the lobby, or the results screen. */
  phaseBeforeCountdown: SessionPhase;
  startsAt: number | null;
  reconnectDeadline: number | null;
  /** Who we are waiting for, while a reconnect window is open. */
  awaiting: string | null;
  /** The match being played, or the one just finished while the results are on screen. */
  game: RunningMatch | null;
  result: GameResult | null;
  /** P-3: only a competitive game's result is a win over somebody. */
  competitive: boolean;
  /** Whether this game's clock stops when a player drops, from its reconnect policy. */
  pauseOnDisconnect: boolean;
  countdownTimer: NodeJS.Timeout | undefined;
  reconnectTimer: NodeJS.Timeout | undefined;
}

/** What the registry needs from the socket layer, kept narrow so it can be faked in tests. */
export interface PresenceSource {
  isOnline(userId: string): boolean;
}

export interface SessionEmitter {
  sendToUser(userId: string, type: string, payload: unknown): void;
}

/** Injection points, used by tests to make an entire match deterministic. */
export interface SessionRegistryOptions {
  findRules?: (slug: string) => AnyGameRules | null;
  random?: GameContext['random'];
  now?: () => number;
}

export interface SessionRegistry {
  create(input: {
    coupleId: string;
    gameSlug: string;
    gameName: string;
    players: [SessionPlayerSeed, SessionPlayerSeed];
  }): SessionView;
  /** The view of a session as one of its players sees it. Throws if they are not in it. */
  viewFor(sessionId: string, userId: string): SessionView;
  sessionIdForUser(userId: string): string | null;
  setReady(sessionId: string, userId: string, ready: boolean): void;
  /** An intent from a player. The game validates it; the platform never reads it. */
  submitAction(sessionId: string, userId: string, action: unknown, at: ActionTiming): void;
  /** A deliberate exit, which closes the session for both of them. */
  leave(sessionId: string, userId: string): void;
  react(sessionId: string, userId: string, reaction: Reaction): void;
  /** Called by the socket layer when a person's last socket closes, or their first one opens. */
  handlePresence(userId: string, online: boolean): void;
  /** Ends everything. Used on shutdown so nobody is left staring at a dead lobby. */
  closeAll(): void;
  readonly size: number;
}

const otherSeat = (seat: PlayerIndex): PlayerIndex => (seat === 0 ? 1 : 0);

export function createSessionRegistry(
  emitter: SessionEmitter,
  presence: PresenceSource,
  { findRules = findGameRules, random, now = Date.now }: SessionRegistryOptions = {},
): SessionRegistry {
  const byId = new Map<string, Session>();
  const byCouple = new Map<string, string>();
  const byUser = new Map<string, string>();

  function seatOf(session: Session, userId: string): PlayerIndex {
    if (session.players[0].userId === userId) return 0;
    if (session.players[1].userId === userId) return 1;
    throw new SessionError('not_authorized', 'That session is not yours.');
  }

  function playerView(player: PlayerState): SessionPlayer {
    return {
      userId: player.userId,
      nickname: player.nickname,
      avatarKey: player.avatarKey,
      gender: player.gender,
      // Presence is asked for at read time rather than cached, so it cannot go stale behind a
      // missed event.
      online: presence.isOnline(player.userId),
      ready: player.ready,
    };
  }

  function resultView(result: GameResult, seat: PlayerIndex, competitive: boolean): MatchResultView {
    return {
      outcome: result.draw ? 'drawn' : result.winner === seat ? 'won' : 'lost',
      yourScore: result.scores[seat],
      theirScore: result.scores[otherSeat(seat)],
      competitive,
    };
  }

  function view(session: Session, userId: string): SessionView {
    const seat = seatOf(session, userId);
    const you = session.players[seat];
    const partner = session.players[otherSeat(seat)];

    return {
      id: session.id,
      gameSlug: session.gameSlug,
      gameName: session.gameName,
      phase: session.phase,
      you: playerView(you),
      partner: playerView(partner),
      // The game renders itself from this and nothing else, so every frame is a complete picture
      // and a client that missed one is never subtly behind.
      game: session.game ? { slug: session.game.slug, state: session.game.viewFor(seat) } : null,
      result: session.result ? resultView(session.result, seat, session.competitive) : null,
      startsAt: session.startsAt,
      reconnectDeadline: session.reconnectDeadline,
    };
  }

  /** Sends one event to both players, each seeing themselves as `you`. */
  function broadcast(session: Session, type: string, extra?: Record<string, unknown>): void {
    for (const player of session.players) {
      emitter.sendToUser(player.userId, type, { session: view(session, player.userId), ...extra });
    }
  }

  /** Sends to one seat only — for the parts of a game the other player is not allowed to see. */
  function emitToSeat(session: Session, seat: PlayerIndex, type: string): void {
    const player = session.players[seat];
    emitter.sendToUser(player.userId, type, { session: view(session, player.userId) });
  }

  function clearTimers(session: Session): void {
    if (session.countdownTimer) clearTimeout(session.countdownTimer);
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    session.countdownTimer = undefined;
    session.reconnectTimer = undefined;
  }

  function forget(session: Session): void {
    clearTimers(session);
    session.game?.stop();
    byId.delete(session.id);
    byUser.delete(session.players[0].userId);
    byUser.delete(session.players[1].userId);
    if (byCouple.get(session.coupleId) === session.id) byCouple.delete(session.coupleId);
  }

  function endSession(
    session: Session,
    phase: 'finished' | 'abandoned',
    reason: SessionEndReason,
    byUserId?: string,
  ): void {
    session.phase = phase;
    session.startsAt = null;
    session.reconnectDeadline = null;
    session.awaiting = null;
    clearTimers(session);
    session.game?.stop();
    broadcast(session, EVENTS.lobby.ended, {
      reason,
      ...(byUserId === undefined ? {} : { byUserId }),
    });
    forget(session);
  }

  /** The match is over. The session is not: this is the results screen, and a rematch starts here. */
  function finishMatch(session: Session, result: GameResult): void {
    session.phase = 'finished';
    session.result = result;
    session.startsAt = null;
    // Both unready, so a rematch needs both of them to say so rather than one dragging the other
    // off a results screen they have not read.
    for (const player of session.players) player.ready = false;

    broadcast(session, EVENTS.results.matchResult);
  }

  /** Hands the session over to the game module. Everything from here is the game's decision. */
  function startGame(session: Session): void {
    const rules = findRules(session.gameSlug);
    if (!rules) {
      // Unreachable in practice: only a game with a module is `enabled` in the catalogue, and only
      // an enabled game can be invited to. If the two ever disagree, saying so is far better than
      // leaving two people in a lobby that will never start.
      logger.error({ gameSlug: session.gameSlug }, 'no game module for an accepted invitation');
      endSession(session, 'abandoned', 'abandoned');
      return;
    }

    session.game?.stop();
    session.result = null;
    session.competitive = rules.meta.scoringKind === 'competitive';
    session.pauseOnDisconnect = rules.reconnectPolicy.pauseOnDisconnect;

    session.game = startMatch({
      rules,
      now,
      ...(random ? { random } : {}),
      emitter: {
        emit(type, to) {
          if (to === undefined) broadcast(session, type);
          else emitToSeat(session, to, type);
        },
        onComplete(result) {
          finishMatch(session, result);
        },
      },
    });
  }

  /** Both ready and both here — start the shared clock. */
  function maybeStartCountdown(session: Session): void {
    const everyoneReady = session.players.every(
      (player) => player.ready && presence.isOnline(player.userId),
    );
    // A rematch counts down from the results screen, so `finished` is a place a countdown can start
    // from just as much as the lobby is.
    if (!everyoneReady || (session.phase !== 'lobby' && session.phase !== 'finished')) return;

    session.phaseBeforeCountdown = session.phase;
    session.phase = 'countdown';
    // The deadline is the server's, and both clients render it by subtracting their own clock.
    // Nothing about the start is decided by either browser (docs/04 section 5).
    session.startsAt = now() + COUNTDOWN_MS;
    broadcast(session, EVENTS.lobby.starting);

    session.countdownTimer = setTimeout(() => {
      session.countdownTimer = undefined;
      if (session.phase !== 'countdown') return;
      session.phase = 'active';
      session.startsAt = null;
      // Built before the announcement, so the frame that says "started" already carries the game.
      startGame(session);
      if (session.phase === 'active') broadcast(session, EVENTS.lobby.started);
    }, COUNTDOWN_MS);
  }

  /** Puts a started countdown back where it came from — someone unreadied, or someone vanished. */
  function abandonCountdown(session: Session): void {
    if (session.countdownTimer) clearTimeout(session.countdownTimer);
    session.countdownTimer = undefined;
    session.startsAt = null;
    if (session.phase === 'countdown') session.phase = session.phaseBeforeCountdown;
  }

  function requireSession(sessionId: string): Session {
    const session = byId.get(sessionId);
    if (!session) throw new SessionError('session_not_found', 'That session has ended.');
    return session;
  }

  return {
    get size() {
      return byId.size;
    },

    create({ coupleId, gameSlug, gameName, players }) {
      // ADR-009: one active session per couple. The couple's previous session must be gone before
      // another can start, otherwise two games could be live at once and both would be wrong.
      const existing = byCouple.get(coupleId);
      if (existing && byId.has(existing)) {
        throw new SessionError('already_in_game', 'You two already have a game going.');
      }

      const session: Session = {
        id: randomUUID(),
        coupleId,
        gameSlug,
        gameName,
        players: [
          { ...players[0], ready: false },
          { ...players[1], ready: false },
        ],
        phase: 'lobby',
        phaseBeforeCountdown: 'lobby',
        startsAt: null,
        reconnectDeadline: null,
        awaiting: null,
        game: null,
        result: null,
        competitive: false,
        pauseOnDisconnect: true,
        countdownTimer: undefined,
        reconnectTimer: undefined,
      };

      byId.set(session.id, session);
      byCouple.set(coupleId, session.id);
      byUser.set(players[0].userId, session.id);
      byUser.set(players[1].userId, session.id);

      return view(session, players[0].userId);
    },

    viewFor(sessionId, userId) {
      return view(requireSession(sessionId), userId);
    },

    sessionIdForUser(userId) {
      const sessionId = byUser.get(userId);
      return sessionId && byId.has(sessionId) ? sessionId : null;
    },

    setReady(sessionId, userId, ready) {
      const session = requireSession(sessionId);
      const seat = seatOf(session, userId);
      const player = session.players[seat];

      // Readiness only means anything before a match begins — in the lobby, during the countdown,
      // or on the results screen where it means "again".
      if (session.phase !== 'lobby' && session.phase !== 'countdown' && session.phase !== 'finished') {
        throw new SessionError('invalid_game_state', 'The game has already started.');
      }

      // A repeat of the state we already hold is a duplicate frame — acknowledge, change nothing.
      if (player.ready === ready) {
        emitter.sendToUser(userId, EVENTS.lobby.joined, { session: view(session, userId) });
        return;
      }

      player.ready = ready;

      if (!ready) {
        abandonCountdown(session);
        broadcast(session, EVENTS.lobby.playerUnready);
        return;
      }

      broadcast(session, EVENTS.lobby.playerReady);
      maybeStartCountdown(session);
    },

    submitAction(sessionId, userId, action, at) {
      const session = requireSession(sessionId);
      const seat = seatOf(session, userId);

      if (session.phase !== 'active' || !session.game) {
        throw new SessionError('invalid_game_state', 'Nothing is being played right now.');
      }
      if (session.awaiting !== null) {
        throw new SessionError('invalid_game_state', 'The game is paused.');
      }

      // Straight through to the rules, unread. The platform cannot know what a legal action looks
      // like, and a platform that guessed would be a platform each new game had to be fitted to.
      session.game.submitAction(seat, action, at);
    },

    leave(sessionId, userId) {
      const session = requireSession(sessionId);
      // Authorization first: knowing an id is not permission to end somebody else's game.
      seatOf(session, userId);

      // Deliberately not a disconnect. Someone who walks away on purpose should not leave their
      // partner watching a two-minute countdown for a person who is not coming back.
      endSession(session, session.phase === 'finished' ? 'finished' : 'abandoned', 'left', userId);
    },

    react(sessionId, userId, reaction) {
      const session = requireSession(sessionId);
      seatOf(session, userId);

      // Ephemeral: relayed and forgotten, never written down (docs/04 section 9). Sent to both, so
      // the sender's other devices show what they just sent.
      for (const target of session.players) {
        emitter.sendToUser(target.userId, EVENTS.reaction.sent, {
          reaction,
          // Stamped by the server. A client cannot react as its partner.
          fromUserId: userId,
        });
      }
    },

    handlePresence(userId, online) {
      const sessionId = byUser.get(userId);
      if (!sessionId) return;

      const session = byId.get(sessionId);
      if (!session) return;

      if (online) {
        if (session.awaiting === userId) {
          // They made it back inside the window.
          if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
          session.reconnectTimer = undefined;
          session.reconnectDeadline = null;
          session.awaiting = null;
          // Restarted rather than resumed mid-flight: the round they missed is thrown away and a
          // fresh one is armed, so neither of them is scored on a moment nobody could see.
          if (session.pauseOnDisconnect) session.game?.resume();
          broadcast(session, EVENTS.presence.playerConnected);
          broadcast(session, EVENTS.presence.playerReconnected);
          // A resumed countdown restarts from the top rather than continuing from wherever it was,
          // so the person who just came back gets the same 3-2-1 as the one who waited.
          maybeStartCountdown(session);
          return;
        }

        broadcast(session, EVENTS.presence.playerConnected);
        return;
      }

      // Nobody can be ready while they are gone. Clearing it stops a countdown from firing for a
      // player who is not there to see it.
      const seat = session.players.findIndex((candidate) => candidate.userId === userId);
      const player = seat === -1 ? undefined : session.players[seat];
      if (player) player.ready = false;
      abandonCountdown(session);

      if (session.phase === 'lobby' || session.phase === 'finished') {
        // Nobody is left to hold it open for. Ending it frees the couple to invite each other to
        // something else — a session kept alive for two people who have both closed the tab is a
        // session that blocks every future invitation until the process restarts (ADR-009).
        if (!session.players.some((candidate) => presence.isOnline(candidate.userId))) {
          endSession(session, 'abandoned', 'abandoned');
          return;
        }

        // Nothing is running, so there is nothing to hold open. The partner simply sees them go.
        broadcast(session, EVENTS.presence.playerDisconnected);
        return;
      }

      // The clock stops before anyone is told, so the frame announcing the window already shows a
      // paused game rather than one still counting down towards a player who cannot see it.
      if (session.pauseOnDisconnect) session.game?.pause();

      session.awaiting = userId;
      session.reconnectDeadline = now() + RECONNECT_WINDOW_MS;
      broadcast(session, EVENTS.presence.reconnectWindowStarted);

      session.reconnectTimer = setTimeout(() => {
        session.reconnectTimer = undefined;
        if (session.awaiting !== userId) return;

        session.reconnectDeadline = null;
        broadcast(session, EVENTS.presence.reconnectWindowExpired);
        // P-8: an abandoned session counts towards nothing. Slice 8 writes the row; there is
        // nothing to record yet, and nobody is awarded a win for a partner's bad wifi.
        endSession(session, 'abandoned', 'abandoned');
      }, RECONNECT_WINDOW_MS);
    },

    closeAll() {
      for (const session of [...byId.values()]) {
        endSession(session, 'abandoned', 'server_stopped');
      }
    },
  };
}
