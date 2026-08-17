import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import type {
  SessionEmitter,
  SessionPlayerSeed,
  SessionRegistry,
  TournamentMatchEnded,
} from '../sessions/sessionRegistry';
import { createTournamentEngine, type TournamentEngine } from './tournamentEngine';
import type { GameResultInput, Tournament, TournamentRepository } from './tournamentRepository';

/**
 * The engine decides what a finished tournament game *means*, and that is the whole of what is
 * worth testing here. The scoring arithmetic is SQL and belongs to the repository; the sessions are
 * real and belong to `sessionRegistry.test.ts`. What is left — and what has no other home — is the
 * sequencing:
 *
 * - a game played moves the series on, but only once both of them ask for the next one (D-2)
 * - a game that never happened restarts, and restarts once (`docs/04` section 6)
 * - twice in a row is not an accident, and pauses the evening (`docs/13` section 6)
 * - so does agreeing to stop, and so does walking away from the results screen (D-5)
 * - a non-competitive round advances the series without touching the standings (P-4)
 *
 * Everything is faked deliberately: a repository that records calls and hands back whatever
 * tournament the test wants next, and a session registry that hands out ids. That makes each of the
 * above a two-line assertion instead of an integration test with a database in it.
 */

const USER_A = 'user-a';
const USER_B = 'user-b';
const COUPLE = 'couple-1';
const TOURNAMENT = 'tournament-1';

const PLAYERS: [SessionPlayerSeed, SessionPlayerSeed] = [
  { userId: USER_A, nickname: 'Div', avatarKey: 'fox', gender: 'female' },
  { userId: USER_B, nickname: 'Ansh', avatarKey: 'penguin', gender: 'male' },
];

/** A three-game series with `completed` games first and the rest still to come. */
function tournamentWith(options: {
  played?: number;
  status?: Tournament['status'];
  pointsA?: number;
  pointsB?: number;
  winnerUserId?: string | null;
  scored?: boolean;
}): Tournament {
  const played = options.played ?? 0;
  const slugs = ['reaction-speed', 'four-in-a-row', 'basketball'];

  return {
    id: TOURNAMENT,
    coupleId: COUPLE,
    name: 'Friday night',
    status: options.status ?? 'active',
    createdByUserId: USER_A,
    createdAt: new Date(),
    startedAt: new Date(),
    endedAt: null,
    pausedUntil: null,
    totalPointsA: options.pointsA ?? 0,
    totalPointsB: options.pointsB ?? 0,
    winnerUserId: options.winnerUserId ?? null,
    games: slugs.map((slug, index) => ({
      id: `tg-${index + 1}`,
      gameId: `catalogue-${index + 1}`,
      gameSlug: slug,
      gameName: slug,
      position: index + 1,
      matchId: null,
      scored: options.scored ?? true,
      status: index < played ? 'completed' : index === played ? 'active' : 'pending',
      pointsA: 0,
      pointsB: 0,
    })),
  };
}

interface Sent {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
}

let sent: Sent[];
let created: { gameSlug: string; tournamentId?: string }[];
let closed: string[];
let advanced: GameResultInput[];
let paused: number;
let nextRead: Tournament;
let nextAdvance: Tournament | null;
let sessionCounter: number;
let repo: TournamentRepository;
let sessions: SessionRegistry;
let engine: TournamentEngine;

const emitter: SessionEmitter = {
  sendToUser(userId, type, payload) {
    sent.push({ userId, type, payload: payload as Record<string, unknown> });
  },
};

/** Every frame of one type, so a test can assert on both players at once. */
const framesOf = (type: string) => sent.filter((frame) => frame.type === type);

beforeEach(() => {
  sent = [];
  created = [];
  closed = [];
  advanced = [];
  paused = 0;
  sessionCounter = 0;
  nextRead = tournamentWith({});
  nextAdvance = null;

  repo = {
    createTournament: () => Promise.resolve(nextRead),
    getActiveTournament: () => Promise.resolve(nextRead),
    getTournament: () => Promise.resolve(nextRead),
    advanceGame: (_id: string, input: GameResultInput) => {
      advanced.push(input);
      return Promise.resolve(nextAdvance ?? tournamentWith({ played: 1 }));
    },
    pauseTournament: () => {
      paused += 1;
      return Promise.resolve(tournamentWith({ status: 'paused' }));
    },
    resumeTournament: () => Promise.resolve(tournamentWith({})),
    abandonTournament: () => Promise.resolve(),
    abandonExpiredTournaments: () => Promise.resolve(0),
    pauseStrandedTournaments: () => Promise.resolve(0),
  };

  const stubSessions: Pick<SessionRegistry, 'create' | 'closeTournamentSession'> = {
    create(input) {
      sessionCounter += 1;
      created.push({
        gameSlug: input.gameSlug,
        ...(input.tournamentId === undefined ? {} : { tournamentId: input.tournamentId }),
      });
      return { id: `session-${sessionCounter}` } as ReturnType<SessionRegistry['create']>;
    },
    closeTournamentSession(sessionId) {
      closed.push(sessionId);
    },
  };
  sessions = stubSessions as SessionRegistry;

  engine = createTournamentEngine(repo, sessions, emitter);
});

