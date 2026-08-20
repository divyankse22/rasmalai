import { randomUUID } from 'node:crypto';
import {
  PLAYERS,
  type ActionTiming,
  type AnyGameRules,
  type GameContext,
  type GameResult,
  type PlayerIndex,
} from '@rasmalai/games';
import { findGameRules } from '@rasmalai/games/server';
import {
  COUNTDOWN_MS,
  EVENTS,
  LEAVE_REQUEST_TTL_MS,
  MOVE_WINDOW_MS,
  RECONNECT_WINDOW_MS,
  type MatchResultView,
  type Reaction,
  type SessionEndReason,
  type SessionPhase,
  type SessionPlayer,
  type SessionView,
  type TournamentView,
} from '@rasmalai/shared';
import { logger } from '../../logger';
import {
  NULL_MATCH_RECORDER,
  type MatchEndedInput,
  type MatchRecorder,
} from '../statistics/matchRecorder';
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
 *
 * ## Being here, and leaving
 *
 * A player is **present** when they have a socket *and* are on the game's page. The socket outlives
 * the page on purpose (P-7), so without the second half, routing to the dashboard mid-match would be
 * invisible while closing the tab was not — two identical walkouts treated completely differently.
 *
 * Leaving an active match therefore has exactly two shapes:
 *
 * - **Asked for.** `requestLeave` puts it to the other person, who has 30 seconds to agree. Agreed,
 *   the session closes with no result and counts towards nothing — this is the P-8 case, and the
 *   only free way out of a match.
 * - **Taken.** Run down the clock, and the match is forfeit: a competitive game is awarded to
 *   whoever stayed, and one with no winner to award simply stops.
 *
 * The asymmetry is the point. A free exit that needed nobody's agreement would be the one everybody
 * took, and the forfeit would never fire.
 *
 * ## The clock
 *
 * There is one clock and it is always 120 seconds, because from the other side of the board there
 * is no difference between a partner who dropped off and one who is sitting there not playing.
 * Two things put somebody on it:
 *
 * - **Being away.** Every player who is not present has their own `awayUntil`. Both of them can be
 *   on it at once, which is the whole reason it is per player rather than per session.
 * - **Being on the move.** During an active match, whoever the game says it is waiting on has
 *   `MOVE_WINDOW_MS` to move. It restarts when the turn changes, and it does not run at all while
 *   anybody is away — the registry refuses actions then, and timing somebody out for not making a
 *   move it would have rejected is indefensible.
 *
 * When the clock runs out, whoever is **at fault** loses, and that is the only rule:
 *
 * - one at fault → the other player takes it (competitive) or the game simply stops (P-3);
 * - both at fault → nobody won anything, and the session closes counting towards nothing (P-8);
 *
 * ## Writing it down
 *
 * A match is announced to the `MatchRecorder` when it starts and again when it ends, and that is the
 * registry's entire relationship with the database. It stays synchronous: recording is fire and
 * forget, so a slow write can never hold up a move. Seats are turned back into people on the way
 * out — the game never learns who played it, and the statistics never learn there were seats.
 *
 * Both at fault is the case that used to close a session the instant the second person stepped
 * away. It no longer does: the window runs for both of them, and whoever gets back inside it is the
 * last one left in the room. That also stops the *first* player to arrive from tearing the session
 * down before the second one has even loaded the page — a refresh at the wrong moment used to end a
 * game neither of them had started.
 */

export interface SessionPlayerSeed {
  userId: string;
  nickname: string;
  avatarKey: string;
  gender: Gender;
}

interface PlayerState extends SessionPlayerSeed {
  ready: boolean;
  /**
   * Whether their client says it is on this session's page.
   *
   * Set by `lobby.join`, cleared by `lobby.away` — and cleared when their last socket closes, since
   * a client that comes back always re-joins (`PlayScreen` joins on every transition into
   * `connected`). Leaving it set across a disconnect meant somebody who closed the game tab and
   * reappeared on their dashboard counted as back at the table.
   */
  onPage: boolean;
  /**
   * The last presence we actually acted on, for edge detection only.
   *
   * Presence itself is always recomputed from the truth (`isPresent`), so a view can never go stale
   * behind a missed event. This exists so that arriving twice does not clear a window twice, and so
   * that a socket dropping for somebody who had already navigated away is the non-event it is.
   */
  wasPresent: boolean;
  /** Whether they have ever been here, which is what makes an arrival a *return*. */
  everPresent: boolean;
  /** Epoch ms when their 120 seconds run out, or null while they are here. */
  awayUntil: number | null;
}

