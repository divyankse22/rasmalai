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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ProtocolError {
  code: ErrorCode;
  message: string;
}

/** Safe fallback for anything unexpected, so an internal failure never becomes a leak. */
export const INTERNAL_ERROR: ProtocolError = {
  code: 'internal_error',
  message: 'Something went wrong on our side.',
};
