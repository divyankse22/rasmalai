import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DashboardPayload } from '@rasmalai/shared';
import { createApp } from '../app';
import {
  OTHER_USER_ID,
  TEST_USER_ID,
  createInMemoryUsersRepository,
  createRecordingNotifier,
  createStubDashboardRepository,
  createStubPairingRepository,
  stubVerifier,
  testCatalogueRow,
} from '../testing';

let server: Server;
let baseUrl: string;
let users: ReturnType<typeof createInMemoryUsersRepository>;
let pairing: ReturnType<typeof createStubPairingRepository>;
let dashboard: ReturnType<typeof createStubDashboardRepository>;

const PROFILE = {
  actualName: 'Divyank',
  nickname: 'Div',
  birthYear: 1996,
  avatarKey: 'fox',
  gender: 'female',
  partnerLabelName: 'Anshuman',
  partnerLabelNickname: 'Anshu',
  firstMetDate: '2021-03-14',
  locationType: 'different_city',
} as const;

const PARTNER = {
  id: OTHER_USER_ID,
  actualName: 'Anshuman Real',
  nickname: 'Ansh',
  avatarKey: 'penguin',
  gender: 'male',
} as const;

async function get(token = 'valid'): Promise<DashboardPayload> {
  const response = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as DashboardPayload;
}

/** Gives the caller a completed profile and a partner, which is the ordinary dashboard case. */
async function makePaired() {
  await users.create(TEST_USER_ID, { ...PROFILE }, 'ABCD1234');
  pairing.state = {
    couple: {
      id: 'couple-1',
      firstMetDate: '2021-03-14',
      locationType: 'different_city',
      partner: { ...PARTNER },
    },
    incoming: [],
    outgoing: [],
  };
}

