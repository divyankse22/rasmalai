import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS, TOURNAMENT_MAX_GAMES, type TournamentView } from '@rasmalai/shared';
import {
  createSessionRegistry,
  type SessionRegistry,
} from '../../modules/sessions/sessionRegistry';
import { TournamentError } from '../../modules/tournaments/tournamentRepository';
import { createApp } from '../app';
import {
  OTHER_USER_ID,
  TEST_TOURNAMENT_ID,
  TEST_USER_ID,
  createInMemoryUsersRepository,
  createRecordingNotifier,
  createStubDashboardRepository,
  createStubInvitationsRepository,
  createStubPairingRepository,
  createStubTournamentEngine,
  createStubTournamentRepository,
  createTestPresence,
  stubVerifier,
  testTournament,
} from '../testing';

/**
 * The tournament routes: who may request a series, who may answer one, what they may start, and
 * who is told.
 *
 * The scoring and the sequencing are somebody else's job — the repository's SQL and the engine's
 * queue, both covered where they live. What is only true here is the gate: paired, nothing else
 * running, a partner who is actually online, a name, and between three and seven games that exist —
 * plus, now, who may answer a request and what each answer does.
 */

let server: Server;
let baseUrl: string;
let tournaments: ReturnType<typeof createStubTournamentRepository>;
let engine: ReturnType<typeof createStubTournamentEngine>;
let realtime: ReturnType<typeof createRecordingNotifier>;
let dashboard: ReturnType<typeof createStubDashboardRepository>;
let sessions: SessionRegistry;
let users: ReturnType<typeof createInMemoryUsersRepository>;
let online: Set<string>;

interface ApiError {
  error: { code: string; reason?: string; message: string };
}

const PROFILE = {
  nickname: 'Div',
  birthYear: 1996,
  avatarKey: 'fox',
  gender: 'female',
  partnerLabelNickname: 'Anshu',
  firstMetDate: '2021-03-14',
  locationType: 'different_city',
} as const;

const THREE_GAMES = ['reaction-speed', 'four-in-a-row', 'basketball'];

function request(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  return fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });
}

const create = (body: unknown = { name: 'Friday night', gameSlugs: THREE_GAMES }, token = 'valid') =>
  request('/api/tournaments', { method: 'POST', token, body: JSON.stringify(body) });

/** Answering a request. The creator is always TEST_USER_ID here, so the default answerer is not. */
const respond = (accept: boolean, id = TEST_TOURNAMENT_ID, token = 'valid-other') =>
  request(`/api/tournaments/${id}/respond`, {
    method: 'POST',
    token,
    body: JSON.stringify({ accept }),
  });

const cancelRequest = (id = TEST_TOURNAMENT_ID, token = 'valid') =>
  request(`/api/tournaments/${id}/cancel`, { method: 'POST', token });

