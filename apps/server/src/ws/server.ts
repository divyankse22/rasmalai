import type { Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { z } from 'zod';
import {
  EVENTS,
  MAX_ENVELOPE_BYTES,
  REACTIONS,
  createEnvelope,
  parseEnvelope,
  serializeEnvelope,
  type PartnerPresence,
  type ProtocolError,
} from '@rasmalai/shared';
import type { TokenVerifier } from '../auth/tokenVerifier';
import { logger } from '../logger';
import { SessionError, type SessionRegistry } from '../modules/sessions/sessionRegistry';
import { SocketRegistry } from './socketRegistry';

/** Application close codes. 4000-4999 is the range reserved for private use. */
export const WS_CLOSE = {
  unauthenticated: 4401,
  authTimeout: 4408,
  sessionExpired: 4402,
} as const;

const authenticatePayload = z.object({ accessToken: z.string().min(1).max(8192) });
const sessionFrame = z.object({ sessionId: z.string().min(1).max(64) });
const reactionFrame = sessionFrame.extend({ reaction: z.enum(REACTIONS) });
// `action` is deliberately unvalidated here. Its shape belongs to the game module, which validates
// it before it touches any state; a platform that also had an opinion would need editing per game.
const actionFrame = sessionFrame.extend({ action: z.unknown() });
const leaveRespondFrame = sessionFrame.extend({ accept: z.boolean() });

/**
 * Ceilings on the frames a person can send as fast as they can tap
 * (`docs/07_SECURITY_PRIVACY.md`). Generous enough for genuine spamming of ❤️ at your partner or
 * a panicked double tap, low enough that neither can be used to flood the other side.
 */
const REACTION_LIMIT = 10;
const ACTION_LIMIT = 30;
const RATE_WINDOW_MS = 5_000;

/** Anything wilder than this is a stalled heartbeat, not a slow connection. */
const MAX_HALF_RTT_MS = 1_000;

/** A fixed window, reset lazily on use. */
interface Meter {
  windowStart: number;
  count: number;
}

function exceeds(meter: Meter, limit: number, now: number): boolean {
  if (now - meter.windowStart > RATE_WINDOW_MS) {
    meter.windowStart = now;
    meter.count = 0;
  }
  meter.count += 1;
  return meter.count > limit;
}

interface SocketState {
  userId: string | undefined;
  /** Epoch ms when the presented access token expires. */
  expiresAt: number | undefined;
  isAlive: boolean;
  authTimer: NodeJS.Timeout | undefined;
  /** When the outstanding ping went out, for the round-trip measurement. */
  pingSentAt: number | undefined;
  /**
   * Smoothed one-way delay to this socket, in ms, or null before the first pong.
   *
   * Measured from the server's own heartbeat and never told to the client, because this number
   * decides who won a round: a client that could report its own latency could report a better one.
   */
  halfRttMs: number | null;
  reactions: Meter;
  actions: Meter;
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
  /** Live sessions. Without one, the socket still authenticates but carries no game traffic. */
  sessions?: SessionRegistry;
  /**
   * Resolves the caller's partner, so coming online can be announced to the one person allowed to
   * know. Presence is couple-scoped like everything else; nobody else is ever told.
   */
  partnerOf?: (userId: string) => Promise<string | null>;
  /**
   * Builds the snapshot a socket is handed right after it authenticates: who its own partner is and
   * whether they are online right now. Without this there would be no way to answer "where do things
   * stand" for a socket that has just opened — a stream of `partner.online`/`partner.offline`
   * transitions only ever describes a change, never a starting point.
   */
  presenceSnapshotFor?: (userId: string) => Promise<PartnerPresence>;
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
    sessions,
    partnerOf,
    presenceSnapshotFor,
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

      // Asked before adding: a person holding two tabs is already online, and their second socket
      // is not an arrival. Presence is per person, not per socket.
      const wasOnline = registry.isOnline(user.userId);
      state.userId = user.userId;
      state.expiresAt = user.expiresAt;
      registry.add(user.userId, socket);

      send(socket, EVENTS.connection.authenticated, { userId: user.userId }, requestId);
      logger.debug({ userId: user.userId }, 'socket authenticated');

      // An immediate round-trip measurement, rather than waiting up to a heartbeat for the first
      // one. A game can start within seconds of the page loading, and latency compensation with no
      // sample yet is no compensation at all.
      probe(socket, state);

      // The whole answer, not just a transition — sent on this connection and again on every
      // reconnect, since re-authenticating runs this same path. This is what a fresh socket needs
      // instead of a REST fetch, and what a socket coming back after a drop needs instead of a
      // resync call: the same handshake that recreates the connection also recreates the snapshot.
      if (presenceSnapshotFor) {
        void presenceSnapshotFor(user.userId)
          .then((snapshot) => send(socket, EVENTS.presence.partnerSnapshot, snapshot))
          .catch((error: unknown) => {
            logger.warn({ err: error, userId: user.userId }, 'could not send partner presence snapshot');
          });
      }

      // If they are in a game, they are told where it stands before they ask.
      //
      // Somebody who refreshed on their dashboard mid-match has two minutes to get back and nothing
      // that would tell them so: they are not on the game's page, so nothing they load fetches it,
      // and the server only broadcasts on transitions — of which their reconnection is not one,
      // because they are still not at the table. This frame is the only thing that reaches them,
      // and losing a match without ever being told it was happening is the outcome it exists to
      // prevent.
      const sessionId = sessions?.sessionIdForUser(user.userId);
      if (sessionId !== undefined && sessionId !== null) {
        send(socket, EVENTS.lobby.joined, {
          session: sessions!.viewFor(sessionId, user.userId),
        });
      }

      if (!wasOnline) announcePresence(user.userId, true);
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

    const userId = state.userId;

    // Only the game frames need a session registry. An unrecognised type is still an unrecognised
    // type whether or not one is wired, and must not be reported as a missing session.
    const isSessionFrame: boolean = (
      [
        EVENTS.lobby.join,
        EVENTS.lobby.away,
        EVENTS.lobby.playerReady,
        EVENTS.lobby.playerUnready,
        EVENTS.lobby.leave,
        EVENTS.lobby.leaveRequest,
        EVENTS.lobby.leaveRespond,
        EVENTS.game.actionRequest,
        EVENTS.reaction.sent,
      ] as string[]
    ).includes(type);

    if (isSessionFrame && !sessions) {
      send(
        socket,
        EVENTS.error,
        { code: 'session_not_found', message: 'No game is running.' },
        requestId,
      );
      return;
    }

    try {
      switch (type) {
        case EVENTS.lobby.join: {
          const frame = sessionFrame.safeParse(payload);
          if (!frame.success) return invalidPayload(socket, requestId);
          // The registry decides whether this person belongs in that session; knowing the id
          // grants nothing (docs/07: never trust a socket because it knows a session id).
          //
          // Joining also *marks them present*, which is what closes a reconnect window. Being on
          // the page is the half of presence a socket cannot observe on its own.
          send(
            socket,
            EVENTS.lobby.joined,
            { session: sessions!.join(frame.data.sessionId, userId) },
            requestId,
          );
          return;
        }

        case EVENTS.lobby.away: {
          const frame = sessionFrame.safeParse(payload);
          if (!frame.success) return invalidPayload(socket, requestId);
          // They navigated somewhere else in the app. The socket stays open — P-7 wants it open —
          // but they are no longer at the table, and mid-match that starts the clock.
          sessions!.markAway(frame.data.sessionId, userId);
          return;
        }

        case EVENTS.lobby.leaveRequest: {
          const frame = sessionFrame.safeParse(payload);
          if (!frame.success) return invalidPayload(socket, requestId);
          sessions!.requestLeave(frame.data.sessionId, userId);
          return;
        }

        case EVENTS.lobby.leaveRespond: {
          const frame = leaveRespondFrame.safeParse(payload);
          if (!frame.success) return invalidPayload(socket, requestId);
          sessions!.respondToLeave(frame.data.sessionId, userId, frame.data.accept);
          return;
        }

        case EVENTS.lobby.playerReady:
        case EVENTS.lobby.playerUnready: {
          const frame = sessionFrame.safeParse(payload);
          if (!frame.success) return invalidPayload(socket, requestId);
          sessions!.setReady(frame.data.sessionId, userId, type === EVENTS.lobby.playerReady);
          return;
        }

        case EVENTS.lobby.leave: {
          const frame = sessionFrame.safeParse(payload);
          if (!frame.success) return invalidPayload(socket, requestId);
          sessions!.leave(frame.data.sessionId, userId);
          return;
        }

        case EVENTS.game.actionRequest: {
          const frame = actionFrame.safeParse(payload);
          if (!frame.success) return invalidPayload(socket, requestId);

          const receivedAt = Date.now();
          if (exceeds(state.actions, ACTION_LIMIT, receivedAt)) {
            send(
              socket,
              EVENTS.error,
              { code: 'rate_limited', message: 'Slow down a moment.' },
              requestId,
            );
            return;
          }

          // The two numbers a competitive game is scored on, and both are the server's own.
          // `receivedAt` is when the frame actually landed here; the compensation is what the
          // server measured of this socket's own round trip. The client asserts neither.
          sessions!.submitAction(frame.data.sessionId, userId, frame.data.action, {
            receivedAt,
            compensationMs: Math.min(state.halfRttMs ?? 0, MAX_HALF_RTT_MS),
          });
          return;
        }

        case EVENTS.reaction.sent: {
          const frame = reactionFrame.safeParse(payload);
          if (!frame.success) return invalidPayload(socket, requestId);

          if (exceeds(state.reactions, REACTION_LIMIT, Date.now())) {
            send(
              socket,
              EVENTS.error,
              { code: 'rate_limited', message: 'Easy on the emoji.' },
              requestId,
            );
            return;
          }

          sessions!.react(frame.data.sessionId, userId, frame.data.reaction);
          return;
        }

        default:
          // An unknown frame is an error rather than a silent no-op, so client bugs surface
          // immediately rather than looking like the server ignoring them.
          send(
            socket,
            EVENTS.error,
            { code: 'invalid_action', message: 'Unknown message type.' },
            requestId,
          );
      }
    } catch (error) {
      if (error instanceof SessionError) {
        // Stamped with the session it was about, from the frame we were answering.
        //
        // One socket serves the whole app, so an error with no session on it is an error the client
        // cannot place: leaving a game sends one last frame about it, that frame loses its race with
        // the teardown, and the bare `session_not_found` that comes back lands on whatever screen is
        // open by then — routinely a *different*, perfectly healthy game. Naming the session is what
        // lets the client throw it away.
        const frame = sessionFrame.safeParse(payload);
        send(
          socket,
          EVENTS.error,
          {
            code: error.code,
            message: error.message,
            ...(frame.success ? { sessionId: frame.data.sessionId } : {}),
          },
          requestId,
        );
        return;
      }
      throw error;
    }
  }

  function invalidPayload(socket: WebSocket, requestId?: string): void {
    send(
      socket,
      EVENTS.error,
      { code: 'invalid_payload', message: 'That message was not shaped right.' },
      requestId,
    );
  }

  /**
   * Tells a person's session and their partner that they have come or gone.
   *
   * Fired only on the transitions that matter — first socket in, last socket out — so opening a
   * second tab never reads as a reconnection.
   *
   * The partner's frame is `partner.online` / `partner.offline`, which is deliberately not the
   * `player.*` family the session uses. This one reaches somebody with no game running at all, and
   * carries a person rather than a session view; sharing a name meant every listener had to guess
   * which kind it was holding, and each of them guessed by dropping the frame on the floor.
   */
  function announcePresence(userId: string, online: boolean): void {
    sessions?.handlePresence(userId, online);

    void partnerOf?.(userId)
      .then((partnerId) => {
        if (!partnerId) return;
        const type = online ? EVENTS.presence.partnerOnline : EVENTS.presence.partnerOffline;
        for (const partnerSocket of registry.socketsFor(partnerId)) {
          if (partnerSocket.readyState === partnerSocket.OPEN) {
            partnerSocket.send(serializeEnvelope(createEnvelope(type, { userId, online })));
          }
        }
      })
      .catch((error: unknown) => {
        logger.warn({ err: error, userId }, 'could not announce presence to partner');
      });
  }

  /** Starts a round-trip measurement. The reply lands in the `pong` handler below. */
  function probe(socket: WebSocket, state: SocketState): void {
    if (socket.readyState !== socket.OPEN) return;
    state.pingSentAt = Date.now();
    socket.ping();
  }

  wss.on('connection', (socket: WebSocket) => {
    const state: SocketState = {
      userId: undefined,
      expiresAt: undefined,
      isAlive: true,
      authTimer: undefined,
      pingSentAt: undefined,
      halfRttMs: null,
      reactions: { windowStart: 0, count: 0 },
      actions: { windowStart: 0, count: 0 },
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

      if (state.pingSentAt === undefined) return;
      const sample = (Date.now() - state.pingSentAt) / 2;
      state.pingSentAt = undefined;

      // Smoothed rather than replaced, so one badly timed sample — a garbage collection pause, a
      // phone waking up — does not decide the next round. Weighted towards history for the same
      // reason.
      state.halfRttMs =
        state.halfRttMs === null ? sample : state.halfRttMs * 0.7 + sample * 0.3;
    });

    socket.on('message', (raw) => {
      void handleMessage(socket, state, raw).catch((error: unknown) => {
        logger.error({ err: error }, 'failed handling socket message');
        send(socket, EVENTS.error, { code: 'internal_error', message: 'Something went wrong.' });
      });
    });

    socket.on('close', () => {
      if (state.authTimer) clearTimeout(state.authTimer);
      if (state.userId === undefined) return;

      const userId = state.userId;
      registry.remove(userId, socket);
      // Removed first, so "are they still here?" is answered against the truth. Only the last
      // socket closing is a disconnection; the others are just tabs.
      if (!registry.isOnline(userId)) announcePresence(userId, false);
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
      // Doubles as the latency sample that keeps the compensation estimate fresh.
      probe(socket, state);
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
