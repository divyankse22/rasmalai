import type { Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { z } from 'zod';
import {
  EVENTS,
  MAX_ENVELOPE_BYTES,
  createEnvelope,
  parseEnvelope,
  serializeEnvelope,
  type ProtocolError,
} from '@rasmalai/shared';
import type { TokenVerifier } from '../auth/tokenVerifier';
import { logger } from '../logger';
import { SocketRegistry } from './socketRegistry';

/** Application close codes. 4000-4999 is the range reserved for private use. */
export const WS_CLOSE = {
  unauthenticated: 4401,
  authTimeout: 4408,
  sessionExpired: 4402,
} as const;

const authenticatePayload = z.object({ accessToken: z.string().min(1).max(8192) });

interface SocketState {
  userId: string | undefined;
  /** Epoch ms when the presented access token expires. */
  expiresAt: number | undefined;
  isAlive: boolean;
  authTimer: NodeJS.Timeout | undefined;
}

export interface WebSocketServerOptions {
  verifier: TokenVerifier;
  path?: string;
  /** How long an anonymous socket may stay open before it is closed. */
  authTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  /**
   * Supplied by the caller when the HTTP layer also needs to reach these sockets, since the app is
   * constructed before the server the sockets attach to.
   */
  registry?: SocketRegistry;
}

export interface RealtimeServer {
  wss: WebSocketServer;
  registry: SocketRegistry;
  close(): Promise<void>;
}

/**
 * The authenticated realtime entry point.
 *
 * Security posture, per `docs/07_SECURITY_PRIVACY.md`: a socket proves who it is before it can do
 * anything at all. Knowing a URL grants nothing. The token arrives in the first *frame* rather than
 * a query string, because query strings end up in proxy and access logs.
 */
export function attachWebSocketServer(
  server: Server,
  {
    verifier,
    path = '/ws',
    authTimeoutMs = 10_000,
    heartbeatIntervalMs = 20_000,
    registry = new SocketRegistry(),
  }: WebSocketServerOptions,
): RealtimeServer {
  const wss = new WebSocketServer({ server, path, maxPayload: MAX_ENVELOPE_BYTES });
  const states = new WeakMap<WebSocket, SocketState>();

  function send(socket: WebSocket, type: string, payload: unknown, requestId?: string): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(serializeEnvelope(createEnvelope(type, payload, requestId)));
  }

  function fail(socket: WebSocket, error: ProtocolError, closeCode: number, requestId?: string): void {
    send(socket, EVENTS.error, error, requestId);
    socket.close(closeCode, error.code);
  }

  async function handleMessage(socket: WebSocket, state: SocketState, raw: RawData): Promise<void> {
    const parsed = parseEnvelope(raw.toString());
    if (!parsed.ok) {
      // A malformed frame from an anonymous socket is not worth keeping the connection open for.
      if (state.userId === undefined) fail(socket, parsed.error, WS_CLOSE.unauthenticated);
      else send(socket, EVENTS.error, parsed.error);
      return;
    }

    const { type, payload, requestId } = parsed.envelope;
    const isAuthFrame =
      type === EVENTS.connection.authenticate || type === EVENTS.connection.reauthenticate;

    if (isAuthFrame) {
      const result = authenticatePayload.safeParse(payload);
      if (!result.success) {
        fail(
          socket,
          { code: 'invalid_payload', message: 'An access token is required.' },
          WS_CLOSE.unauthenticated,
          requestId,
        );
        return;
      }

      let user;
      try {
        user = await verifier.verify(result.data.accessToken);
      } catch (error) {
        logger.debug({ err: error }, 'socket presented an unusable token');
        fail(
          socket,
          { code: 'not_authenticated', message: 'That session is not valid.' },
          WS_CLOSE.unauthenticated,
          requestId,
        );
        return;
      }

      // A refreshed token must belong to the same person; swapping identities mid-socket is not a
      // thing we ever want to support.
      if (state.userId !== undefined && state.userId !== user.userId) {
        fail(
          socket,
          { code: 'not_authorized', message: 'This connection belongs to a different session.' },
          WS_CLOSE.unauthenticated,
          requestId,
        );
        return;
      }

      if (state.authTimer) {
        clearTimeout(state.authTimer);
        state.authTimer = undefined;
      }
      state.userId = user.userId;
      state.expiresAt = user.expiresAt;
      registry.add(user.userId, socket);

      send(socket, EVENTS.connection.authenticated, { userId: user.userId }, requestId);
      logger.debug({ userId: user.userId }, 'socket authenticated');
      return;
    }

    if (state.userId === undefined) {
      fail(
        socket,
        { code: 'not_authenticated', message: 'Authenticate before sending anything else.' },
        WS_CLOSE.unauthenticated,
        requestId,
      );
      return;
    }

    // Everything past the handshake arrives in later slices; until then an unknown frame is an
    // error rather than a silent no-op, so client bugs surface immediately.
    send(socket, EVENTS.error, { code: 'invalid_action', message: 'Unknown message type.' }, requestId);
  }

  wss.on('connection', (socket: WebSocket) => {
    const state: SocketState = {
      userId: undefined,
      expiresAt: undefined,
      isAlive: true,
      authTimer: undefined,
    };
    states.set(socket, state);

    state.authTimer = setTimeout(() => {
      fail(
        socket,
        { code: 'not_authenticated', message: 'Authentication timed out.' },
        WS_CLOSE.authTimeout,
      );
    }, authTimeoutMs);

    socket.on('pong', () => {
      state.isAlive = true;
    });

    socket.on('message', (raw) => {
      void handleMessage(socket, state, raw).catch((error: unknown) => {
        logger.error({ err: error }, 'failed handling socket message');
        send(socket, EVENTS.error, { code: 'internal_error', message: 'Something went wrong.' });
      });
    });

    socket.on('close', () => {
      if (state.authTimer) clearTimeout(state.authTimer);
      if (state.userId !== undefined) registry.remove(state.userId, socket);
    });

    socket.on('error', (error) => {
      logger.warn({ err: error }, 'socket error');
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const state = states.get(socket);
      if (!state) continue;

      if (state.expiresAt !== undefined && Date.now() >= state.expiresAt) {
        fail(
          socket,
          { code: 'not_authenticated', message: 'Session expired.' },
          WS_CLOSE.sessionExpired,
        );
        continue;
      }

      if (!state.isAlive) {
        socket.terminate();
        continue;
      }

      state.isAlive = false;
      socket.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  return {
    wss,
    registry,
    close() {
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      return new Promise<void>((resolve, reject) => {
        wss.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
