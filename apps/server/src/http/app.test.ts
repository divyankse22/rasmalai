import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import {
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
} from './testing';

const APP_ORIGIN = 'http://localhost:3000';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp({
    appOrigin: APP_ORIGIN,
    verifier: stubVerifier,
    users: createInMemoryUsersRepository(),
    pairing: createStubPairingRepository(),
    dashboard: createStubDashboardRepository(),
    invitations: createStubInvitationsRepository(),
    tournaments: createStubTournamentRepository(),
    tournamentEngine: createStubTournamentEngine(),
    sessions: createTestSessionRegistry(),
    realtime: createRecordingNotifier(),
    presence: createTestPresence(),
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /healthz', () => {
  it('reports healthy', async () => {
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'rasmalai-server',
      uptimeSeconds: expect.any(Number),
    });
  });

  it('does not leak environment or build details', async () => {
    const body = await (await fetch(`${baseUrl}/healthz`)).text();

    expect(body).not.toMatch(/secret|key|password|postgres|NODE_ENV/i);
  });
});

describe('cors', () => {
  it('allows the configured app origin', async () => {
    const response = await fetch(`${baseUrl}/healthz`, { headers: { Origin: APP_ORIGIN } });

    expect(response.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
  });

  it('does not allow an arbitrary origin', async () => {
    const response = await fetch(`${baseUrl}/healthz`, {
      headers: { Origin: 'https://evil.example' },
    });

    expect(response.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
  });
});

describe('unknown routes', () => {
  it('answers with a structured error', async () => {
    const response = await fetch(`${baseUrl}/nope`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_found', message: 'Unknown endpoint.' },
    });
  });
});
