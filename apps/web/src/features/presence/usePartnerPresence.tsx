'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EVENTS, type PartnerPresence, type PresencePayload } from '@rasmalai/shared';
import { useRealtime, useRealtimeEvent } from '@/realtime/RealtimeProvider';

/**
 * Whether your partner is here, wherever you happen to be standing in the app.
 *
 * One shared subscription rather than one per consumer, so the header and the Play button read the
 * same live value instead of each holding an independent copy that could say something different.
 *
 * The server pushes the whole answer — who your partner is and whether they're online — the moment
 * a socket finishes authenticating (`partner.snapshot`), which happens on the first connection and
 * again on every reconnect. After that, only `partner.online` / `partner.offline` transitions
 * arrive, live. There is no fetch, no poll, and nothing to refresh: the same handshake that
 * recreates the connection also recreates the snapshot, so a transition missed while a socket was
 * down cannot leave this quietly wrong for longer than the reconnect itself takes.
 */

export interface PartnerPresenceState {
  /** Null until the first snapshot arrives — not the same as "offline", and must not render as it. */
  online: boolean | null;
  partner: PartnerPresence['partner'];
}

const PartnerPresenceContext = createContext<PartnerPresenceState | null>(null);

export function PartnerPresenceProvider({ children }: { children: ReactNode }) {
  const { status } = useRealtime();
  const [online, setOnline] = useState<boolean | null>(null);
  const [partner, setPartner] = useState<PartnerPresence['partner']>(null);

  // Held in a ref as well as in state so the socket listener can compare against the current
  // partner without resubscribing every time the answer changes.
  const partnerRef = useRef<string | null>(null);

  useRealtimeEvent(
    useCallback((envelope) => {
      if (envelope.type === EVENTS.presence.partnerSnapshot) {
        const payload = envelope.payload as PartnerPresence;
        partnerRef.current = payload.partner?.id ?? null;
        setPartner(payload.partner);
        setOnline(payload.online);
        return;
      }

      if (
        envelope.type !== EVENTS.presence.partnerOnline &&
        envelope.type !== EVENTS.presence.partnerOffline
      ) {
        return;
      }

      const payload = envelope.payload as PresencePayload;
      // Only ever one person this can be about, but checked anyway: a frame about anybody else is a
      // frame we should not be acting on.
      if (partnerRef.current !== null && payload.userId !== partnerRef.current) return;
      setOnline(payload.online);
    }, []),
  );

  const value = useMemo<PartnerPresenceState>(
    () => ({
      // Our own socket being down makes every answer we hold unverifiable, and an unverifiable
      // "offline" is a lie about somebody who may well be sitting there waiting. It reads as unknown
      // until we can see for ourselves again — and the moment we can, a fresh snapshot is already on
      // its way, so it does not stay unknown for long.
      online: status === 'connected' ? online : null,
      partner,
    }),
    [status, online, partner],
  );

  return (
    <PartnerPresenceContext.Provider value={value}>{children}</PartnerPresenceContext.Provider>
  );
}

export function usePartnerPresence(): PartnerPresenceState {
  const value = useContext(PartnerPresenceContext);
  if (!value) {
    throw new Error('usePartnerPresence must be used inside a PartnerPresenceProvider');
  }
  return value;
}