beforeEach(async () => {
  tournaments = createStubTournamentRepository();
  realtime = createRecordingNotifier();
  dashboard = createStubDashboardRepository();
  users = createInMemoryUsersRepository();
  online = new Set([TEST_USER_ID, OTHER_USER_ID]);

  const presence = createTestPresence((userId) => online.has(userId));
  sessions = createSessionRegistry(realtime, presence);
  engine = createStubTournamentEngine(sessions);

  await users.create(TEST_USER_ID, { ...PROFILE }, 'AAAA1111');
  await users.create(
    OTHER_USER_ID,
    { ...PROFILE, nickname: 'Ansh', gender: 'male', avatarKey: 'penguin' },
    'BBBB2222',
  );

  server = createApp({
    appOrigin: 'http://localhost:3000',
    verifier: stubVerifier,
    users,
    pairing: createStubPairingRepository(),
    dashboard,
    invitations: createStubInvitationsRepository(),
    sessions,
    tournaments,
    tournamentEngine: engine,
    realtime,
    presence,
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('requesting a tournament', () => {
  it('creates a pending request and tells both of them, opening nothing yet', async () => {
    const response = await create();

    expect(response.status).toBe(201);
    const body = (await response.json()) as { tournament: TournamentView };
    expect(body.tournament.status).toBe('pending');
    expect(tournaments.created).toEqual([{ name: 'Friday night', gameSlugs: THREE_GAMES }]);

    // Both, so a second device belonging to either of them stays in step — same reasoning as
    // `invitation.created`. Nothing moves anybody anywhere: that only happens on an accept.
    const told = realtime.recipientsOf(EVENTS.tournamentRequest.created);
    expect(new Set(told)).toEqual(new Set([TEST_USER_ID, OTHER_USER_ID]));
    expect(realtime.recipientsOf(EVENTS.results.tournamentNextGame)).toHaveLength(0);
  });

  it('hands each of them the standings from their own side', async () => {
    // The viewer sits in slot B this time, so "you" and "them" have to come back swapped.
    dashboard.scope = { coupleId: 'couple-1', viewerIsUserA: false };

    await create();

    const frame = realtime.sent.find(
      (event) =>
        event.type === EVENTS.tournamentRequest.created && event.userId === OTHER_USER_ID,
    );
    const view = (frame!.payload as { tournament: TournamentView }).tournament;
    // OTHER_USER_ID is user A here, and a fresh series is level, so this is really asserting that
    // each frame was rendered for its own reader rather than one being copied to both.
    expect(view.yourTotalPoints).toBe(0);
    expect(view.games).toHaveLength(3);
  });

  it('refuses a nameless one, because the creator names it (D-4)', async () => {
    const response = await create({ name: '   ', gameSlugs: THREE_GAMES });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiError).error.code).toBe('invalid_payload');
    expect(tournaments.created).toHaveLength(0);
  });

  it('refuses fewer than three games (D-1)', async () => {
    const response = await create({ name: 'Quick one', gameSlugs: ['reaction-speed'] });

    expect(response.status).toBe(400);
    expect(tournaments.created).toHaveLength(0);
  });

  it('refuses more than seven games (D-1)', async () => {
    const tooMany = Array.from({ length: TOURNAMENT_MAX_GAMES + 1 }, (_, i) => `game-${i}`);
    const response = await create({ name: 'A long evening', gameSlugs: tooMany });

    expect(response.status).toBe(400);
    expect(tournaments.created).toHaveLength(0);
  });

  it('passes a repeated game on to the repository, which is what actually refuses it (D-2)', async () => {
    tournaments.failWith(new TournamentError('duplicate_game', 'Each game can only appear once.'));

    const response = await create({
      name: 'Twice over',
      gameSlugs: ['reaction-speed', 'reaction-speed', 'basketball'],
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiError).error.reason).toBe('duplicate_game');
  });

  it('refuses a second series while one is already running', async () => {
    tournaments.failWith(
      new TournamentError('already_has_tournament', 'You two already have a tournament.'),
    );

    const response = await create();

    expect(response.status).toBe(409);
    expect(((await response.json()) as ApiError).error.reason).toBe('already_has_tournament');
  });

  it('refuses one while a game is already going (ADR-009)', async () => {
    // Nothing is open after a bare create — only an accept opens a session, which is what this
    // guard actually needs to have something to trip over.
    await create();
    await respond(true);

    const response = await create();

    expect(response.status).toBe(409);
    expect(((await response.json()) as ApiError).error.reason).toBe('already_in_game');
  });

  it('refuses one aimed at a partner who is not signed in', async () => {
    online.delete(OTHER_USER_ID);

    const response = await create();

    expect(response.status).toBe(409);
    expect(((await response.json()) as ApiError).error.reason).toBe('partner_offline');
    expect(tournaments.created).toHaveLength(0);
  });

  it('refuses one from somebody with no partner', async () => {
    dashboard.scope = null;

    const response = await create();

    expect(response.status).toBe(409);
    expect(((await response.json()) as ApiError).error.reason).toBe('not_paired');
  });

  it('turns away anybody who is not signed in', async () => {
    const response = await request('/api/tournaments', {
      method: 'POST',
      body: JSON.stringify({ name: 'Friday night', gameSlugs: THREE_GAMES }),
    });

    expect(response.status).toBe(401);
    expect(tournaments.created).toHaveLength(0);
  });
});

describe('answering a tournament request', () => {
  beforeEach(async () => {
    await create();
  });

  it('accepts, opens the first session, and moves both of them into it', async () => {
    const response = await respond(true);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { accepted: boolean; sessionId: string };
    expect(body.accepted).toBe(true);
    expect(body.sessionId).toEqual(expect.any(String));

    const moved = realtime.recipientsOf(EVENTS.results.tournamentNextGame);
    expect(new Set(moved)).toEqual(new Set([TEST_USER_ID, OTHER_USER_ID]));
  });

  it('declines and tells both of them, without touching the engine', async () => {
    const response = await respond(false);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: false });
    expect(engine.started).toHaveLength(0);

    const told = realtime.recipientsOf(EVENTS.results.tournamentUpdated);
    expect(new Set(told)).toEqual(new Set([TEST_USER_ID, OTHER_USER_ID]));
  });

  it('abandons the row when nothing can play it, so the couple is not locked out', async () => {
    engine.failNextStart = true;

    const response = await respond(true);

    expect(response.status).toBe(500);
    // The partial unique index would otherwise refuse this couple every future series.
    expect(tournaments.abandoned).toEqual([TEST_TOURNAMENT_ID]);
  });

  it('passes the creator answering their own request on to the repository, which is what actually refuses it', async () => {
    tournaments.failWith(new TournamentError('cannot_answer_own', 'You sent this one.'));

    const response = await respond(true, TEST_TOURNAMENT_ID, 'valid');

    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiError).error.reason).toBe('cannot_answer_own');
  });

  it('passes an already-answered request on to the repository, which is what actually refuses it', async () => {
    tournaments.failWith(
      new TournamentError('tournament_not_pending', 'That was already answered.'),
    );

    const response = await respond(true);

    expect(response.status).toBe(409);
    expect(((await response.json()) as ApiError).error.reason).toBe('tournament_not_pending');
  });

  it('is gone rather than merely refused once its five minutes are up', async () => {
    tournaments.failWith(new TournamentError('tournament_expired', 'That request ran out.'));

    const response = await respond(true);

    expect(response.status).toBe(410);
    expect(((await response.json()) as ApiError).error.reason).toBe('tournament_expired');
  });

  it('turns away anybody who is not signed in', async () => {
    const response = await request(`/api/tournaments/${TEST_TOURNAMENT_ID}/respond`, {
      method: 'POST',
      body: JSON.stringify({ accept: true }),
    });

    expect(response.status).toBe(401);
  });
});

