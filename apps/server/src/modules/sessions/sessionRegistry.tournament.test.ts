import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ARM_MAX_MS, ARM_MIN_MS, BREATHER_MS, type ReactionSpeedView } from '@rasmalai/games';
import {
  COUNTDOWN_MS,
  EVENTS,
  MOVE_WINDOW_MS,
  RECONNECT_WINDOW_MS,
  type SessionView,
  type TournamentView,
} from '@rasmalai/shared';
import type { MatchStartedInput } from '../statistics/matchRecorder';
import {
  createSessionRegistry,
  type SessionRegistry,
  type TournamentHooks,
  type TournamentMatchEnded,
} from './sessionRegistry';

/**
 * The seam between a live session and a series.
 *
 * The registry itself knows nothing about tournaments beyond three callbacks, and this is what
 * proves it holds up its end of them: that a game's ending is reported exactly once and with the
 * seats already turned back into people, that a results screen in a tournament does not rematch
 * (D-2), and that walking away from one is reported as its own thing rather than as a result.
 *
 * Played against the real Reaction Speed rules, like the rest of the registry's tests — a fake game
 * would prove the callbacks fire, not that they fire at the right moments of a real match.
 */

const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COUPLE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TOURNAMENT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const ARM_MS = ARM_MIN_MS + 0.5 * (ARM_MAX_MS - ARM_MIN_MS);

interface Sent {
  userId: string;
  type: string;
  payload: unknown;
}

let sent: Sent[];
let online: Set<string>;
let sessions: SessionRegistry;
let ends: TournamentMatchEnded[];
let nextRequests: { tournamentId: string; sessionId: string }[];
let closes: { tournamentId: string; sessionId: string }[];
let started: MatchStartedInput[];
/** What the hooks hand back for the session view, so a test can prove it is carried through. */
let standings: TournamentView | null;

