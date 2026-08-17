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
     * Client → server: "I have navigated away from the game."
     *
     * The socket deliberately outlives the page (P-7), so routing from `/play` to `/dashboard` is
     * invisible to the socket layer — and yet it is exactly as much of a walkout as closing the tab.
     * This is the frame that makes the two the same event. Presence in a *session* is therefore
     * "has a socket **and** is on the game's page", which is a stricter thing than being online.
     */
    away: 'lobby.away',
    /**
     * Client → server: "can we stop here?" — mid-match only.
     *
     * Leaving an active match needs the other person's agreement, because the alternative to a free
     * exit is a forfeit, and a free exit nobody has to agree to is the one everybody would take.
     */
    leaveRequest: 'lobby.leave.request',
    /** Client → server: answering one. The asker sends this too, to withdraw. */
    leaveRespond: 'lobby.leave.respond',
    /** Server → both: somebody has asked to stop, and until when. */
    leaveRequested: 'lobby.leave.requested',
    /** Server → both: how the asking ended, when it ended in the match carrying on. */
    leaveResolved: 'lobby.leave.resolved',
    /**
     * Client → server: "I am done, close this for both of us." Not in docs/04's list.
     *
     * Only outside an active match: in the lobby, during a countdown, or on a results screen there
     * is nothing at stake, so leaving needs nobody's permission. Inside one, `leaveRequest` is the
     * way out.
     */
    leave: 'lobby.leave',
    /** The session ended without finishing — a player left, or one of them forfeited. */
    ended: 'lobby.ended',
  },
  presence: {
    /**
     * Inside a session: somebody came or went. Carries the whole session view, like every other
     * session frame.
     */
    playerConnected: 'player.connected',
    playerDisconnected: 'player.disconnected',
    playerReconnected: 'player.reconnected',
    reconnectWindowStarted: 'session.reconnect_window_started',
    reconnectWindowExpired: 'session.reconnect_window_expired',
    /**
     * Outside a session: your partner opened their first socket, or closed their last one.
     *
     * Deliberately *not* the `player.*` names above. These two are couple-scoped and carry
     * `PresencePayload`, not a session — they reach somebody standing on their dashboard with no
     * game running at all. Sharing a name with the session frames meant every listener had to guess
     * which kind it was holding by looking for a field, and every one of them guessed by dropping
     * the frame.
     */
    partnerOnline: 'partner.online',
    partnerOffline: 'partner.offline',
    /**
     * Server → client, unprompted, right after `connection.authenticated` — on the first connection
     * and again on every reconnect. Carries `PartnerPresence`: the whole answer, not just a
     * transition, because a stream of `partner.online`/`partner.offline` frames cannot tell a socket
     * that has just opened where things already stand. This is what lets presence be push-only —
     * there is no REST fallback to seed or backstop it with.
     */
    partnerSnapshot: 'partner.snapshot',
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
    /**
     * Server → both: the next game of a tournament is open, and this is its session id.
     *
     * Not in docs/04's list, and needed because a tournament game is not a rematch (D-2). A rematch
     * replays inside the session it just finished in; a tournament advances to a *different* game,
     * which is a different session — and nothing else in the protocol moves two people to a session
     * they never had to accept an invitation to.
     */
    tournamentNextGame: 'tournament.next_game',
  },
  reaction: {
    sent: 'reaction.sent',
  },
  error: 'error',
} as const;

/** The five reactions from `docs/01_PRODUCT_SPEC.md`. Ephemeral, never persisted. */
export const REACTIONS = ['😂', '❤️', '😭', '😡', '👀'] as const;

export type Reaction = (typeof REACTIONS)[number];
