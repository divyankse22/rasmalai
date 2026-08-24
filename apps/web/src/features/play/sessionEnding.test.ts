import { describe, expect, it } from 'vitest';
import type {
  SessionEndReason,
  SessionEndedPayload,
  SessionPhase,
  SessionPlayer,
  SessionView,
  TournamentView,
} from '@rasmalai/shared';
import { endingMessage, returnPathFor } from './sessionEnding';

const YOU = 'you-id';
const THEM = 'them-id';

function player(userId: string, nickname: string, ready: boolean): SessionPlayer {
  return {
    userId,
    nickname,
    avatarKey: 'fox',
    gender: 'female',
    online: true,
    present: true,
    awayUntil: null,
    ready,
  };
}

function tournament(): TournamentView {
  return {
    id: 'tournament-id',
    name: 'Summer Cup',
    status: 'paused',
    direction: 'outgoing',
    games: [],
    currentPosition: 1,
    yourTotalPoints: 0,
    partnerTotalPoints: 0,
    winner: null,
    pausedUntil: null,
    expiresAt: null,
  };
}

function ended(
  reason: SessionEndReason,
  options: {
    phase?: SessionPhase;
    byUserId?: string;
    youReady?: boolean;
    themReady?: boolean;
    inSeries?: boolean;
  } = {},
): SessionEndedPayload {
  const session: SessionView = {
    id: 'session-id',
    gameSlug: 'memory',
    gameName: 'Memory',
    phase: options.phase ?? 'abandoned',
    you: player(YOU, 'Divya', options.youReady ?? false),
    partner: player(THEM, 'Aarav', options.themReady ?? false),
    game: null,
    result: null,
    startsAt: null,
    turnUserId: null,
    turnDeadline: null,
    leaveRequest: null,
    tournament: options.inSeries ? tournament() : null,
  };

  return {
    session,
    reason,
    ...(options.byUserId === undefined ? {} : { byUserId: options.byUserId }),
  };
}

describe('endingMessage', () => {
  it('names the partner who walked out of a running game', () => {
    expect(endingMessage(ended('left', { byUserId: THEM }))).toBe('Aarav left the game.');
  });

  it('does not accuse you of being left when you are the one who left', () => {
    expect(endingMessage(ended('left', { byUserId: YOU }))).toBe('You left the game.');
  });

  it('falls back to "They" when the payload carries no session', () => {
    const payload = { ...ended('left', { byUserId: THEM }), session: undefined } as unknown;
    expect(endingMessage(payload as SessionEndedPayload)).toBe('They left the game.');
  });

  // Fix 3: a rematch has no protocol of its own — declining one is leaving a `finished` session
  // that the other player had already readied on. Both flags survive into the frame, so the two
  // sides can be told apart without a new event.
  it('reads a leave from the results screen as a declined rematch, for the one who asked', () => {
    expect(
      endingMessage(ended('left', { phase: 'finished', byUserId: THEM, youReady: true })),
    ).toBe('Aarav would rather not play again.');
  });

  it('reads the same leave as a decline for the one who said no', () => {
    expect(
      endingMessage(ended('left', { phase: 'finished', byUserId: YOU, themReady: true })),
    ).toBe('No rematch — heading back.');
  });

  it('is still an ordinary leave when nobody had asked for another go', () => {
    expect(endingMessage(ended('left', { phase: 'finished', byUserId: THEM }))).toBe(
      'Aarav left the game.',
    );
  });

  it('does not call it a decline when the leaver is the one who wanted the rematch', () => {
    expect(
      endingMessage(ended('left', { phase: 'finished', byUserId: THEM, themReady: true })),
    ).toBe('Aarav left the game.');
  });

  // D-2: each game of a series is played once, so both of them being ready on a results screen
  // means "on to the next one" and never "again". Nobody can decline what was never offered.
  it('never calls a tournament pause a declined rematch', () => {
    expect(
      endingMessage(
        ended('left', { phase: 'finished', byUserId: YOU, themReady: true, inSeries: true }),
      ),
    ).toBe('You left the game.');
    expect(
      endingMessage(
        ended('left', { phase: 'finished', byUserId: THEM, youReady: true, inSeries: true }),
      ),
    ).toBe('Aarav left the game.');
  });

  it('says who did not come back on a forfeit rather than blaming both of them', () => {
    expect(endingMessage(ended('forfeited', { byUserId: THEM }))).toBe(
      'Aarav did not make it back in time.',
    );
    expect(endingMessage(ended('forfeited', { byUserId: YOU }))).toBe(
      'You did not make it back in time.',
    );
  });

  it('says who backed off on a give-up, never that they did not come back', () => {
    expect(endingMessage(ended('gave_up', { byUserId: THEM }))).toBe('Aarav backed off.');
    expect(endingMessage(ended('gave_up', { byUserId: YOU }))).toBe('You backed off.');
  });

  it('blames nobody when neither of them came back', () => {
    expect(endingMessage(ended('abandoned'))).toBe(
      'Neither of you made it back in time, so this one goes to nobody.',
    );
  });

  it('explains a restart without making it anybody fault', () => {
    expect(endingMessage(ended('server_stopped'))).toBe(
      'Rasmalai restarted, so the game stopped. Nothing was lost but this round.',
    );
  });
});

describe('returnPathFor', () => {
  it('sends an individual game back to the dashboard', () => {
    expect(returnPathFor(null)).toBe('/dashboard');
    expect(returnPathFor(undefined)).toBe('/dashboard');
  });

  it('sends a tournament game back to the tournament card', () => {
    expect(returnPathFor(tournament())).toBe('/dashboard#tournament');
  });

  it('sends a finished series to its own page rather than the tournament card', () => {
    expect(returnPathFor({ ...tournament(), status: 'completed' })).toBe('/tournament/tournament-id');
  });
});
