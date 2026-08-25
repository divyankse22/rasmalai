import type { SessionPlayer, SessionView } from '@rasmalai/shared';

/**
 * A valid `SessionPlayer`, overridable field by field.
 *
 * Defaults to somebody present and unready, which is the ordinary state at the top of a lobby and
 * the one most tests want to start from.
 */
export function player(over: Partial<SessionPlayer> = {}): SessionPlayer {
  return {
    userId: 'you',
    nickname: 'Divs',
    avatarKey: 'fox',
    gender: 'female',
    online: true,
    present: true,
    awayUntil: null,
    ready: false,
    ...over,
  };
}

/** A valid `SessionView` in the lobby, overridable field by field. */
export function sessionView(over: Partial<SessionView> = {}): SessionView {
  return {
    id: 'session-1',
    gameSlug: 'memory',
    gameName: 'Memory',
    phase: 'lobby',
    you: player({ userId: 'you', nickname: 'Divs', gender: 'female' }),
    partner: player({ userId: 'them', nickname: 'Sam', gender: 'male', avatarKey: 'frog' }),
    game: null,
    result: null,
    startsAt: null,
    turnUserId: null,
    turnDeadline: null,
    leaveRequest: null,
    tournament: null,
    ...over,
  };
}