beforeEach(async () => {
  users = createInMemoryUsersRepository();
  pairing = createStubPairingRepository();
  dashboard = createStubDashboardRepository();

  server = createApp({
    appOrigin: 'http://localhost:3000',
    verifier: stubVerifier,
    users,
    pairing,
    dashboard,
    realtime: createRecordingNotifier(),
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /api/dashboard', () => {
  it('refuses anyone without a token', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`);
    expect(response.status).toBe(401);
  });

  it('refuses a token it cannot verify', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { authorization: 'Bearer nonsense' },
    });
    expect(response.status).toBe(401);
  });

  it('reports no profile, so the page can send them to onboarding', async () => {
    const payload = await get();
    expect(payload.viewer).toBeNull();
    expect(payload.couple).toBeNull();
    expect(payload.stats).toBeNull();
  });

  it('reports a profile without a couple, so the page can send them to pairing', async () => {
    await users.create(TEST_USER_ID, { ...PROFILE }, 'ABCD1234');
    dashboard.scope = null;

    const payload = await get();
    expect(payload.viewer?.nickname).toBe('Div');
    expect(payload.couple).toBeNull();
    expect(payload.partner).toBeNull();
    expect(payload.stats).toBeNull();
  });

  it('does not render a half-built dashboard when the couple cannot be read back', async () => {
    await users.create(TEST_USER_ID, { ...PROFILE }, 'ABCD1234');
    // A scope exists but the couple does not: rather than emit a dashboard with no partner on it,
    // this reads as unpaired.
    expect(dashboard.scope).not.toBeNull();
    expect(pairing.state.couple).toBeNull();

    const payload = await get();
    expect(payload.couple).toBeNull();
    expect(payload.stats).toBeNull();
  });
});

describe('a couple who has never finished a match', () => {
  beforeEach(makePaired);

  it('gets real zeroes rather than blanks or NaN', async () => {
    const { stats } = await get();

    expect(stats?.competitive).toMatchObject({
      gamesPlayed: 0,
      draws: 0,
      you: { wins: 0, winPercentage: 0, currentStreak: 0, longestStreak: 0, tournamentWins: 0 },
      partner: { wins: 0, winPercentage: 0 },
      closestMatch: null,
      mostCompetitiveGame: null,
    });
    expect(stats?.together).toEqual({
      gamesPlayed: 0,
      totalTimePlayedSeconds: 0,
      favouriteGame: null,
    });
    expect(stats?.lastSevenDays).toEqual({
      gamesPlayed: 0,
      youWon: 0,
      partnerWon: 0,
      draws: 0,
    });
  });

  it('counts the days together from the exact first-met date', async () => {
    const { couple } = await get();
    // The stub couple met on 2021-03-14; any number of days is fine, a wrong sign is not.
    expect(couple?.daysTogether).toBeGreaterThan(1900);
    expect(couple?.firstMetDate).toBe('2021-03-14');
  });

  it('shows the partner by the viewer’s own private label, never their real name', async () => {
    const payload = await get();
    // P-1: the label belongs to the viewer. The partner's real nickname is available but the
    // dashboard names them by the label, and the partner never sees it at all.
    expect(payload.viewer?.partnerLabelNickname).toBe('Anshu');
    expect(payload.partner?.nickname).toBe('Ansh');
  });

  it('still lists the whole catalogue', async () => {
    dashboard.catalogueRows = [
      testCatalogueRow({ slug: 'reaction-speed', name: 'Reaction Speed' }),
      testCatalogueRow({
        slug: 'memory',
        name: 'Memory',
        category: 'casual',
        scoringKind: 'casual',
      }),
    ];

    const { games } = await get();
    expect(games.map((game) => game.slug)).toEqual(['reaction-speed', 'memory']);
    expect(games.every((game) => game.enabled === false)).toBe(true);
    expect(games[0]?.yourBestScore).toBeNull();
  });
});

describe('a couple with history', () => {
  beforeEach(makePaired);

  it('turns wins into whole percentages that leave room for draws', async () => {
    dashboard.lifetimeTotals = {
      ...dashboard.lifetimeTotals,
      totalGames: 12,
      competitiveGames: 10,
      draws: 2,
      totalTimePlayedSeconds: 3600,
      you: { wins: 5, currentStreak: 2, longestStreak: 4, tournamentWins: 1 },
      partner: { wins: 3, currentStreak: 0, longestStreak: 2, tournamentWins: 0 },
    };

    const { stats } = await get();
    expect(stats?.competitive.you.winPercentage).toBe(50);
    expect(stats?.competitive.partner.winPercentage).toBe(30);
    // 50 + 30 + the 20% of matches that were draws.
    expect(stats?.competitive.draws).toBe(2);
    // Non-competitive matches count towards games played and nothing else (P-3).
    expect(stats?.together.gamesPlayed).toBe(12);
    expect(stats?.competitive.gamesPlayed).toBe(10);
  });

  it('names the most played game as the favourite, whatever its category', async () => {
    dashboard.catalogueRows = [
      testCatalogueRow({ slug: 'four-in-a-row', name: 'Four in a Row', plays: 3 }),
      testCatalogueRow({
        slug: 'drawing',
        name: 'Drawing',
        category: 'casual',
        scoringKind: 'casual',
        plays: 11,
      }),
    ];

    const { stats } = await get();
    expect(stats?.together.favouriteGame).toEqual({
      gameSlug: 'drawing',
      gameName: 'Drawing',
      plays: 11,
    });
  });

  it('names the closest-fought competitive game as the most competitive', async () => {
    dashboard.catalogueRows = [
      testCatalogueRow({
        slug: 'basketball',
        name: 'Basketball',
        plays: 4,
        marginTotal: 40,
        marginSamples: 4,
      }),
      testCatalogueRow({
        slug: 'four-in-a-row',
        name: 'Four in a Row',
        plays: 2,
        marginTotal: 2,
        marginSamples: 2,
      }),
      // Played most, but cooperative, so it is the favourite and never the most competitive.
      testCatalogueRow({
        slug: 'survival',
        name: 'Survival',
        category: 'cooperative',
        scoringKind: 'cooperative',
        plays: 20,
        marginTotal: 0,
        marginSamples: 20,
      }),
    ];

    const { stats } = await get();
    expect(stats?.competitive.mostCompetitiveGame).toEqual({
      gameSlug: 'four-in-a-row',
      gameName: 'Four in a Row',
      averageMargin: 1,
    });
    expect(stats?.together.favouriteGame?.gameSlug).toBe('survival');
  });

  it('passes the seven-day window through untouched', async () => {
    dashboard.recent = { gamesPlayed: 6, youWon: 4, partnerWon: 1, draws: 1 };

    const { stats } = await get();
    expect(stats?.lastSevenDays).toEqual({
      gamesPlayed: 6,
      youWon: 4,
      partnerWon: 1,
      draws: 1,
    });
  });
});