/** A pending "can we stop here?". */
interface LeaveRequest {
  byUserId: string;
  expiresAt: number;
  timer: NodeJS.Timeout;
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
  /** The seat currently on the move clock, or null when nobody is. */
  turnSeat: PlayerIndex | null;
  /** Epoch ms that seat's move is due by. Null exactly when `turnSeat` is. */
  turnDeadline: number | null;
  /** The match being played, or the one just finished while the results are on screen. */
  game: RunningMatch | null;
  /**
   * The recorder's handle on the match currently being played, or null when none is.
   *
   * Set the moment a match starts and cleared the moment its ending is recorded, so it doubles as
   * the answer to "is there a result still owed to the database?". Every teardown path runs through
   * `endSession`, which uses exactly that to decide whether a match was abandoned mid-play.
   */
  matchKey: string | null;
  /** Whether the match's own clock is currently stopped, so it is neither paused nor resumed twice. */
  gamePaused: boolean;
  result: GameResult | null;
  /** Whether that result was won on the board or by the other player never coming back. */
  resultByForfeit: boolean;
  /** A pending request to stop, which only exists during an active match. */
  leaveRequest: LeaveRequest | null;
  /**
   * Individual or tournament. Tournaments restart a game whose player never came back rather than
   * awarding it (`docs/04` section 6), so the platform decides the consequence and no game module
   * has to know which kind of match it is in.
   */
  mode: 'individual' | 'tournament';
  /** The series this session is one game of, or null for individual play. */
  tournamentId: string | null;
  /**
   * Whether the tournament has already been told how this session's match ended.
   *
   * Exactly once per session, and for the same reason `matchKey` is: a finished match is announced
   * by `finishMatch`, and the `endSession` that follows when the engine closes the results screen
   * must not announce it a second time as an abandonment.
   */
  tournamentNotified: boolean;
  /** P-3: only a competitive game's result is a win over somebody. */
  competitive: boolean;
  /** Whether this game's clock stops when a player drops, from its reconnect policy. */
  pauseOnDisconnect: boolean;
  countdownTimer: NodeJS.Timeout | undefined;
  /** The one timer for both kinds of deadline, always armed to whichever comes first. */
  clockTimer: NodeJS.Timeout | undefined;
}

/** What the registry needs from the socket layer, kept narrow so it can be faked in tests. */
export interface PresenceSource {
  isOnline(userId: string): boolean;
}

export interface SessionEmitter {
  sendToUser(userId: string, type: string, payload: unknown): void;
}

/** How a tournament session's match ended, with every seat already resolved to a person. */
export interface TournamentMatchEnded {
  tournamentId: string;
  /** The session it happened in, so the engine can close exactly the one it opened. */
  sessionId: string;
  coupleId: string;
  gameSlug: string;
  /**
   * Whether the match produced a result at all.
   *
   * Null covers every way a tournament game can fail to happen — a reconnect window that ran out, a
   * lobby neither of them ever loaded, an agreed stop. The engine decides which of those restarts
   * the game and which pauses the series; the registry only reports what it saw.
   */
  played: boolean;
  /** Null on a draw, on a non-competitive game, and whenever `played` is false. */
  winnerUserId: string | null;
  byForfeit: boolean;
  /** Whether it ended because the two of them agreed to stop (D-5). */
  byLeave: boolean;
}

/**
 * What the registry needs from the tournament engine, and nothing more.
 *
 * Declared here rather than imported from the engine so the dependency points one way: sessions
 * know that *something* may be running a series over them, and know nothing about how a series is
 * stored, scored or advanced. The engine implements this; a test fakes it in four lines.
 */
export interface TournamentHooks {
  /**
   * The series as this reader sees it, for the session view. Synchronous on purpose — a session
   * view is built on the hot path of every frame, and a database round trip has no business there.
   * The engine holds the standings in memory and refreshes them when they change.
   */
  viewFor(tournamentId: string, userId: string): TournamentView | null;
  /** A tournament game finished, or failed to. */
  matchEnded(input: TournamentMatchEnded): void;
  /** Both players asked for the next game from the results screen. */
  nextGameRequested(tournamentId: string, sessionId: string): void;
  /**
   * A tournament session has closed, for any reason at all.
   *
   * Deliberately *not* latched the way `matchEnded` is, and deliberately separate from it: a game
   * can finish perfectly well and then be walked away from, and those are two different facts. This
   * is the second one — the only signal that a series has been left sitting between games with
   * nothing left to advance it — and it is what D-5 hangs on.
   */
  sessionClosed(tournamentId: string, sessionId: string): void;
}

/** Injection points, used by tests to make an entire match deterministic. */
export interface SessionRegistryOptions {
  findRules?: (slug: string) => AnyGameRules | null;
  random?: GameContext['random'];
  now?: () => number;
  /**
   * Where finished matches go. Defaults to nowhere, which is what every test that is not about
   * statistics wants — and is why the registry stayed free of a database until slice 8.
   */
  recorder?: MatchRecorder;
  /**
   * The tournament engine, when one is running. Absent everywhere else, which is every test that is
   * not about tournaments and any deployment with the feature switched off.
   */
  tournaments?: TournamentHooks;
}

