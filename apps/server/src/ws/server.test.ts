import { createServer, type Server } from 'node:http';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS, createEnvelope, parseEnvelope, serializeEnvelope, type Envelope } from '@rasmalai/shared';
import type { TokenVerifier } from '../auth/tokenVerifier';
import { WS_CLOSE, attachWebSocketServer, type RealtimeServer } from './server';

/** Stands in for the JWKS verifier; token validity is covered by tokenVerifier.test.ts. */
const verifier: TokenVerifier = {
  async verify(token: string) {
    if (token === 'good') return { userId: 'user-a', email: 'a@example.com', expiresAt: Date.now() + 60_000 };
    if (token === 'good-b') return { userId: 'user-b', email: 'b@example.com', expiresAt: Date.now() + 60_000 };
    if (token === 'expiring') return { userId: 'user-a', email: undefined, expiresAt: Date.now() - 1 };
    throw new Error('invalid token');
  },
};

let httpServer: Server;
let realtime: RealtimeServer;
let url: string;

/** A socket plus a queue, so a test can await the next frame without racing the connection. */
function connect(): {
  socket: WebSocket;
  next: () => Promise<Envelope>;
  closed: Promise<{ code: number; reason: string }>;
} {
  const socket = new WebSocket(url);
  const received: Envelope[] = [];
  const waiters: ((envelope: Envelope) => void)[] = [];

  socket.on('message', (raw) => {
    const parsed = parseEnvelope(raw.toString());
    if (!parsed.ok) throw new Error('server sent an unparseable frame');
    const waiter = waiters.shift();
    if (waiter) waiter(parsed.envelope);
    else received.push(parsed.envelope);
  });

  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });

  return {
    socket,
    next: () =>
      new Promise<Envelope>((resolve, reject) => {
        const queued = received.shift();
        if (queued) return resolve(queued);
        const timer = setTimeout(() => reject(new Error('timed out waiting for a frame')), 2000);
        waiters.push((envelope) => {
          clearTimeout(timer);
          resolve(envelope);
        });
      }),
    closed,
  };
}

function authenticate(socket: WebSocket, accessToken: string, requestId?: string): void {
  socket.send(serializeEnvelope(createEnvelope(EVENTS.connection.authenticate, { accessToken }, requestId)));
}

async function open(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return;
  await new Promise((resolve) => socket.once('open', resolve));
}

/**
 * The client sees `close` as soon as its own side of the handshake finishes, which can be a tick
 * before the server runs its close handler and updates the registry. Poll rather than assume the
 * two happen in lockstep.
 */
async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition was not met in time');
}

beforeEach(async () => {
  httpServer = createServer();
  realtime = attachWebSocketServer(httpServer, { verifier, authTimeoutMs: 150, heartbeatIntervalMs: 60 });
  httpServer.listen(0);
  await new Promise((resolve) => httpServer.once('listening', resolve));

  const address = httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  url = `ws://127.0.0.1:${address.port}/ws`;
});

afterEach(async () => {
  await realtime.close();
  await new Promise((resolve) => httpServer.close(resolve));
});

