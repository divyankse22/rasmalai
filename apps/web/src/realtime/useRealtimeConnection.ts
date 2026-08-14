'use client';

import { useEffect, useRef, useState } from 'react';
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

export interface RealtimeOptions {
  /** Called for every frame the server sends, once the socket is authenticated. */
  onEvent?: (envelope: Envelope) => void;
}

const BASE_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

/**
 * Holds the authenticated socket open for as long as the app is on screen.
 *
 * `docs/02_ARCHITECTURE.md` forbids polling for presence, so this connection is what tells the
 * server we are here - which means it lives at the dashboard level, not inside a game. Reconnection
 * backs off exponentially with jitter so a backend restart does not produce a stampede.
 */
export function useRealtimeConnection({ onEvent }: RealtimeOptions = {}): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);

  // Held in a ref so a changing callback never tears down and rebuilds the socket. Updated in an
  // effect rather than during render, which concurrent rendering does not allow.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

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

        onEventRef.current?.(parsed.envelope);
      });

      socket.addEventListener('close', () => {
        socketRef.current = null;
        if (disposed) return;

        setStatus('offline');
        const delay = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
        attempt += 1;
        retryTimer = setTimeout(() => {
          setStatus('connecting');
          void connect();
        }, delay + Math.random() * 250);
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

  return status;
}
