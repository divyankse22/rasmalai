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
  ready: boolean;
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
   * Epoch ms when the absent player's reconnect window closes, or null when nobody is missing.
   * `docs/04` fixes the window at 120 seconds.
   */
  reconnectDeadline: number | null;
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
  /** A reconnect window ran out. Counts towards nothing (P-8). */
  | 'abandoned'
  /** Somebody chose to leave. */
  | 'left'
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

/** `player.connected` / `player.disconnected` / `player.reconnected`. */
export interface PresencePayload {
  userId: string;
  online: boolean;
}

/** `reaction.sent`, in both directions. Ephemeral, never stored (`docs/04` section 9). */
export interface ReactionPayload {
  reaction: Reaction;
  /** Filled in by the server on the way out, so nobody can react as their partner. */
  fromUserId?: string;
}

/** Client → server: `lobby.player.ready` / `lobby.player.unready` / `lobby.leave`. */
export interface LobbyReadyPayload {
  sessionId: string;
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

/** How long a player has to come back before the session gives up on them. */
export const RECONNECT_WINDOW_MS = 120_000;

/** The pause between both players being ready and the game actually starting. */
export const COUNTDOWN_MS = 3_000;

/** Invitations live five minutes (`docs/01` section 10). */
export const INVITATION_TTL_MS = 5 * 60_000;
