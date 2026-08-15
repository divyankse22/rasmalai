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
  createStubPairingRepository,
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
