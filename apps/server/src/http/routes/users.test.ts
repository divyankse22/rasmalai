import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { EVENTS } from '@rasmalai/shared';
import {
  OTHER_USER_ID,
  TEST_USER_ID,
  createInMemoryUsersRepository,
  createRecordingNotifier,
  createStubDashboardRepository,
  createStubInvitationsRepository,
  createStubPairingRepository,
  createTestPresence,
  createTestSessionRegistry,
  stubVerifier,
  testProfile,
} from '../testing';

let server: Server;
let baseUrl: string;
let users: ReturnType<typeof createInMemoryUsersRepository>;
let realtime: ReturnType<typeof createRecordingNotifier>;

/** Whoever gets here first, and therefore answers the couple's questions. */
const VALID_PROFILE = {
  nickname: 'Div',
  birthYear: 1996,
  avatarKey: 'fox',
  gender: 'female',
  partnerLabelNickname: 'Anshu',
  firstMetDate: '2021-03-14',
  locationType: 'different_city',
};

/** Whoever arrives holding the other one's code, and is asked nothing about the couple. */
const JOINING_PROFILE = {
  nickname: 'Anshu',
  birthYear: 1995,
  avatarKey: 'chick',
  gender: 'male',
  partnerLabelNickname: 'Div',
  pairingCode: 'GOODCODE',
};

/** The partner who signed up first, waiting to be found by their code. */
function seedPartner(overrides: Partial<ReturnType<typeof testProfile>> = {}) {
  users.seedUser(testProfile({ id: OTHER_USER_ID, pairingCode: 'GOODCODE', ...overrides }));
}

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
  realtime = createRecordingNotifier();
  server = createApp({
    appOrigin: 'http://localhost:3000',
    verifier: stubVerifier,
    users,
    pairing: createStubPairingRepository(),
    dashboard: createStubDashboardRepository(),
    invitations: createStubInvitationsRepository(),
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
      profile: { id: TEST_USER_ID, nickname: 'Div' },
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
    const response = await onboard({ ...VALID_PROFILE, nickname: '', birthYear: 2030 });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; fields: Record<string, string> };
    };
    expect(body.error.code).toBe('invalid_payload');
    expect(body.error.fields.nickname).toBeTruthy();
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

describe('POST /api/onboarding, arriving with a partner code', () => {
  it('creates the profile and asks to pair, in one request', async () => {
    seedPartner();
    const response = await onboard(JOINING_PROFILE);

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      profile: { id: string; firstMetDate: string | null; locationType: string | null };
      request: { targetUserId: string } | null;
    };

    expect(body.request?.targetUserId).toBe(OTHER_USER_ID);
    expect(users.requests).toEqual([
      { requesterUserId: TEST_USER_ID, targetUserId: OTHER_USER_ID },
    ]);
    // The couple's facts have one author, and it is not this person.
    expect(body.profile.firstMetDate).toBeNull();
    expect(body.profile.locationType).toBeNull();
  });

  it('tells both of them, so a second device keeps up', async () => {
    seedPartner();
    await onboard(JOINING_PROFILE);

    expect(realtime.recipientsOf(EVENTS.pairing.requestCreated).sort()).toEqual(
      [OTHER_USER_ID, TEST_USER_ID].sort(),
    );
  });

  it('accepts the code in whatever spacing it was pasted', async () => {
    seedPartner();
    const response = await onboard({ ...JOINING_PROFILE, pairingCode: 'good code' });

    expect(response.status).toBe(201);
    expect(users.requests).toHaveLength(1);
  });

  it('points an unknown code at the card that asked for it', async () => {
    const response = await onboard(JOINING_PROFILE);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { fields: Record<string, string> } };
    expect(body.error.fields.pairingCode).toBeTruthy();
  });

  it('leaves no profile behind when the code was wrong, so they can try again', async () => {
    await onboard(JOINING_PROFILE);
    await expect(request('/api/me', { token: 'valid' }).then((r) => r.json())).resolves.toEqual({
      profile: null,
    });

    seedPartner();
    expect((await onboard(JOINING_PROFILE)).status).toBe(201);
  });

  it('refuses a code belonging to somebody already paired', async () => {
    seedPartner();
    users.markPaired(OTHER_USER_ID);
    const response = await onboard(JOINING_PROFILE);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: 'partner_already_paired' },
    });
  });

  it('asks the couple’s questions when the code’s owner never answered them either', async () => {
    seedPartner({ firstMetDate: null, locationType: null });
    const response = await onboard(JOINING_PROFILE);

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { reason: string; fields: Record<string, string> };
    };
    expect(body.error.reason).toBe('needs_couple_details');
    expect(body.error.fields.firstMetDate).toBeTruthy();

    // Answering them is enough to get through.
    const retry = await onboard({
      ...JOINING_PROFILE,
      firstMetDate: '2021-03-14',
      locationType: 'different_city',
    });
    expect(retry.status).toBe(201);
  });

  it('sends nothing when there was no code', async () => {
    const response = await onboard(VALID_PROFILE);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ request: null });
    expect(users.requests).toEqual([]);
    expect(realtime.recipientsOf(EVENTS.pairing.requestCreated)).toEqual([]);
  });
});
