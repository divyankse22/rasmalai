import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PartnerPresence } from '@rasmalai/shared';
import { createApp } from '../app';
import {
  OTHER_USER_ID,
  createInMemoryUsersRepository,
  createRecordingNotifier,
  createStubDashboardRepository,
  createStubInvitationsRepository,
  createStubPairingRepository,
  createTestPresence,
  createTestSessionRegistry,
  stubVerifier,
} from '../testing';

/**
 * Is my partner here?
 *
 * The socket is what answers this the rest of the time; this endpoint exists for the first moment
 * of a page's life and for the moment somebody presses Play. Everything worth checking is therefore
 * about scope: it answers about exactly one person, and never about anybody else.
 */

let server: Server;
let baseUrl: string;
let pairing: ReturnType<typeof createStubPairingRepository>;
let online: Set<string>;

const ask = (token = 'valid') =>
  fetch(`${baseUrl}/api/presence/partner`, { headers: { authorization: `Bearer ${token}` } });

beforeEach(async () => {
  pairing = createStubPairingRepository();
  online = new Set<string>();

  server = createApp({
    appOrigin: 'http://localhost:3000',
    verifier: stubVerifier,
    users: createInMemoryUsersRepository(),
    pairing,
    dashboard: createStubDashboardRepository(),
    invitations: createStubInvitationsRepository(),
    sessions: createTestSessionRegistry(),
    realtime: createRecordingNotifier(),
    presence: createTestPresence((userId) => online.has(userId)),
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('asking whether a partner is online', () => {
  it('refuses anyone without a token', async () => {
    const response = await fetch(`${baseUrl}/api/presence/partner`);
    expect(response.status).toBe(401);
  });

  it('says so when they have a socket open', async () => {
    online.add(OTHER_USER_ID);

    const response = await ask();
    const body = (await response.json()) as PartnerPresence;

    expect(response.status).toBe(200);
    expect(body.online).toBe(true);
    expect(body.partner?.id).toBe(OTHER_USER_ID);
  });

  it('says so when they do not', async () => {
    const body = (await ask()).json() as Promise<PartnerPresence>;
    expect((await body).online).toBe(false);
  });

  it('carries the face, so the header can draw itself from one request', async () => {
    const body = (await (await ask()).json()) as PartnerPresence;

    // Not a second round trip to the dashboard: this is mounted in the app shell, on every page,
    // including the ones that fetch nothing.
    expect(body.partner).toMatchObject({ nickname: 'Other', avatarKey: 'fox', gender: 'female' });
  });

  it('answers 200 for somebody who is not paired yet', async () => {
    pairing.partner = null;

    const response = await ask();
    const body = (await response.json()) as PartnerPresence;

    // Being unpaired is an ordinary stage of signing up, not a failure — and the header asks this
    // on every page whether or not there is anybody to ask about.
    expect(response.status).toBe(200);
    expect(body).toEqual({ partner: null, online: false });
  });

  it('answers about the caller’s own partner and nobody else', async () => {
    // There is no way to name a person in this request: the couple is derived from the token's
    // membership, so the only thing a caller can learn is about the one person they are paired
    // with (`docs/07_SECURITY_PRIVACY.md`).
    online.add(OTHER_USER_ID);
    pairing.partner = null;

    const body = (await (await ask()).json()) as PartnerPresence;
    expect(body.online).toBe(false);
  });
});