export interface SessionRegistry {
  create(input: {
    coupleId: string;
    gameSlug: string;
    gameName: string;
    players: [SessionPlayerSeed, SessionPlayerSeed];
    /** Defaults to individual. A tournament session must name the series it belongs to. */
    mode?: 'individual' | 'tournament';
    tournamentId?: string;
  }): SessionView;
  /** The view of a session as one of its players sees it. Throws if they are not in it. */
  viewFor(sessionId: string, userId: string): SessionView;
  /**
   * They are on the session's page: mark them present and hand back where things stand.
   *
   * Doubles as the resync after a dropped socket, which is why it returns the whole view rather
   * than a patch — one frame, and the client is exactly where the server is.
   */
  join(sessionId: string, userId: string): SessionView;
  /** They navigated away from the page. Their socket is still open; they are still not here. */
  markAway(sessionId: string, userId: string): void;
  sessionIdForUser(userId: string): string | null;
  setReady(sessionId: string, userId: string, ready: boolean): void;
  /** An intent from a player. The game validates it; the platform never reads it. */
  submitAction(sessionId: string, userId: string, action: unknown, at: ActionTiming): void;
  /** Mid-match: ask the other person whether you can both stop. */
  requestLeave(sessionId: string, userId: string): void;
  /** Answering one. From the asker, `accept: false` withdraws it. */
  respondToLeave(sessionId: string, userId: string, accept: boolean): void;
  /**
   * A deliberate exit, which closes the session for both of them.
   *
   * Refused during an active match while the other player is here — that is what `requestLeave` is
   * for. Allowed once they are gone, because there is nobody left to ask.
   */
  leave(sessionId: string, userId: string): void;
  react(sessionId: string, userId: string, reaction: Reaction): void;
  /**
   * A game's own ephemeral signal — opaque to the platform, relayed and forgotten exactly like
   * `react`. Never touches `matches`, a score, or anything `submitAction` governs.
   */
  sendGameEvent(sessionId: string, userId: string, event: unknown): void;
  /**
   * Closes a tournament session from outside, so the couple's one slot (ADR-009) is free before the
   * next game of the series opens in it.
   *
   * Only the engine calls this, and only for a session it opened itself. A no-op for a session that
   * has already gone, which is the ordinary race when both players leave the results screen at the
   * moment the engine was about to move them on.
   */
  closeTournamentSession(sessionId: string): void;
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
  {
    findRules = findGameRules,
    random,
    now = () => Date.now(),
    recorder = NULL_MATCH_RECORDER,
    tournaments,
  }: SessionRegistryOptions = {},
): SessionRegistry {
  const byId = new Map<string, Session>();
  const byCouple = new Map<string, string>();
  const byUser = new Map<string, string>();

  function seatOf(session: Session, userId: string): PlayerIndex {
    if (session.players[0].userId === userId) return 0;
    if (session.players[1].userId === userId) return 1;
    throw new SessionError('not_authorized', 'That session is not yours.');
  }

  /** Here, in the sense that matters: signed in *and* looking at the game. */
  function isPresent(player: PlayerState): boolean {
    return presence.isOnline(player.userId) && player.onPage;
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
      present: isPresent(player),
      awayUntil: player.awayUntil,
      ready: player.ready,
    };
  }

  function resultView(
    result: GameResult,
    seat: PlayerIndex,
    competitive: boolean,
    byForfeit: boolean,
  ): MatchResultView {
    return {
      // P-3 decides this before the scoreline does. A cooperative or social game has no winner to
      // name, so `winner` is null by contract — and read naively that made *both* players the loser,
      // because "not the winner" is what `lost` means for every other game. Nobody beat anybody:
      // `drawn` is the only one of the three that is true of a game with no sides.
      outcome: !competitive || result.draw ? 'drawn' : result.winner === seat ? 'won' : 'lost',
      yourScore: result.scores[seat],
      theirScore: result.scores[otherSeat(seat)],
      competitive,
      byForfeit,
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
      result: session.result
        ? resultView(session.result, seat, session.competitive, session.resultByForfeit)
        : null,
      startsAt: session.startsAt,
      turnUserId: session.turnSeat === null ? null : session.players[session.turnSeat].userId,
      turnDeadline: session.turnDeadline,
      leaveRequest: session.leaveRequest
        ? { byUserId: session.leaveRequest.byUserId, expiresAt: session.leaveRequest.expiresAt }
        : null,
      // Resolved to this reader by the engine, so neither the registry nor the play screen ever has
      // to know which of the couple's two slots the viewer occupies.
      tournament:
        session.tournamentId === null
          ? null
          : (tournaments?.viewFor(session.tournamentId, userId) ?? null),
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

  /** Drops a pending request without telling anybody. The caller says what happened, if anything. */
  function dropLeaveRequest(session: Session): void {
    if (session.leaveRequest) clearTimeout(session.leaveRequest.timer);
    session.leaveRequest = null;
  }

  function clearTimers(session: Session): void {
    if (session.countdownTimer) clearTimeout(session.countdownTimer);
    if (session.clockTimer) clearTimeout(session.clockTimer);
    session.countdownTimer = undefined;
    session.clockTimer = undefined;
    dropLeaveRequest(session);
  }

  /**
   * The seat that should be on the move clock right now, if any.
   *
   * Null while anybody is away, deliberately: `submitAction` refuses every action in that state, so
   * putting the other player on a clock they are not allowed to beat would be timing them out for
   * obeying the rules. Their partner's away clock is already running, and it is the one that
   * decides this.
   */
  function turnSeatNow(session: Session): PlayerIndex | null {
    if (session.phase !== 'active' || !session.game) return null;
    if (session.players.some((player) => player.awayUntil !== null)) return null;
    return session.game.turnOf();
  }

  /**
   * When the clock next needs looking at, or null when nobody is on one.
   *
   * The away half resolves at the **latest** pending deadline rather than the earliest. Two people
   * who walk off at different moments are each on their own 120 seconds, and deciding the match at
   * the first of them would end it while the other still had time left to come back and claim it.
   */
  function nextDeadline(session: Session): number | null {
    const away = session.players
      .map((player) => player.awayUntil)
      .filter((until): until is number => until !== null);

    const candidates: number[] = [];
    if (away.length > 0) candidates.push(Math.max(...away));
    if (session.turnDeadline !== null) candidates.push(session.turnDeadline);

    return candidates.length === 0 ? null : Math.min(...candidates);
  }

  /**
   * Points the move clock at whoever is on it, and arms the single timer.
   *
   * Called after anything that could change either — a move, an arrival, a departure, a phase
   * change — and always *before* the frame announcing it goes out, so no client is ever shown a
   * clock the server has already moved on from.
   *
   * The deadline is only restarted when the seat actually changes hands. Re-running this for an
   * unrelated reason must not quietly hand the player on the move another two minutes.
   */
  function syncClocks(session: Session): void {
    const seat = turnSeatNow(session);
    if (seat !== session.turnSeat) {
      session.turnSeat = seat;
      session.turnDeadline = seat === null ? null : now() + MOVE_WINDOW_MS;
    }

    if (session.clockTimer) clearTimeout(session.clockTimer);
    session.clockTimer = undefined;

    const at = nextDeadline(session);
    if (at === null) return;

    // The floor of a millisecond is the same guard `matchRunner` needs: Node may run a timer a hair
    // before its deadline, and a resolution that arrives early has to re-arm rather than decide a
    // match on a clock that has not actually run out.
    session.clockTimer = setTimeout(() => resolveClock(session), Math.max(1, at - now()));
  }

  /** Whether this seat is the reason the clock ran out. */
  function atFault(session: Session, seat: PlayerIndex, at: number): boolean {
    const player = session.players[seat];
    if (player.awayUntil !== null && player.awayUntil <= at) return true;
    return session.turnDeadline !== null && session.turnDeadline <= at && session.turnSeat === seat;
  }

  /**
   * The clock ran out. Whoever is at fault loses, and that is the whole rule.
   *
   * Both at fault is not a draw and not a forfeit — it is nobody having been there to win, so the
   * session simply stops and counts towards nothing (P-8). Awarding it to the one who happened to
   * leave second would be scoring a match on which of them closed a laptop later.
   */
  function resolveClock(session: Session): void {
    session.clockTimer = undefined;

    const at = nextDeadline(session);
    if (at === null) return;
    if (at > now()) {
      syncClocks(session);
      return;
    }

    // Nobody is here at all — including the case where a session was opened and neither of them
    // ever loaded the page. Nothing to hold open, nothing to award, and the couple is freed to
    // start something else (ADR-009).
    if (!session.players.some(isPresent)) {
      broadcast(session, EVENTS.presence.reconnectWindowExpired);
      endSession(session, 'abandoned', 'abandoned');
      return;
    }

    // Outside a match there is nothing at stake, so a window running out just stops being one. The
    // person who stayed keeps their lobby or their results screen, and the clock only comes back if
    // they walk off too.
    if (session.phase !== 'active') {
      for (const player of session.players) player.awayUntil = null;
      syncClocks(session);
      broadcast(session, EVENTS.presence.reconnectWindowExpired);
      return;
    }

    const blamed = PLAYERS.filter((seat) => atFault(session, seat, now()));
    if (blamed.length === 0) {
      // Unreachable: every deadline `nextDeadline` can return belongs to a seat, so something that
      // has expired always has somebody behind it. Handled anyway, and handled by *clearing* rather
      // than re-arming — re-arming on the same expired deadline would spin this timer as fast as
      // the event loop can run it, which is a far worse failure than a lost clock.
      logger.error({ sessionId: session.id }, 'a clock expired with nobody on it');
      for (const player of session.players) player.awayUntil = null;
      session.turnSeat = null;
      session.turnDeadline = null;
      syncClocks(session);
      return;
    }

    // Tournaments restart a game lost to a dropped connection — one bad wifi moment must not hand
    // over points in a standings table (`docs/04` section 6). A player who is *present* and simply
    // stops moving is not that: they forfeit exactly as they would in an individual match. Letting
    // a restart cover them would mean anybody losing a board could force a replay by sitting on
    // their turn, which is the one thing the move clock exists to prevent.
    if (session.mode === 'tournament' && blamed.some((seat) => !isPresent(session.players[seat]))) {
      broadcast(session, EVENTS.presence.reconnectWindowExpired);
      endSession(session, 'abandoned', 'abandoned');
      return;
    }

    broadcast(session, EVENTS.presence.reconnectWindowExpired);

    if (blamed.length === session.players.length) {
      endSession(session, 'abandoned', 'abandoned');
      return;
    }

    forfeit(session, session.players[blamed[0]!].userId);
  }

  function forget(session: Session): void {
    clearTimers(session);
    session.game?.stop();
    byId.delete(session.id);
    byUser.delete(session.players[0].userId);
    byUser.delete(session.players[1].userId);
    if (byCouple.get(session.coupleId) === session.id) byCouple.delete(session.coupleId);
  }

  /**
   * Hands the match's ending to the recorder, exactly once.
   *
   * Clearing `matchKey` first is what makes it exactly once: a completed match is recorded by
   * `finishMatch`, and the `endSession` that follows when they finally leave the results screen
   * finds nothing left to say.
   */
  function recordEnd(session: Session, outcome: MatchEndedInput['outcome']): void {
    const matchKey = session.matchKey;
    if (matchKey === null) return;
    session.matchKey = null;

    recorder.matchEnded({ matchKey, endedAt: new Date(now()), outcome });
  }

  /**
   * Tells the tournament how this session's game went, exactly once.
   *
   * Once, because both endings run through here: a game that finished announces itself from
   * `finishMatch`, and the `endSession` that follows — when the engine closes the results screen, or
   * when the two of them walk away from it — finds nothing left to say. Without the latch, every
   * completed tournament game would be reported a second time as an abandonment and restarted.
   *
   * Seats become people here, like everywhere else the platform talks to something outside itself.
   */
  function notifyTournament(
    session: Session,
    outcome: { played: boolean; result?: GameResult; byForfeit?: boolean; byLeave?: boolean },
  ): void {
    if (session.mode !== 'tournament' || session.tournamentId === null) return;
    if (session.tournamentNotified) return;
    if (!tournaments) return;
    session.tournamentNotified = true;

    const winner = outcome.result?.winner;

    tournaments.matchEnded({
      tournamentId: session.tournamentId,
      sessionId: session.id,
      coupleId: session.coupleId,
      gameSlug: session.gameSlug,
      played: outcome.played,
      // P-3 again, from the other direction: a game with no winner to award never names one, so a
      // cooperative round in a tournament moves the series on without moving the standings.
      winnerUserId:
        outcome.played && session.competitive && winner !== undefined && winner !== null
          ? session.players[winner].userId
          : null,
      byForfeit: outcome.byForfeit ?? false,
      byLeave: outcome.byLeave ?? false,
    });
  }

  function endSession(
    session: Session,
    phase: 'finished' | 'abandoned',
    reason: SessionEndReason,
    byUserId?: string,
  ): void {
    // Before `recordEnd` clears the match: a tournament session that reaches here without having
    // announced a result never produced one, whatever the reason. The engine decides whether that
    // restarts the game or pauses the series (D-5, `docs/13` section 6).
    notifyTournament(session, { played: false, byLeave: reason === 'left' });

    // A match still open at this point is one nobody finished: an agreed stop, both of them gone,
    // a tournament game being restarted, or the process shutting down. P-8 — the row is written and
    // counted by nothing.
    recordEnd(session, { status: 'abandoned' });

    session.phase = phase;
    session.startsAt = null;
    session.turnSeat = null;
    session.turnDeadline = null;
    for (const player of session.players) player.awayUntil = null;
    clearTimers(session);
    session.game?.stop();
    broadcast(session, EVENTS.lobby.ended, {
      reason,
      ...(byUserId === undefined ? {} : { byUserId }),
    });
    forget(session);

    // Last, and after `forget`: the engine may open the next game of the series from here, and the
    // couple's one slot (ADR-009) has to be free before it tries.
    if (session.mode === 'tournament' && session.tournamentId !== null) {
      tournaments?.sessionClosed(session.tournamentId, session.id);
    }
  }

  /** The match is over. The session is not: this is the results screen, and a rematch starts here. */
  function finishMatch(session: Session, result: GameResult, byForfeit = false): void {
    // Seats become people here and nowhere else. A game never learns who it was played by, and the
    // statistics never learn there were seats.
    recordEnd(session, {
      status: 'completed',
      players: [
        { userId: session.players[0].userId, score: result.scores[0] },
        { userId: session.players[1].userId, score: result.scores[1] },
      ],
      winnerUserId: result.winner === null ? null : session.players[result.winner].userId,
      byForfeit,
    });

    session.phase = 'finished';
    session.result = result;
    session.resultByForfeit = byForfeit;
    session.startsAt = null;
    // Nothing is pending against a match that has ended — including a request to stop it.
    dropLeaveRequest(session);
    // Both unready, so a rematch needs both of them to say so rather than one dragging the other
    // off a results screen they have not read.
    for (const player of session.players) player.ready = false;
    // Nobody is on a move clock while a result is on screen — but an away clock still is, so the
    // session cannot sit here forever with neither of them reading it.
    syncClocks(session);

    broadcast(session, EVENTS.results.matchResult);

    // After the frame, not before: the engine answers by pushing the new standings, and a client
    // that received those before the result they belong to would show a scoreboard ahead of the
    // match that moved it.
    notifyTournament(session, { played: true, result, byForfeit });
  }

  /**
   * One player ran the clock out while a match was running — by staying away, or by never moving.
   *
   * A competitive game is awarded to whoever stayed — 1–0, like a walkover, rather than freezing
   * whatever the board happened to show, because "you win, 1–3" is not a sentence anybody should
   * read. `byForfeit` is what lets the screen say what actually happened instead.
   *
   * A cooperative, social or casual game has no winner to award (P-3), so it simply stops and says
   * who did not come back. Awarding one would be inventing a competition the game does not have.
   *
   * The session is left alive on its results screen rather than torn down, so the person who
   * wandered off finds out why when they come back — and so the two of them can rematch if they
   * want to. It cleans itself up as soon as neither of them is here.
   */
  function forfeit(session: Session, awayUserId: string): void {
    const awaySeat = seatOf(session, awayUserId);
    const stayed = otherSeat(awaySeat);

    // The window that just ran out is spent. Leaving the expired deadlines in place would have the
    // clock resolve itself again the instant it was re-armed.
    for (const player of session.players) player.awayUntil = null;
    session.turnSeat = null;
    session.turnDeadline = null;
    session.game?.stop();

    if (!session.competitive) {
      endSession(session, 'abandoned', 'forfeited', awayUserId);
      return;
    }

    const scores: [number, number] = stayed === 0 ? [1, 0] : [0, 1];
    logger.info({ sessionId: session.id, awayUserId }, 'match forfeited');
    finishMatch(session, { winner: stayed, draw: false, scores }, true);
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
    session.resultByForfeit = false;
    session.competitive = rules.meta.scoringKind === 'competitive';
    session.pauseOnDisconnect = rules.reconnectPolicy.pauseOnDisconnect;

    // Announced before the match exists rather than after, because a game is allowed to finish
    // inside `startMatch` and the completion must never overtake the start it belongs to.
    session.matchKey = randomUUID();
    recorder.matchStarted({
      matchKey: session.matchKey,
      coupleId: session.coupleId,
      gameSlug: session.gameSlug,
      mode: session.mode,
      startedAt: new Date(now()),
      ...(session.tournamentId === null ? {} : { tournamentId: session.tournamentId }),
    });

    session.game = startMatch({
      rules,
      now,
      ...(random ? { random } : {}),
      emitter: {
        emit(type, to) {
          // Before the frame goes out, never after: a move that passed the turn has moved the clock
          // with it, and the frame announcing the move is the one that has to carry the new one.
          syncClocks(session);
          if (to === undefined) broadcast(session, type);
          else emitToSeat(session, to, type);
        },
        onComplete(result) {
          finishMatch(session, result);
        },
      },
    });

    session.gamePaused = false;
    // Whoever the game opened on starts their two minutes now.
    syncClocks(session);
  }

  /** Both ready and both here — start the shared clock. */
  function maybeStartCountdown(session: Session): void {
    // Present, not merely online: a countdown that fires for somebody reading their dashboard
    // starts a match one of them cannot see.
    const everyoneReady = session.players.every((player) => player.ready && isPresent(player));
    // A rematch counts down from the results screen, so `finished` is a place a countdown can start
    // from just as much as the lobby is.
    if (!everyoneReady || (session.phase !== 'lobby' && session.phase !== 'finished')) return;

    // D-2: there is no rematch inside a tournament. Each game is played once, so both of them being
    // ready on a results screen means "on to the next one", not "again" — and the next one is a
    // different game in a different session, which only the engine can open. It closes this session
    // on its way, so nothing counts down here.
    if (session.mode === 'tournament' && session.phase === 'finished') {
      if (session.tournamentId !== null) {
        tournaments?.nextGameRequested(session.tournamentId, session.id);
      }
      return;
    }

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

  /** They are back: close the window being held for them and pick up where things stood. */
  function arrived(session: Session, seat: PlayerIndex): void {
    const player = session.players[seat];
    // Arriving for the first time is not coming back, and must not read as one — every session
    // starts with both of them elsewhere, so without this the first person through the door would
    // be announced as a reconnection.
    const returning = player.everPresent;

    player.everPresent = true;
    player.awayUntil = null;

    // Only once *nobody* is missing. One of two absent players coming back is not the moment to
    // start the game running again for the one who is still gone.
    if (session.gamePaused && session.players.every((candidate) => candidate.awayUntil === null)) {
      // Restarted rather than resumed mid-flight: the round they missed is thrown away and a fresh
      // one is armed, so neither of them is scored on a moment nobody could see. A game that keeps
      // its board across a disconnect asks for none of this and gets none of it.
      session.game?.resume();
      session.gamePaused = false;
    }

    // Read after the state settles, so the frame answering a reconnect already shows the clock as
    // it now stands rather than one still counting down against the person reading it. Whoever is
    // on the move gets a fresh two minutes, having spent the last one unable to play at all.
    syncClocks(session);

    broadcast(session, EVENTS.presence.playerConnected);
    if (returning) broadcast(session, EVENTS.presence.playerReconnected);
    // A resumed countdown restarts from the top rather than continuing from wherever it was, so the
    // person who just came back gets the same 3-2-1 as the one who waited.
    maybeStartCountdown(session);
  }

  /**
   * They are gone — tab closed, connection dropped, or simply looking at something else.
   *
   * Their 120 seconds start here, and they start whatever the phase is. A lobby or a results screen
   * has nothing to forfeit, but a session both of them have walked away from still has to stop:
   * held open, it blocks every future invitation this couple sends until the process restarts
   * (ADR-009).
   */
  function left(session: Session, seat: PlayerIndex): void {
    const player = session.players[seat];

    // Nobody can be ready while they are gone. Clearing it stops a countdown from firing for a
    // player who is not there to see it.
    player.ready = false;
    abandonCountdown(session);

    // A request nobody is left to answer, or one made by somebody who has since walked out.
    if (session.leaveRequest) {
      dropLeaveRequest(session);
      broadcast(session, EVENTS.lobby.leaveResolved, { outcome: 'withdrawn' });
    }

    player.awayUntil = now() + RECONNECT_WINDOW_MS;

    // The match's clock stops before anyone is told, so the frame announcing the window already
    // shows a paused game rather than one still counting down towards a player who cannot see it.
    if (session.phase === 'active' && session.pauseOnDisconnect && !session.gamePaused) {
      session.game?.pause();
      session.gamePaused = true;
    }

    syncClocks(session);

    // Two names for the same fact, kept apart because they mean different things on screen: one is
    // "they stepped out", the other is "and here is what it costs".
    broadcast(
      session,
      session.phase === 'active'
        ? EVENTS.presence.reconnectWindowStarted
        : EVENTS.presence.playerDisconnected,
    );
  }

  /**
   * Applies whatever presence now says, if it has changed.
   *
   * Every route in and out — a socket opening or closing, a page joined or navigated away from —
   * arrives here, so there is exactly one place that decides what leaving means.
   */
  function syncPresence(session: Session, seat: PlayerIndex): void {
    const player = session.players[seat];
    const present = isPresent(player);
    if (present === player.wasPresent) return;

    player.wasPresent = present;
    if (present) arrived(session, seat);
    else left(session, seat);
  }

  return {
    get size() {
      return byId.size;
    },

    create({ coupleId, gameSlug, gameName, players, mode = 'individual', tournamentId }) {
      // ADR-009: one active session per couple. The couple's previous session must be gone before
      // another can start, otherwise two games could be live at once and both would be wrong.
      const existing = byCouple.get(coupleId);
      if (existing && byId.has(existing)) {
        throw new SessionError('already_in_game', 'You two already have a game going.');
      }

      // Neither of them is on the page yet — the invitation was accepted from wherever they
      // happened to be standing, and they navigate to it next. They are therefore both already on
      // the clock, which is what stops a session nobody ever loads from sitting in the map holding
      // the couple's one slot for the rest of the process's life (ADR-009).
      const openedAt = now() + RECONNECT_WINDOW_MS;

      const session: Session = {
        id: randomUUID(),
        coupleId,
        gameSlug,
        gameName,
        players: [
          { ...players[0], ready: false, onPage: false, wasPresent: false, everPresent: false, awayUntil: openedAt },
          { ...players[1], ready: false, onPage: false, wasPresent: false, everPresent: false, awayUntil: openedAt },
        ],
        phase: 'lobby',
        phaseBeforeCountdown: 'lobby',
        startsAt: null,
        turnSeat: null,
        turnDeadline: null,
        game: null,
        matchKey: null,
        gamePaused: false,
        result: null,
        resultByForfeit: false,
        leaveRequest: null,
        mode,
        tournamentId: mode === 'tournament' ? (tournamentId ?? null) : null,
        tournamentNotified: false,
        competitive: false,
        pauseOnDisconnect: true,
        countdownTimer: undefined,
        clockTimer: undefined,
      };

      byId.set(session.id, session);
      byCouple.set(coupleId, session.id);
      byUser.set(players[0].userId, session.id);
      byUser.set(players[1].userId, session.id);
      syncClocks(session);

      return view(session, players[0].userId);
    },

    viewFor(sessionId, userId) {
      return view(requireSession(sessionId), userId);
    },

    join(sessionId, userId) {
      const session = requireSession(sessionId);
      // Authorization before anything else: knowing an id is not permission to be in a session.
      const seat = seatOf(session, userId);

      session.players[seat].onPage = true;
      syncPresence(session, seat);
      // Read after syncing, so the frame that answers a reconnect already shows the window closed
      // rather than one still counting down against the person reading it.
      return view(session, userId);
    },

    markAway(sessionId, userId) {
      const session = requireSession(sessionId);
      const seat = seatOf(session, userId);

      session.players[seat].onPage = false;
      syncPresence(session, seat);
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
      // Nobody is played around while they are missing, whichever of the two it is.
      if (session.players.some((player) => player.awayUntil !== null)) {
        throw new SessionError('invalid_game_state', 'The game is paused.');
      }

      // Straight through to the rules, unread. The platform cannot know what a legal action looks
      // like, and a platform that guessed would be a platform each new game had to be fitted to.
      session.game.submitAction(seat, action, at);
    },

    requestLeave(sessionId, userId) {
      const session = requireSession(sessionId);
      const seat = seatOf(session, userId);
      const partner = session.players[otherSeat(seat)];

      // Outside an active match there is nothing to protect, so asking is just leaving.
      if (session.phase !== 'active') {
        endSession(session, session.phase === 'finished' ? 'finished' : 'abandoned', 'left', userId);
        return;
      }

      // Nobody there to ask. Giving up the forfeit they were about to win is entirely their right,
      // and refusing would trap them in a match against somebody who has gone.
      if (!isPresent(partner)) {
        endSession(session, 'abandoned', 'left', userId);
        return;
      }

      if (session.leaveRequest) {
        throw new SessionError('invalid_action', 'Somebody has already asked.');
      }

      const expiresAt = now() + LEAVE_REQUEST_TTL_MS;
      session.leaveRequest = {
        byUserId: userId,
        expiresAt,
        timer: setTimeout(() => {
          if (session.leaveRequest?.byUserId !== userId) return;
          session.leaveRequest = null;
          // Silence changes nothing. Anything else would make ignoring a request the way to lose a
          // match you were winning to a message you never saw.
          broadcast(session, EVENTS.lobby.leaveResolved, { outcome: 'expired' });
        }, LEAVE_REQUEST_TTL_MS),
      };

      broadcast(session, EVENTS.lobby.leaveRequested);
    },

    respondToLeave(sessionId, userId, accept) {
      const session = requireSession(sessionId);
      seatOf(session, userId);

      const request = session.leaveRequest;
      if (!request) {
        throw new SessionError('invalid_action', 'There is nothing to answer.');
      }

      // The asker answering their own request is a withdrawal, and the only answer they may give.
      if (request.byUserId === userId) {
        if (accept) {
          // `invalid_action` rather than `not_authorized`: they are perfectly entitled to be here,
          // they just cannot agree with themselves. The client reads `not_authorized` on a session
          // frame as "this game is not yours" and closes the screen, which this is nowhere near.
          throw new SessionError('invalid_action', 'They have to agree, not you.');
        }
        dropLeaveRequest(session);
        broadcast(session, EVENTS.lobby.leaveResolved, { outcome: 'withdrawn' });
        return;
      }

      if (!accept) {
        dropLeaveRequest(session);
        broadcast(session, EVENTS.lobby.leaveResolved, { outcome: 'declined' });
        return;
      }

      // Agreed, so nobody lost: the session closes with no result and counts towards nothing (P-8).
      endSession(session, 'abandoned', 'left', request.byUserId);
    },

    leave(sessionId, userId) {
      const session = requireSession(sessionId);
      // Authorization first: knowing an id is not permission to end somebody else's game.
      const seat = seatOf(session, userId);

      // A match in progress is the one thing you cannot simply walk out of, because the alternative
      // to walking out is a forfeit — and a free exit needing nobody's agreement is the exit
      // everybody would take. `requestLeave` is the way out while they are still here.
      if (session.phase === 'active' && isPresent(session.players[otherSeat(seat)])) {
        throw new SessionError('invalid_action', 'Ask them if you can stop first.');
      }

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

    sendGameEvent(sessionId, userId, event) {
      const session = requireSession(sessionId);
      seatOf(session, userId);

      // Same shape as `react`: relayed to both and forgotten, never written down. The sender already
      // holds its own value locally (it is the thing it just sent), so only the partner's copy of
      // this screen has any use for the echo back — but sending to both keeps this identical to
      // every other ephemeral relay rather than a special case, and a receiver that does not want
      // its own signal back is free to drop it by `fromUserId`.
      for (const target of session.players) {
        emitter.sendToUser(target.userId, EVENTS.game.event, {
          event,
          // Stamped by the server. A client cannot signal as its partner.
          fromUserId: userId,
        });
      }
    },

    closeTournamentSession(sessionId) {
      const session = byId.get(sessionId);
      // Already gone: both of them left the results screen while the engine was opening the next
      // game. Nothing to close, and the series carries on regardless.
      if (!session) return;

      // The engine only ever calls this for a session whose result it has already recorded, so the
      // latch is set and this teardown says nothing to the tournament about an abandonment.
      endSession(session, 'finished', 'left');
    },

    handlePresence(userId, online) {
      const sessionId = byUser.get(userId);
      if (!sessionId) return;

      const session = byId.get(sessionId);
      if (!session) return;

      const seat = session.players.findIndex((candidate) => candidate.userId === userId);
      if (seat === -1) return;

      // Their last socket closed, so whatever their client last said about being on the page is now
      // an assertion nobody is behind. Coming back online is not coming back to the game — the
      // client re-joins if it really is still here, and that is the only thing that puts them at the
      // table again. Presence itself is read from the socket registry, never from this flag.
      if (!online) session.players[seat as PlayerIndex].onPage = false;

      syncPresence(session, seat as PlayerIndex);
    },

    closeAll() {
      for (const session of [...byId.values()]) {
        endSession(session, 'abandoned', 'server_stopped');
      }
    },
  };
}
