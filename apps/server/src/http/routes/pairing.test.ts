import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS } from '@rasmalai/shared';
import { PairingError } from '../../modules/pairing/pairingRepository';
import { createApp } from '../app';
import {
  OTHER_USER_ID,
  TEST_USER_ID,
  createInMemoryUsersRepository,
  createRecordingNotifier,
  createStubDashboardRepository,
  createStubInvitationsRepository,
  createStubTournamentEngine,
  createStubTournamentRepository,
  createStubPairingRepository,
  createTestPresence,
  createTestSessionRegistry,
  stubVerifier,
} from '../testing';

let server: Server;
let baseUrl: string;
let pairing: ReturnType<typeof createStubPairingRepository>;
let realtime: ReturnType<typeof createRecordingNotifier>;

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

const submitCode = (code: string, token = 'valid') =>
  request('/api/pairing/requests', { method: 'POST', token, body: JSON.stringify({ code }) });

const lookup = (code: string, token = 'valid') => request(`/api/pairing/codes/${code}`, { token });

const respond = (accept: boolean, token = 'valid') =>
  request('/api/pairing/requests/request-1/respond', {
    method: 'POST',
    token,
    body: JSON.stringify({ accept }),
  });

const cancel = (token = 'valid') =>
  request('/api/pairing/requests/request-1/cancel', { method: 'POST', token, body: '{}' });