describe('websocket handshake', () => {
  it('authenticates a valid token and reports the derived user', async () => {
    const client = connect();
    await open(client.socket);
    authenticate(client.socket, 'good', 'req-1');

    const frame = await client.next();

    expect(frame.type).toBe(EVENTS.connection.authenticated);
    expect(frame.payload).toEqual({ userId: 'user-a' });
    expect(frame.requestId).toBe('req-1');
    expect(realtime.registry.isOnline('user-a')).toBe(true);
    client.socket.close();
  });

  it('rejects an invalid token and closes the socket', async () => {
    const client = connect();
    await open(client.socket);
    authenticate(client.socket, 'nonsense');

    const frame = await client.next();
    expect(frame.type).toBe(EVENTS.error);
    expect(frame.payload).toEqual({ code: 'not_authenticated', message: 'That session is not valid.' });

    const { code } = await client.closed;
    expect(code).toBe(WS_CLOSE.unauthenticated);
    expect(realtime.registry.onlineUserCount).toBe(0);
  });

  it('closes a socket that never authenticates', async () => {
    const client = connect();
    await open(client.socket);

    const frame = await client.next();
    expect(frame.type).toBe(EVENTS.error);
    expect(frame.payload).toMatchObject({ code: 'not_authenticated' });

    const { code } = await client.closed;
    expect(code).toBe(WS_CLOSE.authTimeout);
  });

  it('refuses any other frame before authentication', async () => {
    const client = connect();
    await open(client.socket);
    client.socket.send(serializeEnvelope(createEnvelope(EVENTS.game.actionRequest, { tap: true })));

    const frame = await client.next();
    expect(frame.payload).toEqual({
      code: 'not_authenticated',
      message: 'Authenticate before sending anything else.',
    });
    await expect(client.closed).resolves.toMatchObject({ code: WS_CLOSE.unauthenticated });
  });

  it('rejects a malformed frame from an anonymous socket', async () => {
    const client = connect();
    await open(client.socket);
    client.socket.send('this is not json');

    const frame = await client.next();
    expect(frame.payload).toMatchObject({ code: 'invalid_payload' });
    await expect(client.closed).resolves.toMatchObject({ code: WS_CLOSE.unauthenticated });
  });

  it('rejects a missing access token without crashing', async () => {
    const client = connect();
    await open(client.socket);
    client.socket.send(serializeEnvelope(createEnvelope(EVENTS.connection.authenticate, {})));

    const frame = await client.next();
    expect(frame.payload).toMatchObject({ code: 'invalid_payload' });
  });

  it('answers an unknown frame from an authenticated socket without disconnecting it', async () => {
    const client = connect();
    await open(client.socket);
    authenticate(client.socket, 'good');
    await client.next();

    client.socket.send(serializeEnvelope(createEnvelope('nonsense.type', {})));
    const frame = await client.next();

    expect(frame.payload).toMatchObject({ code: 'invalid_action' });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.socket.close();
  });
});

describe('multiple sockets per user', () => {
  it('treats a second tab as the same person and keeps them online until both close', async () => {
    const first = connect();
    const second = connect();
    await Promise.all([open(first.socket), open(second.socket)]);

    authenticate(first.socket, 'good');
    authenticate(second.socket, 'good');
    await Promise.all([first.next(), second.next()]);

    expect(realtime.registry.onlineUserCount).toBe(1);
    expect(realtime.registry.socketsFor('user-a').size).toBe(2);

    first.socket.close();
    await first.closed;
    expect(realtime.registry.isOnline('user-a')).toBe(true);

    second.socket.close();
    await second.closed;
    await until(() => !realtime.registry.isOnline('user-a'));
  });

  it('keeps two different people separate', async () => {
    const a = connect();
    const b = connect();
    await Promise.all([open(a.socket), open(b.socket)]);

    authenticate(a.socket, 'good');
    authenticate(b.socket, 'good-b');
    await Promise.all([a.next(), b.next()]);

    expect(realtime.registry.onlineUserCount).toBe(2);
    expect(realtime.registry.socketsFor('user-a').size).toBe(1);
    a.socket.close();
    b.socket.close();
  });

  it('refuses to swap identity on an already authenticated socket', async () => {
    const client = connect();
    await open(client.socket);
    authenticate(client.socket, 'good');
    await client.next();

    client.socket.send(
      serializeEnvelope(createEnvelope(EVENTS.connection.reauthenticate, { accessToken: 'good-b' })),
    );

    const frame = await client.next();
    expect(frame.payload).toMatchObject({ code: 'not_authorized' });
    await expect(client.closed).resolves.toMatchObject({ code: WS_CLOSE.unauthenticated });
    expect(realtime.registry.isOnline('user-b')).toBe(false);
  });
});

describe('session expiry', () => {
  it('closes a socket whose token has expired', async () => {
    const client = connect();
    await open(client.socket);
    authenticate(client.socket, 'expiring');
    await client.next();

    const frame = await client.next();
    expect(frame.payload).toEqual({ code: 'not_authenticated', message: 'Session expired.' });

    const { code } = await client.closed;
    expect(code).toBe(WS_CLOSE.sessionExpired);
    await until(() => realtime.registry.onlineUserCount === 0);
  });
});
