import { createServer, type Server } from 'node:http';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EVENTS,
  createEnvelope,
  parseEnvelope,
  serializeEnvelope,
  type Envelope,
  type PartnerPresence,
} from '@rasmalai/shared';
import type { TokenVerifier } from '../auth/tokenVerifier';
import { SessionError } from '../modules/sessions/sessionError';
import {
  createSessionRegistry,
  type SessionRegistry,
} from '../modules/sessions/sessionRegistry';
import { createNotifier } from './notifier';
import { SocketRegistry } from './socketRegistry';
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

function send(socket: WebSocket, type: string, payload: unknown): void {
  socket.send(serializeEnvelope(createEnvelope(type, payload)));
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

/** Set by a test that wants the caller to already be in a game when their socket opens. */
let runningSessionId: string | null = null;

const sessionsStub: SessionRegistry = {
  create() {
    throw new Error('sessions are not created over the socket');
  },
  viewFor(sessionId, userId) {
    calls.push({ method: 'viewFor', args: [sessionId, userId] });
    return { id: sessionId } as unknown as ReturnType<SessionRegistry['viewFor']>;
  },
  join(sessionId, userId) {
    calls.push({ method: 'join', args: [sessionId, userId] });
    return { id: sessionId } as unknown as ReturnType<SessionRegistry['viewFor']>;
  },
  markAway(...args) {
    calls.push({ method: 'markAway', args });
  },
  requestLeave(...args) {
    calls.push({ method: 'requestLeave', args });
    if (refuseWith) throw refuseWith;
  },
  respondToLeave(...args) {
    calls.push({ method: 'respondToLeave', args });
    if (refuseWith) throw refuseWith;
  },
  sessionIdForUser: () => runningSessionId,
  closeTournamentSession() {
    throw new Error('tournament sessions are not closed over the socket');
  },
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
  runningSessionId = null;
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

  it('hands a game already in progress straight back, unasked', async () => {
    runningSessionId = 'session-9';

    const client = connect();
    await open(client.socket);
    authenticate(client.socket, 'good');

    expect((await client.next()).type).toBe(EVENTS.connection.authenticated);

    // The person this exists for is the one who refreshed on their dashboard mid-match: they are
    // not on the game's page, so nothing they load fetches it, and the server only broadcasts on
    // transitions — of which their reconnection is not one. Without this frame they forfeit two
    // minutes later having never been told a clock was running.
    const frame = await client.next();
    expect(frame.type).toBe(EVENTS.lobby.joined);
    expect(frame.payload).toEqual({ session: { id: 'session-9' } });
    // Read, not joined: being handed the state is not a claim to be at the table.
    expect(lastCall('join')).toBeUndefined();
    client.socket.close();
  });

  it('says nothing about a game when there is not one', async () => {
    const client = connect();
    await open(client.socket);
    authenticate(client.socket, 'good');

    expect((await client.next()).type).toBe(EVENTS.connection.authenticated);
    await expect(client.next()).rejects.toThrow(/timed out/);
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

describe('partner presence snapshot', () => {
  let snapshotServer: Server;
  let snapshotRealtime: RealtimeServer;
  let snapshotUrl: string;
  let snapshot: PartnerPresence;

  function snapshotConnect(): { socket: WebSocket; next: () => Promise<Envelope> } {
    const socket = new WebSocket(snapshotUrl);
    const received: Envelope[] = [];
    const waiters: ((envelope: Envelope) => void)[] = [];
    socket.on('message', (raw) => {
      const parsed = parseEnvelope(raw.toString());
      if (!parsed.ok) throw new Error('server sent an unparseable frame');
      const waiter = waiters.shift();
      if (waiter) waiter(parsed.envelope);
      else received.push(parsed.envelope);
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
    };
  }

  beforeEach(async () => {
    snapshot = {
      partner: { id: 'partner-1', nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
      online: true,
    };
    snapshotServer = createServer();
    snapshotRealtime = attachWebSocketServer(snapshotServer, {
      verifier,
      authTimeoutMs: 150,
      heartbeatIntervalMs: 60,
      // Reads whatever the test last set, so a single stub can answer differently across calls
      // within the same test — the way the real one answers differently as presence changes.
      presenceSnapshotFor: async () => snapshot,
    });
    snapshotServer.listen(0);
    await new Promise((resolve) => snapshotServer.once('listening', resolve));

    const address = snapshotServer.address();
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
    snapshotUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterEach(async () => {
    await snapshotRealtime.close();
    await new Promise((resolve) => snapshotServer.close(resolve));
  });

  it('sends a partner presence snapshot right after authenticating', async () => {
    const client = snapshotConnect();
    await open(client.socket);
    authenticate(client.socket, 'good');

    expect((await client.next()).type).toBe(EVENTS.connection.authenticated);
    const frame = await client.next();
    expect(frame.type).toBe(EVENTS.presence.partnerSnapshot);
    expect(frame.payload).toEqual(snapshot);
    client.socket.close();
  });

  it('sends a fresh snapshot again on reauthenticate, the same way a reconnect does', async () => {
    const client = snapshotConnect();
    await open(client.socket);
    authenticate(client.socket, 'good');
    await client.next();
    await client.next();

    // Presence changed while this socket held its old snapshot — exactly what a genuine reconnect
    // after a missed transition would look like from the client's side.
    snapshot = { ...snapshot, online: false };
    client.socket.send(
      serializeEnvelope(createEnvelope(EVENTS.connection.reauthenticate, { accessToken: 'good' })),
    );

    expect((await client.next()).type).toBe(EVENTS.connection.authenticated);
    const frame = await client.next();
    expect(frame.type).toBe(EVENTS.presence.partnerSnapshot);
    expect(frame.payload).toEqual(snapshot);
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
    // Stamped with the session it was about. One socket serves the whole app, so a client that was
    // not told which game an error belonged to would apply it to whichever one it happens to be
    // showing — and the frame a page sends on its way out routinely arrives after the next game
    // has already opened.
    expect(frame.payload).toEqual({
      code: 'invalid_action',
      message: 'That round has already finished.',
      sessionId: 'session-1',
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

/**
 * The socket layer and a real session registry, together.
 *
 * Everything above runs against a recording stub, which is the right shape for asking whether a
 * frame was validated and passed on. It cannot answer the question this file most needs to answer:
 * what two genuine clients do to a genuine session. The bug that prompted these was invisible to
 * both halves on their own — every registry test joined both players before doing anything, and
 * every socket test threw its frames at a stub that had no lifecycle to break.
 */
describe('two clients and a real session', () => {
  let liveServer: Server;
  let live: RealtimeServer;
  let liveUrl: string;
  let sessionId: string;

  const liveConnect = (): ReturnType<typeof connect> => {
    const socket = new WebSocket(liveUrl);
    const received: Envelope[] = [];
    socket.on('message', (raw) => {
      const parsed = parseEnvelope(raw.toString());
      if (parsed.ok) received.push(parsed.envelope);
    });
    return {
      socket,
      next: async () => {
        await until(() => received.length > 0);
        return received.shift()!;
      },
      closed: new Promise((resolve) => {
        socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      }),
      // Every frame this client has been sent, for asserting on what it was and was not told.
      seen: received,
    } as ReturnType<typeof connect> & { seen: Envelope[] };
  };

  async function signIn(token: string) {
    const client = liveConnect() as ReturnType<typeof connect> & { seen: Envelope[] };
    await open(client.socket);
    authenticate(client.socket, token);
    await until(() =>
      client.seen.some((frame) => frame.type === EVENTS.connection.authenticated),
    );
    return client;
  }

  beforeEach(async () => {
    liveServer = createServer();
    const registry = new SocketRegistry();
    const sessions = createSessionRegistry(createNotifier(registry), registry);

    live = attachWebSocketServer(liveServer, { verifier, registry, sessions });
    liveServer.listen(0);
    await new Promise((resolve) => liveServer.once('listening', resolve));

    const address = liveServer.address();
    if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
    liveUrl = `ws://127.0.0.1:${address.port}/ws`;

    sessionId = sessions.create({
      coupleId: 'couple-1',
      gameSlug: 'reaction-speed',
      gameName: 'Reaction Speed',
      players: [
        { userId: 'user-a', nickname: 'Ali', avatarKey: 'fox', gender: 'female' },
        { userId: 'user-b', nickname: 'Bo', avatarKey: 'penguin', gender: 'male' },
      ],
    }).id;
  });

  afterEach(async () => {
    await live.close();
    await new Promise((resolve) => liveServer.close(resolve));
  });

  it('survives the first player joining, leaving and rejoining before the second arrives', async () => {
    // The reported bug, over two real sockets. A session is created the moment an invitation is
    // accepted and both of them navigate to it separately, so there is always a window where one is
    // there and the other is still on the games list. A refresh inside that window — or, in
    // development, React's deliberate double mount — used to end the game for both, and the second
    // player arrived to `session_not_found` and "That game is no longer running."
    const alice = await signIn('good');

    send(alice.socket, EVENTS.lobby.join, { sessionId });
    await until(() => alice.seen.some((frame) => frame.type === EVENTS.lobby.joined));
    alice.seen.length = 0;

    send(alice.socket, EVENTS.lobby.away, { sessionId });
    send(alice.socket, EVENTS.lobby.join, { sessionId });
    await until(() => alice.seen.some((frame) => frame.type === EVENTS.lobby.joined));

    expect(alice.seen.some((frame) => frame.type === EVENTS.error)).toBe(false);
    expect(alice.seen.some((frame) => frame.type === EVENTS.lobby.ended)).toBe(false);

    // And the whole point: the partner, arriving late, finds a game.
    const bob = await signIn('good-b');
    bob.seen.length = 0;
    send(bob.socket, EVENTS.lobby.join, { sessionId });

    await until(() => bob.seen.some((frame) => frame.type === EVENTS.lobby.joined));
    expect(bob.seen.some((frame) => frame.type === EVENTS.error)).toBe(false);

    alice.socket.close();
    bob.socket.close();
  });

  it('names the session on an error, so a client can tell whose it is', async () => {
    const alice = await signIn('good');
    alice.seen.length = 0;

    // The frame a page sends on its way out, arriving after that session has gone. Without the id
    // on it, the next screen would read this as its own game ending.
    send(alice.socket, EVENTS.lobby.away, { sessionId: 'a-session-that-has-ended' });

    await until(() => alice.seen.some((frame) => frame.type === EVENTS.error));
    const error = alice.seen.find((frame) => frame.type === EVENTS.error)!;

    expect(error.payload).toMatchObject({
      code: 'session_not_found',
      sessionId: 'a-session-that-has-ended',
    });
    alice.socket.close();
  });
});