/** Starts the series and returns the first session's id. */
function start(): string {
  return engine.start({ tournament: nextRead, userAId: USER_A, players: PLAYERS });
}

/** A finished game, as the registry reports it. */
function ended(sessionId: string, overrides: Partial<TournamentMatchEnded> = {}): void {
  engine.matchEnded({
    tournamentId: TOURNAMENT,
    sessionId,
    coupleId: COUPLE,
    gameSlug: 'reaction-speed',
    played: true,
    winnerUserId: USER_A,
    byForfeit: false,
    byLeave: false,
    ...overrides,
  });
}

describe('starting a series', () => {
  it('opens a tournament session for the game it is up to', () => {
    const sessionId = start();

    expect(sessionId).toBe('session-1');
    expect(created).toEqual([{ gameSlug: 'reaction-speed', tournamentId: TOURNAMENT }]);
  });

  it('resolves the standings to each reader, so neither sees the other side of the board', () => {
    start();
    nextAdvance = tournamentWith({ played: 1, pointsA: 3 });
    ended('session-1');

    return vi.waitFor(() => {
      const results = framesOf(EVENTS.results.tournamentGameResult);
      expect(results).toHaveLength(2);

      const forA = results.find((frame) => frame.userId === USER_A)!.payload.tournament as {
        yourTotalPoints: number;
        partnerTotalPoints: number;
      };
      const forB = results.find((frame) => frame.userId === USER_B)!.payload.tournament as {
        yourTotalPoints: number;
        partnerTotalPoints: number;
      };

      expect(forA.yourTotalPoints).toBe(3);
      expect(forA.partnerTotalPoints).toBe(0);
      // The same three points, from the other side of the couple.
      expect(forB.yourTotalPoints).toBe(0);
      expect(forB.partnerTotalPoints).toBe(3);
    });
  });
});

describe('a game that was played', () => {
  it('scores it and waits, rather than dragging them off a result they have not read', async () => {
    start();
    ended('session-1');

    await vi.waitFor(() => expect(advanced).toHaveLength(1));

    expect(advanced[0]).toMatchObject({ tournamentGameId: 'tg-1', winnerUserId: USER_A });
    // Still one session: nothing opens until both of them ask for it.
    expect(created).toHaveLength(1);
  });

  it('opens the next game once both of them ask for it, and closes the finished one first', async () => {
    start();
    nextAdvance = tournamentWith({ played: 1, pointsA: 3 });
    ended('session-1');
    await vi.waitFor(() => expect(advanced).toHaveLength(1));

    engine.nextGameRequested(TOURNAMENT, 'session-1');

    await vi.waitFor(() => expect(created).toHaveLength(2));
    // ADR-009: the couple gets one live session, so the finished one goes before the next opens.
    expect(closed).toEqual(['session-1']);
    expect(created[1]).toEqual({ gameSlug: 'four-in-a-row', tournamentId: TOURNAMENT });

    const moved = framesOf(EVENTS.results.tournamentNextGame);
    expect(moved).toHaveLength(2);
    expect(moved[0]!.payload.sessionId).toBe('session-2');
  });

  it('ends the series when the last game is done, and leaves the scoreboard up', async () => {
    start();
    nextAdvance = tournamentWith({
      played: 3,
      status: 'completed',
      pointsA: 9,
      winnerUserId: USER_A,
    });
    ended('session-1');

    await vi.waitFor(() => expect(framesOf(EVENTS.results.tournamentUpdated)).toHaveLength(2));

    // Nothing new opened, and nothing was paused — it is simply over.
    expect(created).toHaveLength(1);
    expect(paused).toBe(0);
    // The celebration is drawn from the session view, so the standings have to survive the ending.
    expect(engine.viewFor(TOURNAMENT, USER_A)).toMatchObject({
      status: 'completed',
      winner: 'you',
      yourTotalPoints: 9,
    });
    expect(engine.viewFor(TOURNAMENT, USER_B)).toMatchObject({ winner: 'partner' });
  });

  it('advances an unscored round without naming a winner (P-4)', async () => {
    nextRead = tournamentWith({ scored: false });
    start();
    ended('session-1', { winnerUserId: null });

    await vi.waitFor(() => expect(advanced).toHaveLength(1));
    expect(advanced[0]).toMatchObject({ scored: false, winnerUserId: null });
  });
});

