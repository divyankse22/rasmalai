/**
 * Structured error codes returned over both HTTP and the WebSocket.
 *
 * `docs/07_SECURITY_PRIVACY.md` and `docs/04_REALTIME_AND_WEBSOCKET_PROTOCOL.md` require that we
 * never leak server internals to the client, so an error is always one of these known codes plus a
 * short, human-safe message. Stack traces and driver errors stay in the server log.
 */
export const ERROR_CODES = [
  'not_authenticated',
  'not_authorized',
  'invalid_action',
  'invalid_game_state',
  'invitation_expired',
  'invitation_invalidated',
  'session_not_found',
  'reconnect_window_expired',
  'already_in_game',
  'pairing_required',
  'rate_limited',
  'invalid_payload',
  'internal_error',
  /** They are not signed in, so there is nobody to play against right now. */
  'partner_offline',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ProtocolError {
  code: ErrorCode;
  message: string;
  /**
   * Which session this is about, when it is about one at all.
   *
   * One socket serves the whole app, so without this a client cannot tell an error about the game
   * it is showing from an error about a game it has already left — and the second kind arrives
   * routinely, because leaving a session sends one last frame about it. Stamped by the server from
   * the frame it was answering; a client must ignore any error naming a session that is not theirs.
   */
  sessionId?: string;
}

/** Safe fallback for anything unexpected, so an internal failure never becomes a leak. */
export const INTERNAL_ERROR: ProtocolError = {
  code: 'internal_error',
  message: 'Something went wrong on our side.',
};