const hooks: TournamentHooks = {
  viewFor: () => standings,
  matchEnded: (input) => ends.push(input),
  nextGameRequested: (tournamentId, sessionId) => nextRequests.push({ tournamentId, sessionId }),
  sessionClosed: (tournamentId, sessionId) => closes.push({ tournamentId, sessionId }),
};

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  ends = [];
  nextRequests = [];
  closes = [];
  started = [];
  standings = null;
  online = new Set([ALICE, BOB]);

  sessions = createSessionRegistry(
    {
      sendToUser(userId, type, payload) {
        sent.push({ userId, type, payload });
      },
    },
    { isOnline: (userId) => online.has(userId) },
    {
      random: () => 0.5,
      recorder: {
        matchStarted: (input) => started.push(input),
        matchEnded: () => {},
        drain: () => Promise.resolve(),
      },
      tournaments: hooks,
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** Reaction Speed is the game most of this file plays; Four in a Row is the turn-based exception. */
const GAME_NAMES = {
  'reaction-speed': 'Reaction Speed',
  'four-in-a-row': 'Four in a Row',
} as const;

/** A session for one game of a series, with both of them on its page. */
function startTournamentSession(gameSlug: keyof typeof GAME_NAMES = 'reaction-speed'): string {
  const view = sessions.create({
    coupleId: COUPLE,
    gameSlug,
    gameName: GAME_NAMES[gameSlug],
    players: [
      { userId: ALICE, nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
      { userId: BOB, nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
    ],
    mode: 'tournament',
    tournamentId: TOURNAMENT,
  });
  sessions.join(view.id, ALICE);
  sessions.join(view.id, BOB);
  sent = [];
  return view.id;
}

function startPlaying(gameSlug: keyof typeof GAME_NAMES = 'reaction-speed'): string {
  const id = startTournamentSession(gameSlug);
  sessions.setReady(id, ALICE, true);
  sessions.setReady(id, BOB, true);
  vi.advanceTimersByTime(COUNTDOWN_MS);
  sent = [];
  return id;
}

const gameView = (id: string, userId: string) =>
  sessions.viewFor(id, userId).game!.state as ReactionSpeedView;

function tap(id: string, userId: string, round: number): void {
  sessions.submitAction(
    id,
    userId,
    { type: 'tap', round },
    { receivedAt: Date.now(), compensationMs: 0 },
  );
}

function playRound(id: string, aliceMs: number, bobMs: number): void {
  const round = gameView(id, ALICE).roundNumber;
  vi.advanceTimersByTime(ARM_MS);

  const liveAt = Date.now();
  const order: [string, number][] = [
    [ALICE, aliceMs],
    [BOB, bobMs],
  ];
  order.sort((left, right) => left[1] - right[1]);

  for (const [userId, offset] of order) {
    vi.advanceTimersByTime(liveAt + offset - Date.now());
    tap(id, userId, round);
  }

  vi.advanceTimersByTime(BREATHER_MS);
}

/** Alice takes three rounds, Bob two. */
function playFullMatch(id: string): void {
  for (const [alice, bob] of [
    [200, 300],
    [200, 300],
    [200, 300],
    [400, 300],
    [400, 300],
  ] as const) {
    playRound(id, alice, bob);
  }
}

describe('a tournament game that is played out', () => {
  it('reports the ending once, with the winner as a person rather than a seat', () => {
    const id = startPlaying();
    playFullMatch(id);

    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({
      tournamentId: TOURNAMENT,
      sessionId: id,
      coupleId: COUPLE,
      gameSlug: 'reaction-speed',
      played: true,
      winnerUserId: ALICE,
      byLeave: false,
    });
  });

  it('does not report it a second time when the session is later torn down', () => {
    const id = startPlaying();
    playFullMatch(id);
    sessions.closeTournamentSession(id);

    // Once, still. Without the latch every completed game would be reported again as an
    // abandonment and restarted on top of the result it had already scored.
    expect(ends).toHaveLength(1);
    expect(closes).toEqual([{ tournamentId: TOURNAMENT, sessionId: id }]);
  });

  it('tells the recorder which series the match belonged to', () => {
    startPlaying();

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ mode: 'tournament', tournamentId: TOURNAMENT });
  });
});

describe('no rematch inside a series (D-2)', () => {
  it('asks the engine for the next game instead of counting down again', () => {
    const id = startPlaying();
    playFullMatch(id);
    sent = [];

    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);

    expect(nextRequests).toEqual([{ tournamentId: TOURNAMENT, sessionId: id }]);
    // The session stays on its results screen: only the engine can open the next game, because only
    // the engine knows what it is.
    expect(sessions.viewFor(id, ALICE).phase).toBe('finished');
    expect(sent.some((event) => event.type === EVENTS.lobby.starting)).toBe(false);
  });

  it('still counts down normally in the lobby, where readiness means the game itself', () => {
    const id = startTournamentSession();

    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);

    expect(nextRequests).toHaveLength(0);
    expect(sessions.viewFor(id, ALICE).phase).toBe('countdown');
  });

  it('leaves an individual session free to rematch exactly as before', () => {
    const [x, y] = ['ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111'];
    online.add(x!).add(y!);

    const view = sessions.create({
      coupleId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      gameSlug: 'reaction-speed',
      gameName: 'Reaction Speed',
      players: [
        { userId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', nickname: 'X', avatarKey: 'fox', gender: 'female' },
        { userId: '11111111-1111-1111-1111-111111111111', nickname: 'Y', avatarKey: 'owl', gender: 'male' },
      ],
    });
    sessions.join(view.id, x!);
    sessions.join(view.id, y!);
    sessions.setReady(view.id, x!, true);
    sessions.setReady(view.id, y!, true);

    expect(sessions.viewFor(view.id, x!).phase).toBe('countdown');
    expect(nextRequests).toHaveLength(0);
    expect(ends).toHaveLength(0);
  });
});

describe('a tournament game that never happened', () => {
  it('reports an agreed stop as a leave rather than a result (D-5)', () => {
    const id = startPlaying();

    sessions.requestLeave(id, ALICE);
    sessions.respondToLeave(id, BOB, true);

    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ played: false, winnerUserId: null, byLeave: true });
  });

  it('reports a reconnect window running out as unplayed, so the series can restart it', () => {
    const id = startPlaying();

    // Bob drops and never comes back. In an individual match this is a forfeit; in a series it is a
    // game that has to be played again, because one dropped connection is not points.
    online.delete(BOB);
    sessions.handlePresence(BOB, false);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS + 1);

    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ played: false, winnerUserId: null, byLeave: false });
    // Nobody was awarded anything.
    expect(sessions.viewFor.bind(sessions, id, ALICE)).toThrow();
  });

  it('reports a lobby neither of them ever loaded as unplayed too', () => {
    const view = sessions.create({
      coupleId: COUPLE,
      gameSlug: 'reaction-speed',
      gameName: 'Reaction Speed',
      players: [
        { userId: ALICE, nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
        { userId: BOB, nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
      ],
      mode: 'tournament',
      tournamentId: TOURNAMENT,
    });

    vi.advanceTimersByTime(RECONNECT_WINDOW_MS + 1);

    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ sessionId: view.id, played: false });
    expect(closes).toHaveLength(1);
  });
});