describe('withdrawing a tournament request', () => {
  beforeEach(async () => {
    await create();
  });

  it('cancels it and tells both of them', async () => {
    const response = await cancelRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: true });
    expect(tournaments.cancelled).toEqual([TEST_TOURNAMENT_ID]);

    const told = realtime.recipientsOf(EVENTS.results.tournamentUpdated);
    expect(new Set(told)).toEqual(new Set([TEST_USER_ID, OTHER_USER_ID]));
  });

  it('refuses anybody but the creator', async () => {
    tournaments.failWith(new TournamentError('tournament_not_found', 'That tournament does not exist.'));

    const response = await cancelRequest(TEST_TOURNAMENT_ID, 'valid-other');

    expect(response.status).toBe(404);
  });
});

describe('reading the active tournament', () => {
  it('answers with null when there is none', async () => {
    const response = await request('/api/tournaments/active', { token: 'valid' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tournament: null, activeSessionId: null });
  });

  it('answers with the series and the session to rejoin', async () => {
    await create();
    await respond(true);

    const response = await request('/api/tournaments/active', { token: 'valid' });
    const body = (await response.json()) as {
      tournament: TournamentView;
      activeSessionId: string | null;
    };

    expect(body.tournament.name).toBe('Friday night');
    expect(body.tournament.currentPosition).toBe(1);
    // A reload mid-series lands back in the game rather than on the dashboard.
    expect(body.activeSessionId).toEqual(expect.any(String));
  });

  it('says nothing to somebody with no couple', async () => {
    dashboard.scope = null;

    const response = await request('/api/tournaments/active', { token: 'valid' });

    expect(await response.json()).toEqual({ tournament: null, activeSessionId: null });
  });
});

