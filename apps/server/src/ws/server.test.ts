import { createServer, type Server } from 'node:http';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS, createEnvelope, parseEnvelope, serializeEnvelope, type Envelope } from '@rasmalai/shared';
import type { TokenVerifier } from '../auth/tokenVerifier';
import { SessionError } from '../modules/sessions/sessionError';
import type { SessionRegistry } from '../modules/sessions/sessionRegistry';
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

/**
 * A session registry that only records what it was asked to do.
 *
 * These tests are about the socket layer's half of the arrangement — that a frame is validated,
 * rate limited, timed by the server and handed on unaltered. What the session then *does* with it
 * is covered against the real game in `modules/sessions/sessionRegistry.test.ts`.
 */
interface Call {
  method: string;
  args: unknown[];
}

let calls: Call[];
let refuseWith: SessionError | null;

const sessionsStub: SessionRegistry = {
  create() {
    throw new Error('sessions are not created over the socket');
  },
  viewFor(sessionId, userId) {
    calls.push({ method: 'viewFor', args: [sessionId, userId] });
    return { id: sessionId } as unknown as ReturnType<SessionRegistry['viewFor']>;
  },
  sessionIdForUser: () => null,
  setReady(...args) {
    calls.push({ method: 'setReady', args });
  },
  submitAction(...args) {
    calls.push({ method: 'submitAction', args });
    if (refuseWith) throw refuseWith;
  },
  leave(...args) {
    calls.push({ method: 'leave', args });
  },
  react(...args) {
    calls.push({ method: 'react', args });
  },
  handlePresence() {},
  closeAll() {},
  size: 0,
};

const lastCall = (method: string): Call | undefined =>
  [...calls].reverse().find((call) => call.method === method);

beforeEach(async () => {
  calls = [];
  refuseWith = null;
  httpServer = createServer();
  realtime = attachWebSocketServer(httpServer, {
    verifier,
    authTimeoutMs: 150,
    heartbeatIntervalMs: 60,
    sessions: sessionsStub,
  });
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

describe('game frames', () => {
  /** An authenticated socket, with its first round-trip measurement already taken. */
  async function player(token = 'good') {
    const client = connect();
    await open(client.socket);
    authenticate(client.socket, token);
    await client.next();
    return client;
  }

  function send(socket: WebSocket, type: string, payload: unknown): void {
    socket.send(serializeEnvelope(createEnvelope(type, payload)));
  }

  it('hands an action to the session with the server’s own timing', async () => {
    const client = await player();
    const before = Date.now();

    send(client.socket, EVENTS.game.actionRequest, {
      sessionId: 'session-1',
      action: { type: 'tap', round: 2 },
    });
    await until(() => lastCall('submitAction') !== undefined);

    const [sessionId, userId, action, timing] = lastCall('submitAction')!.args as [
      string,
      string,
      unknown,
      { receivedAt: number; compensationMs: number },
    ];

    expect(sessionId).toBe('session-1');
    // Derived from the verified token, never from the frame.
    expect(userId).toBe('user-a');
    // Passed through untouched: the platform has no opinion about what a move looks like.
    expect(action).toEqual({ type: 'tap', round: 2 });
    expect(timing.receivedAt).toBeGreaterThanOrEqual(before);
    expect(timing.compensationMs).toBeGreaterThanOrEqual(0);
    expect(timing.compensationMs).toBeLessThan(1_000);
  });

  it('refuses an action frame that is not shaped right, and keeps the socket', async () => {
    const client = await player();
    send(client.socket, EVENTS.game.actionRequest, { action: { type: 'tap' } });

    const frame = await client.next();
    expect(frame.payload).toMatchObject({ code: 'invalid_payload' });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    expect(lastCall('submitAction')).toBeUndefined();
  });

  it('passes on the game’s own refusal without dropping a player mid-match', async () => {
    const client = await player();
    refuseWith = new SessionError('invalid_action', 'That round has already finished.');

    send(client.socket, EVENTS.game.actionRequest, { sessionId: 'session-1', action: {} });

    const frame = await client.next();
    expect(frame.payload).toEqual({
      code: 'invalid_action',
      message: 'That round has already finished.',
    });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('caps how fast actions can be sent', async () => {
    const client = await player();
    for (let index = 0; index < 40; index += 1) {
      send(client.socket, EVENTS.game.actionRequest, { sessionId: 'session-1', action: {} });
    }

    const frame = await client.next();
    expect(frame.payload).toMatchObject({ code: 'rate_limited' });
    // The ones inside the limit still went through; the flood did not.
    expect(calls.filter((call) => call.method === 'submitAction').length).toBeLessThan(40);
  });

  it('closes a session for both when somebody leaves on purpose', async () => {
    const client = await player();
    send(client.socket, EVENTS.lobby.leave, { sessionId: 'session-1' });
    await until(() => lastCall('leave') !== undefined);

    expect(lastCall('leave')!.args).toEqual(['session-1', 'user-a']);
  });

  it('refuses a game frame from a socket that has not said who it is', async () => {
    const client = connect();
    await open(client.socket);
    send(client.socket, EVENTS.game.actionRequest, { sessionId: 'session-1', action: {} });

    const frame = await client.next();
    expect(frame.payload).toMatchObject({ code: 'not_authenticated' });
    await expect(client.closed).resolves.toMatchObject({ code: WS_CLOSE.unauthenticated });
    expect(lastCall('submitAction')).toBeUndefined();
  });
});