describe('a present player who stalls, even in a tournament', () => {
  it('forfeits a tournament game when a present player just stops moving', () => {
    const id = startPlaying('four-in-a-row');

    const stalling = sessions.viewFor(id, ALICE).turnUserId!;
    const waiting = stalling === ALICE ? BOB : ALICE;

    // Nobody disconnects. The player on the move simply never moves.
    vi.advanceTimersByTime(MOVE_WINDOW_MS + 1);

    expect(sessions.viewFor(id, waiting).result).toMatchObject({ outcome: 'won', byForfeit: true });
    // A restart would have reported the game as unplayed to the engine.
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ played: true, winnerUserId: waiting, byForfeit: true });
  });

  it('still restarts a tournament game when somebody actually drops off', () => {
    const id = startPlaying('four-in-a-row');

    online.delete(BOB);
    sessions.handlePresence(BOB, false);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS + 1);

    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ played: false });
    // A restart tears the session down rather than leaving a forfeited result on screen.
    expect(sessions.viewFor.bind(sessions, id, ALICE)).toThrow();
  });
});

describe('the series on the session view', () => {
  it('carries the standings the engine resolved for the reader', () => {
    standings = {
      id: TOURNAMENT,
      name: 'Friday night',
      status: 'active',
      direction: 'outgoing',
      games: [],
      currentPosition: 2,
      yourTotalPoints: 3,
      partnerTotalPoints: 1,
      winner: null,
      pausedUntil: null,
      expiresAt: null,
    };

    const id = startTournamentSession();
    const view: SessionView = sessions.viewFor(id, ALICE);

    expect(view.tournament).toMatchObject({ name: 'Friday night', yourTotalPoints: 3 });
  });

  it('is null for an individual game, whatever the engine would have said', () => {
    standings = {
      id: TOURNAMENT,
      name: 'Friday night',
      status: 'active',
      direction: 'outgoing',
      games: [],
      currentPosition: 1,
      yourTotalPoints: 0,
      partnerTotalPoints: 0,
      winner: null,
      pausedUntil: null,
      expiresAt: null,
    };

    const view = sessions.create({
      coupleId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      gameSlug: 'reaction-speed',
      gameName: 'Reaction Speed',
      players: [
        { userId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', nickname: 'X', avatarKey: 'fox', gender: 'female' },
        { userId: '11111111-1111-1111-1111-111111111111', nickname: 'Y', avatarKey: 'owl', gender: 'male' },
      ],
    });

    expect(view.tournament).toBeNull();
  });
});