beforeEach(async () => {
  pairing = createStubPairingRepository();
  realtime = createRecordingNotifier();
  server = createApp({
    appOrigin: 'http://localhost:3000',
    verifier: stubVerifier,
    users: createInMemoryUsersRepository(),
    pairing,
    dashboard: createStubDashboardRepository(),
    invitations: createStubInvitationsRepository(),
    tournaments: createStubTournamentRepository(),
    tournamentEngine: createStubTournamentEngine(),
    sessions: createTestSessionRegistry(),
    presence: createTestPresence(),
    realtime,
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('authentication', () => {
  it.each([
    ['GET', '/api/pairing'],
    ['POST', '/api/pairing/requests'],
    ['POST', '/api/pairing/requests/request-1/respond'],
    ['POST', '/api/pairing/requests/request-1/cancel'],
  ])('refuses %s %s without a token', async (method, path) => {
    const response = await request(path, {
      method,
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/pairing/requests', () => {
  it('creates a request and tells both people over their sockets', async () => {
    const response = await submitCode('GOODCODE');

    expect(response.status).toBe(201);
    expect(realtime.recipientsOf(EVENTS.pairing.requestCreated).sort()).toEqual(
      [OTHER_USER_ID, TEST_USER_ID].sort(),
    );
  });

  it('accepts a code however it was typed', async () => {
    expect((await submitCode('goodcode')).status).toBe(201);
    expect((await submitCode('good-code')).status).toBe(201);
    expect((await submitCode(' GOOD CODE ')).status).toBe(201);
  });

  it('returns 404 for a code that does not exist, and tells nobody', async () => {
    const response = await submitCode('NOSUCHCD');

    expect(response.status).toBe(404);
    expect(realtime.sent).toHaveLength(0);
  });

  it.each([
    ['cannot_pair_with_self', 400],
    ['already_paired', 409],
    ['partner_already_paired', 409],
    ['request_already_pending', 409],
    ['request_incoming_pending', 409],
  ] as const)('maps %s to HTTP %i', async (code, status) => {
    pairing.failWith(new PairingError(code, 'nope'));
    const response = await submitCode('GOODCODE');

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { reason: code } });
  });

  it('rejects a missing code', async () => {
    const response = await request('/api/pairing/requests', {
      method: 'POST',
      token: 'valid',
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('rate limits repeated attempts so a code cannot be ground down', async () => {
    const attempts = [];
    for (let i = 0; i < 12; i += 1) attempts.push((await submitCode('NOSUCHCD')).status);

    expect(attempts.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(attempts.slice(0, 10).every((status) => status !== 429)).toBe(true);
  });

  it('forwards the couple’s answers only when both fields came', async () => {
    await submitCode('GOODCODE');
    expect(pairing.detailsSeen).toBeUndefined();

    await request('/api/pairing/requests', {
      method: 'POST',
      token: 'valid',
      body: JSON.stringify({
        code: 'GOODCODE',
        firstMetDate: '2021-03-14',
        locationType: 'different_city',
      }),
    });
    expect(pairing.detailsSeen).toEqual({
      firstMetDate: '2021-03-14',
      locationType: 'different_city',
    });
  });

  it('maps needs_couple_details to a 400 the panel can act on', async () => {
    pairing.failWith(new PairingError('needs_couple_details', 'nope'));
    const response = await submitCode('GOODCODE');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: 'needs_couple_details' },
    });
  });
});

describe('GET /api/pairing/codes/:code', () => {
  it('describes who a code belongs to, without acting on it', async () => {
    const response = await lookup('GOODCODE');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      needsCoupleDetails: false,
      owner: { id: OTHER_USER_ID, nickname: 'Other' },
    });
    // Looking is not asking: nobody is told, and no request exists.
    expect(realtime.sent).toHaveLength(0);
  });

  it('says when the owner never answered the couple’s questions', async () => {
    pairing.lookup = { ...pairing.lookup, needsCoupleDetails: true };

    await expect(lookup('GOODCODE').then((r) => r.json())).resolves.toMatchObject({
      needsCoupleDetails: true,
    });
  });

  it.each(['not_found', 'self', 'already_paired'] as const)(
    'reports %s without naming anybody',
    async (status) => {
      pairing.lookup = { status, needsCoupleDetails: false, owner: null };

      await expect(lookup('WHATEVER').then((r) => r.json())).resolves.toEqual({
        status,
        needsCoupleDetails: false,
        owner: null,
      });
    },
  );

  it('needs a token like everything else', async () => {
    expect((await request('/api/pairing/codes/GOODCODE')).status).toBe(401);
  });

  /**
   * The point of the shared limiter. A check that were cheaper than the request it precedes would
   * be a free oracle for grinding codes, so the two spend one budget between them.
   */
  it('spends the same budget as sending a request', async () => {
    for (let i = 0; i < 10; i += 1) await lookup('NOSUCHCD');

    expect((await submitCode('GOODCODE')).status).toBe(429);
  });
});

describe('POST /api/pairing/requests/:id/respond', () => {
  it('accepting pairs the couple and notifies the requester', async () => {
    const response = await respond(true);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ couple: { id: 'couple-1' } });
    expect(realtime.recipientsOf(EVENTS.pairing.requestAccepted).sort()).toEqual(
      [OTHER_USER_ID, TEST_USER_ID].sort(),
    );
  });

  it('rejecting reaches the requester and the rejecter’s own other devices', async () => {
    await respond(false);

    // The requester needs to stop waiting; the rejecter's second screen must stop showing a
    // request that has already been answered.
    expect(realtime.recipientsOf(EVENTS.pairing.requestRejected).sort()).toEqual(
      [OTHER_USER_ID, TEST_USER_ID].sort(),
    );
  });

  it('refuses to answer a request that is not yours', async () => {
    pairing.failWith(new PairingError('request_not_found', 'gone'));
    const response = await respond(true);

    expect(response.status).toBe(404);
    expect(realtime.sent).toHaveLength(0);
  });

  it('refuses to answer a request twice', async () => {
    pairing.failWith(new PairingError('request_not_pending', 'answered'));
    const response = await respond(true);

    expect(response.status).toBe(409);
  });

  it('rejecting frees both sides to try again', async () => {
    const response = await respond(false);

    await expect(response.json()).resolves.toEqual({ couple: null, incoming: [], outgoing: [] });
  });

  it('requires an explicit accept or reject', async () => {
    const response = await request('/api/pairing/requests/request-1/respond', {
      method: 'POST',
      token: 'valid',
      body: JSON.stringify({ accept: 'yes please' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/pairing/requests/:id/cancel', () => {
  it('withdraws the request and clears it off the other screen', async () => {
    const response = await cancel();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ couple: null, incoming: [], outgoing: [] });
    expect(realtime.recipientsOf(EVENTS.pairing.requestCancelled).sort()).toEqual(
      [OTHER_USER_ID, TEST_USER_ID].sort(),
    );
  });

  it('refuses to cancel a request the caller did not send', async () => {
    pairing.failWith(new PairingError('request_not_found', 'gone'));
    const response = await cancel();

    expect(response.status).toBe(404);
    expect(realtime.sent).toHaveLength(0);
  });

  it('refuses to cancel one that was already answered', async () => {
    pairing.failWith(new PairingError('request_not_pending', 'answered'));

    expect((await cancel()).status).toBe(409);
  });
});
