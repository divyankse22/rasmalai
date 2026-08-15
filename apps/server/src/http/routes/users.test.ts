import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  TEST_USER_ID,
  createInMemoryUsersRepository,
  createRecordingNotifier,
  createStubDashboardRepository,
  createStubPairingRepository,
  stubVerifier,
} from '../testing';

let server: Server;
let baseUrl: string;
let users: ReturnType<typeof createInMemoryUsersRepository>;

const VALID_PROFILE = {
  actualName: 'Divyank',
  nickname: 'Div',
  birthYear: 1996,
  avatarKey: 'fox',
  gender: 'female',
  partnerLabelName: 'Anshuman',
  partnerLabelNickname: 'Anshu',
  firstMetDate: '2021-03-14',
  locationType: 'different_city',
};

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

const onboard = (body: unknown, token = 'valid') =>
  request('/api/onboarding', { method: 'POST', token, body: JSON.stringify(body) });

beforeEach(async () => {
  users = createInMemoryUsersRepository();
  server = createApp({
    appOrigin: 'http://localhost:3000',
    verifier: stubVerifier,
    users,
    pairing: createStubPairingRepository(),
    dashboard: createStubDashboardRepository(),
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

describe('authentication', () => {
  it.each([
    ['GET', '/api/me'],
    ['POST', '/api/onboarding'],
  ])('refuses %s %s without a token', async (method, path) => {
    const response = await request(path, { method, ...(method === 'POST' ? { body: '{}' } : {}) });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_authenticated', message: 'Sign in to continue.' },
    });
  });

  it('refuses a token it cannot verify', async () => {
    const response = await request('/api/me', { token: 'forged' });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'not_authenticated' },
    });
  });

  it('ignores a bare token without the Bearer scheme', async () => {
    const response = await fetch(`${baseUrl}/api/me`, { headers: { authorization: 'valid' } });
    expect(response.status).toBe(401);
  });
});

describe('GET /api/me', () => {
  it('returns a null profile before onboarding', async () => {
    const response = await request('/api/me', { token: 'valid' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ profile: null });
  });

  it('returns the profile once onboarded', async () => {
    await onboard(VALID_PROFILE);
    const response = await request('/api/me', { token: 'valid' });

    await expect(response.json()).resolves.toMatchObject({
      profile: { id: TEST_USER_ID, actualName: 'Divyank', nickname: 'Div' },
    });
  });

  it('never returns someone else’s profile', async () => {
    await onboard(VALID_PROFILE);
    const response = await request('/api/me', { token: 'valid-other' });

    await expect(response.json()).resolves.toEqual({ profile: null });
  });
});

describe('POST /api/onboarding', () => {
  it('creates the profile and issues a pairing code', async () => {
    const response = await onboard(VALID_PROFILE);

    expect(response.status).toBe(201);
    const body = (await response.json()) as { profile: { pairingCode: string; id: string } };
    expect(body.profile.id).toBe(TEST_USER_ID);
    expect(body.profile.pairingCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('derives the user from the token, ignoring any id in the body', async () => {
    const response = await onboard({ ...VALID_PROFILE, id: 'somebody-else' });

    const body = (await response.json()) as { profile: { id: string } };
    expect(body.profile.id).toBe(TEST_USER_ID);
  });

  it('refuses a second profile for the same person', async () => {
    await onboard(VALID_PROFILE);
    const response = await onboard(VALID_PROFILE);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_action' } });
  });

  it('reports field-level problems the form can display', async () => {
    const response = await onboard({ ...VALID_PROFILE, actualName: '', birthYear: 2030 });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; fields: Record<string, string> };
    };
    expect(body.error.code).toBe('invalid_payload');
    expect(body.error.fields.actualName).toBeTruthy();
    expect(body.error.fields.birthYear).toBeTruthy();
  });

  it.each([
    ['a future first-met date', { firstMetDate: '2999-01-01' }],
    ['an unknown avatar', { avatarKey: 'dragon' }],
    ['an unknown location type', { locationType: 'mars' }],
    ['a missing nickname', { nickname: '  ' }],
    ['an unknown gender', { gender: 'unspecified' }],
    ['an empty gender', { gender: '' }],
  ])('rejects %s', async (_label, override) => {
    const response = await onboard({ ...VALID_PROFILE, ...override });
    expect(response.status).toBe(400);
  });

  it('retries past a pairing code collision instead of failing the signup', async () => {
    users.seedCodeCollisions(3);
    const response = await onboard(VALID_PROFILE);

    expect(response.status).toBe(201);
  });

  it('gives up cleanly if it cannot find a free code at all', async () => {
    users.seedCodeCollisions(99);
    const response = await onboard(VALID_PROFILE);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'internal_error', message: 'Something went wrong on our side.' },
    });
  });
});
