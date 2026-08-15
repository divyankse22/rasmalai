'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  EVENTS,
  createEnvelope,
  parseEnvelope,
  serializeEnvelope,
  type Envelope,
} from '@rasmalai/shared';
import { publicEnv } from '@/lib/env';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type ConnectionStatus = 'connecting' | 'connected' | 'offline';

type Listener = (envelope: Envelope) => void;

interface RealtimeContextValue {
  status: ConnectionStatus;
  /** Fire-and-forget. Frames sent while offline are dropped, not queued — see below. */
  send(type: string, payload: unknown): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const BASE_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

/**
 * One socket for the whole signed-in app.
 *
 * It lives at the layout level, not inside a page, because `docs/02_ARCHITECTURE.md` forbids
 * polling for presence and P-7 wants invitations to arrive wherever the person happens to be. It is
 * also a provider rather than a hook each component calls: two components calling the same hook
 * would open two sockets, and the server would count that as two devices.
 *
 * **Frames sent while offline are dropped rather than queued.** A queue would replay stale intents
 * into a game that has moved on — a "ready" from thirty seconds ago is not a ready now. Every
 * consumer instead resyncs when the status returns to `connected`, which is the only version of
 * the state that can be trusted anyway.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Set<Listener>());

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const send = useCallback((type: string, payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(serializeEnvelope(createEnvelope(type, payload)));
  }, []);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      if (disposed) return;

      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (disposed) return;
      if (!session) {
        setStatus('offline');
        return;
      }

      const socket = new WebSocket(publicEnv.websocketUrl);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        // Identity is proven in the first frame, never in the query string.
        socket.send(
          serializeEnvelope(
            createEnvelope(EVENTS.connection.authenticate, { accessToken: session.access_token }),
          ),
        );
      });

      socket.addEventListener('message', (event) => {
        const parsed = parseEnvelope(String(event.data));
        if (!parsed.ok) return;

        if (parsed.envelope.type === EVENTS.connection.authenticated) {
          attempt = 0;
          setStatus('connected');
          return;
        }

        // A listener throwing must not stop the others from hearing the frame.
        for (const listener of [...listenersRef.current]) {
          try {
            listener(parsed.envelope);
          } catch {
            // Deliberately swallowed: one broken consumer is not the socket's problem.
          }
        }
      });

      socket.addEventListener('close', () => {
        socketRef.current = null;
        if (disposed) return;

        setStatus('offline');
        const delay = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
        attempt += 1;
        // Jitter, so a backend restart does not bring every client back at the same instant.
        retryTimer = setTimeout(
          () => {
            setStatus('connecting');
            void connect();
          },
          delay + Math.random() * 250,
        );
      });
    }

    void connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({ status, send, subscribe }),
    [status, send, subscribe],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime must be used inside a RealtimeProvider');
  return value;
}

/**
 * Subscribes to socket frames for as long as the component is mounted.
 *
 * The listener is held in a ref so an inline callback does not resubscribe on every render, which
 * would otherwise churn the listener set on every keystroke elsewhere in the tree.
 */
export function useRealtimeEvent(listener: Listener): void {
  const { subscribe } = useRealtime();
  const listenerRef = useRef(listener);

  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(() => subscribe((envelope) => listenerRef.current(envelope)), [subscribe]);
}

/**
 * Runs `onReconnect` when the socket comes back after having been away.
 *
 * Events that fired while a device was asleep are simply gone, so anything holding realtime state
 * has to resync rather than trust what it was showing. Not called on the first connection — there
 * is nothing to catch up on yet.
 */
export function useResyncOnReconnect(onReconnect: () => void): void {
  const { status } = useRealtime();
  const wasOffline = useRef(false);
  const callbackRef = useRef(onReconnect);

  useEffect(() => {
    callbackRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    if (status === 'connected' && wasOffline.current) {
      wasOffline.current = false;
      callbackRef.current();
    } else if (status === 'offline') {
      wasOffline.current = true;
    }
  }, [status]);
}
