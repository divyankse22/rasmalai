/**
 * Event names, transcribed from `docs/04_REALTIME_AND_WEBSOCKET_PROTOCOL.md`.
 *
 * Payload schemas are defined by the slice that introduces the event; the names live here so the
 * web app and the backend can never drift apart on a string literal.
 */
export const EVENTS = {
  connection: {
    authenticate: 'connection.authenticate',
    reauthenticate: 'connection.reauthenticate',
    authenticated: 'connection.authenticated',
    ping: 'connection.ping',
    pong: 'connection.pong',
  },
  pairing: {
    requestCreated: 'pairing.request.created',
    requestAccepted: 'pairing.request.accepted',
    requestRejected: 'pairing.request.rejected',
    requestCancelled: 'pairing.request.cancelled',
  },
  invitation: {
    created: 'game.invitation.created',
    accepted: 'game.invitation.accepted',
    rejected: 'game.invitation.rejected',
    expired: 'game.invitation.expired',
    invalidated: 'game.invitation.invalidated',
    // Not in docs/04's list: withdrawing is distinct from being superseded, and the sender's own
    // screen needs to know which happened. The pairing family carries the same addition.
    cancelled: 'game.invitation.cancelled',
  },
  lobby: {
    /** Client → server: "put me in this session and tell me where it is up to." */
    join: 'lobby.join',
    joined: 'lobby.joined',
    playerReady: 'lobby.player.ready',
    playerUnready: 'lobby.player.unready',
    starting: 'lobby.starting',
    started: 'lobby.started',
    /**
     * Client → server: "I am done, close this for both of us." Not in docs/04's list, and not the
     * same thing as a disconnect — walking away on purpose should not leave your partner watching a
     * 120-second countdown for somebody who is not coming back.
     */
    leave: 'lobby.leave',
    /** The session ended without finishing — a reconnect window ran out, or a player left. */
    ended: 'lobby.ended',
  },
  presence: {
    playerConnected: 'player.connected',
    playerDisconnected: 'player.disconnected',
    playerReconnected: 'player.reconnected',
    reconnectWindowStarted: 'session.reconnect_window_started',
    reconnectWindowExpired: 'session.reconnect_window_expired',
  },
  game: {
    actionRequest: 'game.action.request',
    stateUpdated: 'game.state.updated',
    event: 'game.event',
    roundStarted: 'game.round.started',
    roundEnded: 'game.round.ended',
    finished: 'game.finished',
  },
  results: {
    matchResult: 'match.result',
    tournamentGameResult: 'tournament.game.result',
    tournamentUpdated: 'tournament.updated',
  },
  reaction: {
    sent: 'reaction.sent',
  },
  error: 'error',
} as const;

/** The five reactions from `docs/01_PRODUCT_SPEC.md`. Ephemeral, never persisted. */
export const REACTIONS = ['😂', '❤️', '😭', '😡', '👀'] as const;

export type Reaction = (typeof REACTIONS)[number];
