/**
 * The refusals a live session can hand back.
 *
 * Its own file so the session registry and the match runner can both throw one without importing
 * each other. Every code here appears in `docs/04_REALTIME_AND_WEBSOCKET_PROTOCOL.md` section 11,
 * and the message is written for a person: nothing about the server ever leaks through it.
 */
export class SessionError extends Error {
  constructor(
    readonly code:
      | 'already_in_game'
      | 'session_not_found'
      | 'not_authorized'
      | 'invalid_game_state'
      | 'invalid_action'
      // Not a session refusal so much as a refusal to open one: there is nobody there to play.
      | 'partner_offline',
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}