describe('a game that never happened', () => {
  it('restarts it rather than awarding it — one dropped connection is not points', async () => {
    const sessionId = start();
    ended(sessionId, { played: false, winnerUserId: null });

    await vi.waitFor(() => expect(created).toHaveLength(2));

    // The same game again, and nothing scored.
    expect(created[1]).toEqual({ gameSlug: 'reaction-speed', tournamentId: TOURNAMENT });
    expect(advanced).toHaveLength(0);
    expect(paused).toBe(0);
  });

  it('pauses the series after the second failure in a row (docs/13 section 6)', async () => {
    start();
    ended('session-1', { played: false, winnerUserId: null });
    await vi.waitFor(() => expect(created).toHaveLength(2));

    ended('session-2', { played: false, winnerUserId: null });

    await vi.waitFor(() => expect(paused).toBe(1));
    // Not a third attempt: two in a row is a message, not an accident.
    expect(created).toHaveLength(2);
    expect(framesOf(EVENTS.results.tournamentUpdated)).toHaveLength(2);
  });

  it('forgets a paused series, so a late frame cannot restart it', async () => {
    start();
    ended('session-1', { played: false, winnerUserId: null });
    await vi.waitFor(() => expect(created).toHaveLength(2));
    ended('session-2', { played: false, winnerUserId: null });
    await vi.waitFor(() => expect(paused).toBe(1));

    ended('session-2', { played: false, winnerUserId: null });

    expect(engine.viewFor(TOURNAMENT, USER_A)).toBeNull();
    expect(engine.isRunning(COUPLE)).toBe(false);
  });

  it('starts the count again once a game is actually played', async () => {
    start();
    ended('session-1', { played: false, winnerUserId: null });
    await vi.waitFor(() => expect(created).toHaveLength(2));

    // One played in between, so the next failure is a first failure rather than a second.
    ended('session-2');
    await vi.waitFor(() => expect(advanced).toHaveLength(1));
    engine.nextGameRequested(TOURNAMENT, 'session-2');
    await vi.waitFor(() => expect(created).toHaveLength(3));

    ended('session-3', { played: false, winnerUserId: null });

    await vi.waitFor(() => expect(created).toHaveLength(4));
    expect(paused).toBe(0);
  });
});

describe('walking away (D-5)', () => {
  it('pauses the series when they agree to stop mid-match, without spending a restart', async () => {
    start();
    ended('session-1', { played: false, winnerUserId: null, byLeave: true });

    await vi.waitFor(() => expect(paused).toBe(1));
    expect(created).toHaveLength(1);
  });

  it('pauses the series when the results screen is left instead of continued', async () => {
    start();
    nextAdvance = tournamentWith({ played: 1, pointsA: 3 });
    ended('session-1');
    await vi.waitFor(() => expect(advanced).toHaveLength(1));

    // They read the result and left, rather than both readying for the next one.
    engine.sessionClosed(TOURNAMENT, 'session-1');

    await vi.waitFor(() => expect(paused).toBe(1));
  });

  it('does not pause a completed series when its results screen closes', async () => {
    start();
    nextAdvance = tournamentWith({ played: 3, status: 'completed', winnerUserId: USER_A });
    ended('session-1');
    await vi.waitFor(() => expect(advanced).toHaveLength(1));

    engine.sessionClosed(TOURNAMENT, 'session-1');

    await vi.waitFor(() => expect(engine.viewFor(TOURNAMENT, USER_A)).toBeNull());
    expect(paused).toBe(0);
  });

  it('does not read the teardown of a finished game as a walk-away when the next one is opening', async () => {
    start();
    nextAdvance = tournamentWith({ played: 1, pointsA: 3 });
    ended('session-1');
    await vi.waitFor(() => expect(advanced).toHaveLength(1));

    // Exactly the order the registry produces: the session closes *because* the engine is replacing
    // it. Reading that as "they left" would pause every series at its first handover.
    engine.nextGameRequested(TOURNAMENT, 'session-1');
    engine.sessionClosed(TOURNAMENT, 'session-1');

    await vi.waitFor(() => expect(created).toHaveLength(2));
    expect(paused).toBe(0);
  });
});

describe('frames for something else', () => {
  it('ignores a match ending for a session the series has already moved past', async () => {
    start();
    ended('session-1');
    await vi.waitFor(() => expect(advanced).toHaveLength(1));

    // A late frame from the game that was restarted before this one.
    ended('session-0');

    expect(advanced).toHaveLength(1);
  });

  it('ignores everything about a tournament it is not running', () => {
    start();

    ended('session-1', { tournamentId: 'someone-elses' });
    engine.nextGameRequested('someone-elses', 'session-1');
    engine.sessionClosed('someone-elses', 'session-1');

    expect(advanced).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(engine.viewFor('someone-elses', USER_A)).toBeNull();
  });
});
