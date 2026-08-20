/**
 * The invitation and session contract.
 *
 * Every payload that crosses the socket in slice 6 is typed here, for the same reason the dashboard
 * DTO lives in this package: a realtime protocol that drifts between the two ends fails at runtime,
 * in front of a person mid-game, rather than at the compiler.
 *
 * Everything is already resolved to the reader's point of view — `you` and `them`, never slot a and
 * slot b — so no consumer has to know which side of the couple it is rendering for.
 */

import type { Reaction } from '../protocol/events';

export type InvitationStatus =
  'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'invalidated';

/** Which way an invitation is pointing, from the point of view of whoever is reading it. */
export type InvitationDirection = 'incoming' | 'outgoing';

export interface InvitationView {
  id: string;
  gameSlug: string;
  gameName: string;
  status: InvitationStatus;
  direction: InvitationDirection;
  /** The other person — the sender if incoming, the recipient if outgoing. */
  otherUser: { id: string; nickname: string; avatarKey: string; gender: 'male' | 'female' };
  createdAt: string;
  /** ISO. The client counts down to this; the server decides what it means. */
  expiresAt: string;
}

/** What the games list and the invitation flow need to know about a couple's current state. */
export interface InvitationState {
  /** The couple's one live invitation, whichever way it points, or null. */
  active: InvitationView | null;
  /** Set when a session is already running, so a reload lands back in the game. */
  activeSessionId: string | null;
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

/**
 * Where a session is in its life.
 *
 * `countdown` is deliberately separate from `active`: the countdown is synchronized from a server
 * deadline, and a client that treats it as already-active would let someone act early.
 */
export type SessionPhase = 'lobby' | 'countdown' | 'active' | 'finished' | 'abandoned';

export interface SessionPlayer {
  userId: string;
  nickname: string;
  avatarKey: string;
  gender: 'male' | 'female';
  /** At least one socket open. Presence is per person, not per socket. */
  online: boolean;
  /**
   * Online **and** on the game's own page.
   *
   * The stricter of the two, and the one that matters here: somebody reading their dashboard is
   * still signed in, still reachable, and still not playing. This is what starts the clock.
   */
  present: boolean;
  /**
   * Epoch ms, server clock, when this player's 120 seconds run out — or null while they are here.
   *
   * Per player rather than per session, because both of them can be gone at once and each is on
   * their own clock. Whoever is back before the last one of these passes is the last person in the
   * room, and takes the match; if neither is, nobody won anything.
   */
  awayUntil: number | null;
  ready: boolean;
}

/** A pending "can we stop here?", which only exists during an active match. */
export interface LeaveRequestView {
  byUserId: string;
  /** Epoch ms, server clock. Unanswered at this point, the request simply lapses. */
  expiresAt: number;
}

/**
 * The running game's own state, as this reader is allowed to see it.
 *
 * `state` is deliberately opaque to the platform: the game module owns that shape, and the platform
 * that carries it must never grow an opinion about what is in it. The renderer for `slug` is the one
 * thing that knows how to read it, and it is handed exactly this.
 */
export interface GameSnapshot {
  slug: string;
  state: unknown;
}

/** How a finished match came out, from the reader's side. */
export interface MatchResultView {
  outcome: 'won' | 'lost' | 'drawn';
  yourScore: number;
  theirScore: number;
  /** False for cooperative, social and casual games, where nobody beats anybody (P-3). */
  competitive: boolean;
  /**
   * Won because the other player never came back, rather than on the board.
   *
   * Scored 1–0 like a walkover rather than freezing whatever the game happened to show, so nobody
   * reads "you win, 1–3". The screen leans on this to say what happened instead of a scoreline.
   */
  byForfeit: boolean;
}

// ---------------------------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------------------------

export type TournamentStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'completed'
  | 'abandoned'
  /** The receiver said no. Distinct from `abandoned`, which is a series that was running. */
  | 'declined'
  /** Nobody answered within the request's five minutes (`request_expires_at`). */
  | 'expired'
  /** The creator withdrew the request before it was answered. */
  | 'cancelled';

/** One game in the tournament series, from the reader's perspective. */
export interface TournamentGameView {
  position: number;
  gameSlug: string;
  gameName: string;
  /** P-4: only competitive games score 3/1/0. Unscored games show "—" on the board (D-6). */
  scored: boolean;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  /** Null for unscored games (D-6). */
  yourPoints: number | null;
  partnerPoints: number | null;
}

/** The whole tournament, already resolved to the reader's point of view. */
export interface TournamentView {
  id: string;
  name: string;
  status: TournamentStatus;
  /** Whether the reader sent this request or is being asked to answer it. Same idea as `InvitationView.direction`. */
  direction: 'incoming' | 'outgoing';
  games: TournamentGameView[];
  /** 1-indexed position of the game currently being played, or the next one to play. */
  currentPosition: number;
  yourTotalPoints: number;
  partnerTotalPoints: number;
  winner: 'you' | 'partner' | null;
  /** ISO. When a paused tournament must be resumed by, or null (D-5). */
  pausedUntil: string | null;
  /** ISO. When a `pending` request stops being answerable, or null once it is answered either way. */
  expiresAt: string | null;
}

export interface SessionView {
  id: string;
  gameSlug: string;
  gameName: string;
  phase: SessionPhase;
  /** The reader, then their partner. Fixed order so the UI never has to search. */
  you: SessionPlayer;
  partner: SessionPlayer;
  /**
   * The live game, or null in the lobby and on the results screen.
   *
   * Every session frame carries the whole thing rather than a patch, so a client that missed a
   * frame is never subtly out of step — and a reconnecting client is restored by the same `lobby.
   * joined` it uses on first load, with no separate resume path to get wrong.
   */
  game: GameSnapshot | null;
  /** Set while `phase` is `finished`, and cleared when a rematch starts. */
  result: MatchResultView | null;
  /**
   * Epoch ms, server clock, set while `phase` is `countdown`. Both clients render the same
   * countdown by subtracting their own clock, and nothing is decided by either of them.
   */
  startsAt: number | null;
  /**
   * Whose move the game is waiting on, or null when it is waiting on time rather than a person.
   *
   * Both of them are told, and both need it: one to know the clock is theirs, and the other to know
   * what they are waiting for. Nobody loses a match without being told it is happening.
   */
  turnUserId: string | null;
  /**
   * Epoch ms, server clock, when that move is due. Null whenever `turnUserId` is.
   *
   * Only set during an active match, and only for a game that has a seat to move at all — a
   * reaction test is waiting on a stimulus, not on a person, and has no move to be late with.
   */
  turnDeadline: number | null;
  /** A pending "can we stop here?", or null. */
  leaveRequest: LeaveRequestView | null;
  /**
   * The tournament this session belongs to, or null for individual play.
   *
   * Carries the whole series — scores, game list, current position — so the play screen can
   * render the scoreboard without a separate request.
   */
  tournament: TournamentView | null;
}

// ---------------------------------------------------------------------------------------------
// Socket payloads
// ---------------------------------------------------------------------------------------------

/** `game.invitation.created` — sent to both partners, so a second device stays in step. */
export interface InvitationCreatedPayload {
  invitation: InvitationView;
}

/** `game.invitation.accepted` — carries the session both players now navigate to. */
export interface InvitationAcceptedPayload {
  invitationId: string;
  sessionId: string;
}

/** `game.invitation.rejected` — `counterInvitation` is set when the decline proposed something else. */
export interface InvitationRejectedPayload {
  invitationId: string;
  counterInvitation: InvitationView | null;
}

/** `game.invitation.expired`, `.invalidated`, `.cancelled`. */
export interface InvitationClosedPayload {
  invitationId: string;
}

/** Every lobby, game and session event carries the whole view; there is no partial state to merge. */
export interface SessionStatePayload {
  session: SessionView;
}

/** Why a session stopped, so the screen can say something truthful about it. */
export type SessionEndReason =
  /**
   * Nobody was left to hold it open, or a window ran out with nothing at stake — an abandoned lobby,
   * a results screen both of them closed, or a match both of them walked out of. Counts towards
   * nothing (P-8).
   */
  | 'abandoned'
  /** Somebody chose to leave, with their partner's agreement where one was needed. */
  | 'left'
  /**
   * Somebody was gone for the whole 120 seconds of an active match.
   *
   * In a competitive game this ends as a **result** rather than an ending, so this reason is only
   * used for the games where there is no winner to award (P-3) — the session simply stops and says
   * who did not come back.
   */
  | 'forfeited'
  /** The backend went down; live sessions are memory-only and do not survive it. */
  | 'server_stopped';

/** `lobby.ended`. */
export interface SessionEndedPayload {
  session: SessionView;
  reason: SessionEndReason;
  /**
   * Who closed it, when `reason` is `left`. Without it both partners read the same frame and each
   * concludes the other one walked out.
   */
  byUserId?: string;
}

/**
 * `partner.online` / `partner.offline` — couple-scoped, and the only presence frame that reaches
 * somebody with no game running.
 *
 * The session's own `player.connected` / `player.disconnected` / `player.reconnected` carry
 * `SessionStatePayload` instead; they are about a seat at a table, this is about a person.
 */
export interface PresencePayload {
  userId: string;
  online: boolean;
}

/**
 * `partner.snapshot`. The one person whose presence you are allowed to ask about.
 *
 * Pushed by the server right after `connection.authenticated`, on every connect and reconnect.
 * Carries the face as well as the answer so the header (and anything else that needs it) can draw
 * itself from the socket alone, wherever in the app it happens to be mounted, with no request to
 * make.
 */
export interface PartnerPresence {
  partner: { id: string; nickname: string; avatarKey: string; gender: 'male' | 'female' } | null;
  online: boolean;
}

/** `reaction.sent`, in both directions. Ephemeral, never stored (`docs/04` section 9). */
export interface ReactionPayload {
  reaction: Reaction;
  /** Filled in by the server on the way out, so nobody can react as their partner. */
  fromUserId?: string;
}

/** Client → server: `lobby.player.ready` / `lobby.player.unready` / `lobby.leave` / `lobby.away`. */
export interface LobbyReadyPayload {
  sessionId: string;
}

/** Client → server: `lobby.leave.respond`. From the asker, `accept: false` withdraws it. */
export interface LeaveRespondPayload {
  sessionId: string;
  accept: boolean;
}

/** `lobby.leave.requested` — the session view carries the request itself. */
export interface LeaveRequestedPayload {
  session: SessionView;
}

/** `lobby.leave.resolved` — every ending except an accepted one, which ends the session instead. */
export interface LeaveResolvedPayload {
  session: SessionView;
  outcome: 'declined' | 'expired' | 'withdrawn';
}

/**
 * Client → server: `game.action.request`.
 *
 * An intent, never an outcome. `action` is shaped by the game module and validated by it before it
 * is allowed to touch anything — the platform passes it through without reading it.
 */
export interface GameActionPayload {
  sessionId: string;
  action: unknown;
}

/** Client → server: `reaction.sent`. */
export interface ReactionSendPayload {
  sessionId: string;
  reaction: Reaction;
}

/**
 * Both directions of `game.event`: a per-game ephemeral signal, opaque to the platform.
 *
 * Not a validated action — `submitAction`/`applyAction` never see it, and nothing it carries can
 * change `matches`, a score, or who won. It exists for the things a game wants its players to see
 * of each other *before* an action is committed, such as a live aim while a shot is still being
 * lined up (basketball). Relayed and forgotten, the same as a reaction (`docs/04` section 4): the
 * server stamps `fromUserId` and passes the shape through without reading it, and only the most
 * recent one sent ever matters to a receiver.
 */
export interface GameEventPayload {
  event: unknown;
  /** Filled in by the server on the way out, so nobody can signal as their partner. */
  fromUserId?: string;
}

/** Client → server: `game.event`. */
export interface GameEventSendPayload {
  sessionId: string;
  event: unknown;
}

/**
 * How long a player has to come back before the session gives up on them.
 *
 * During an active match, running this down is a forfeit: the player who stayed wins a competitive
 * game, and a non-competitive one simply stops. Outside a match there is nothing to forfeit — but
 * the window still runs, because a session both of them have walked away from has to clean itself
 * up or it blocks every future invitation (ADR-009).
 */
export const RECONNECT_WINDOW_MS = 120_000;

/**
 * How long a player has to make their move before they lose the match.
 *
 * The same 120 seconds as the reconnect window, and the same consequence, on purpose: from the
 * other side of the board there is no difference between a partner who dropped off and one who is
 * sitting there not playing, and there is no reason the two should be waited on differently.
 *
 * A separate name rather than a reuse, so that changing what a disconnect costs does not silently
 * change what thinking too long costs.
 */
export const MOVE_WINDOW_MS = 120_000;

/** How long a "can we stop here?" waits for an answer before lapsing. */
export const LEAVE_REQUEST_TTL_MS = 30_000;

/**
 * How long somebody has to be missing before their partner is told about it.
 *
 * A refresh drops the socket for a second or two, and announcing that as "they left the game" twice
 * a match would make the honest signal worthless. The **clock still starts the moment they vanish**
 * — this delays only the telling, so nobody gains time by reloading.
 */
export const AWAY_GRACE_MS = 3_000;

/** The pause between both players being ready and the game actually starting. */
export const COUNTDOWN_MS = 3_000;

/** Invitations live five minutes (`docs/01` section 10). */
export const INVITATION_TTL_MS = 5 * 60_000;

/** A paused tournament expires after 48 hours (D-5). */
export const TOURNAMENT_PAUSE_TTL_MS = 2 * 24 * 60 * 60_000;

/** A tournament request goes unanswered for at most five minutes, same as a game invitation. */
export const TOURNAMENT_REQUEST_TTL_MS = 5 * 60_000;

/** 3–7 games per tournament (D-1). */
export const TOURNAMENT_MIN_GAMES = 3;
export const TOURNAMENT_MAX_GAMES = 7;

// ---------------------------------------------------------------------------------------------
// Tournament payloads
// ---------------------------------------------------------------------------------------------

/** `tournament.game.result` — sent after each game in the series. */
export interface TournamentGameResultPayload {
  tournament: TournamentView;
  /** The game that just finished. */
  finishedPosition: number;
}

/**
 * `tournament.updated` — sent on any tournament state change (pause, resume, complete, abandon, and
 * a request being declined, cancelled, or left to expire).
 */
export interface TournamentUpdatedPayload {
  tournament: TournamentView;
}

/** `tournament.request.created` — sent to both partners the moment one of them asks for a series. */
export interface TournamentRequestCreatedPayload {
  tournament: TournamentView;
}

/**
 * `tournament.next_game` — the series has moved on, and this is where the next one is.
 *
 * A tournament game is not a rematch (D-2), so the session that just finished is closed and a fresh
 * one opened rather than replayed in place. Both players get this and both navigate, exactly the
 * way `game.invitation.accepted` moves them at the start of the series — there is no second
 * invitation to accept, because they already committed to the whole run.
 */
export interface TournamentNextGamePayload {
  sessionId: string;
  tournament: TournamentView;
}