describe("reading one tournament by id", () => {
  it('answers with it, whatever its status', async () => {
    tournaments.active = testTournament({ status: 'completed', winnerUserId: TEST_USER_ID });

    const response = await request(`/api/tournaments/${TEST_TOURNAMENT_ID}`, { token: 'valid' });
    const body = (await response.json()) as { tournament: TournamentView };

    expect(response.status).toBe(200);
    expect(body.tournament.status).toBe('completed');
    expect(body.tournament.winner).toBe('you');
  });

  it('refuses one belonging to another couple, id or no id', async () => {
    tournaments.active = testTournament({ status: 'completed' });

    const response = await request('/api/tournaments/66666666-6666-6666-6666-666666666666', {
      token: 'valid',
    });

    expect(response.status).toBe(404);
  });

  it('is not found for somebody with no couple', async () => {
    dashboard.scope = null;

    const response = await request(`/api/tournaments/${TEST_TOURNAMENT_ID}`, { token: 'valid' });

    expect(response.status).toBe(404);
  });
});

describe('resuming a paused tournament', () => {
  beforeEach(() => {
    tournaments.active = testTournament({ status: 'paused' });
  });

  it('resumes it and opens the game it was up to', async () => {
    const response = await request(`/api/tournaments/${TEST_TOURNAMENT_ID}/resume`, {
      method: 'POST',
      token: 'valid',
    });

    expect(response.status).toBe(200);
    expect(engine.started).toEqual([TEST_TOURNAMENT_ID]);
    expect(new Set(realtime.recipientsOf(EVENTS.results.tournamentNextGame))).toEqual(
      new Set([TEST_USER_ID, OTHER_USER_ID]),
    );
  });

  it('is gone rather than merely refused once its 48 hours have passed (D-5)', async () => {
    tournaments.failWith(new TournamentError('tournament_expired', 'That tournament has expired.'));

    const response = await request(`/api/tournaments/${TEST_TOURNAMENT_ID}/resume`, {
      method: 'POST',
      token: 'valid',
    });

    expect(response.status).toBe(410);
    expect(((await response.json()) as ApiError).error.reason).toBe('tournament_expired');
  });

  it('refuses one belonging to another couple, id or no id', async () => {
    const response = await request('/api/tournaments/66666666-6666-6666-6666-666666666666/resume', {
      method: 'POST',
      token: 'valid',
    });

    expect(response.status).toBe(404);
    expect(engine.started).toHaveLength(0);
  });
});

describe('abandoning a tournament', () => {
  beforeEach(() => {
    tournaments.active = testTournament({ status: 'paused' });
  });

  it('ends it, stops the engine running it, and tells both of them', async () => {
    const response = await request(`/api/tournaments/${TEST_TOURNAMENT_ID}/abandon`, {
      method: 'POST',
      token: 'valid',
    });

    expect(response.status).toBe(200);
    expect(tournaments.abandoned).toEqual([TEST_TOURNAMENT_ID]);
    expect(engine.forgotten).toEqual([TEST_TOURNAMENT_ID]);

    const told = realtime.recipientsOf(EVENTS.results.tournamentUpdated);
    expect(new Set(told)).toEqual(new Set([TEST_USER_ID, OTHER_USER_ID]));
  });

  it('refuses one belonging to another couple', async () => {
    const response = await request(
      '/api/tournaments/66666666-6666-6666-6666-666666666666/abandon',
      { method: 'POST', token: 'valid' },
    );

    expect(response.status).toBe(404);
    expect(tournaments.abandoned).toHaveLength(0);
  });
});
