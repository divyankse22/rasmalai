'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENTS, type PartnerPresence, type PresencePayload } from '@rasmalai/shared';
import { getFromApi } from '@/lib/clientApi';
import { useRealtime, useRealtimeEvent, useResyncOnReconnect } from '@/realtime/RealtimeProvider';

/**
 * Whether your partner is here, wherever you happen to be standing in the app.
 *
 * Three sources, in order of how much they are trusted:
 *
 * 1. **The socket**, which announces `partner.online` / `partner.offline` the instant either
 *    happens. This is the live feed, and it is why `docs/02_ARCHITECTURE.md` can forbid polling for
 *    presence — a transition arrives in milliseconds, not on the next tick of a clock.
 * 2. **A fetch on mount**, because a stream of transitions cannot tell a page that has just loaded
 *    where things already stand.
 * 3. **A fetch every fifteen seconds**, as a backstop and nothing more. A frame missed while a
 *    phone was asleep would otherwise leave the dot wrong until the next time somebody signed in
 *    or out, and a dot that is quietly wrong is worse than no dot.
 *
 * One hook rather than one per consumer, so the header and the Play button cannot show two
 * different answers to the same question.
 */

/** Long enough to be a safety net, short enough that a missed frame is not on screen for long. */
const BACKSTOP_MS = 15_000;

export interface PartnerPresenceState {
  /** Null until the first answer arrives — not the same as "offline", and must not render as it. */
  online: boolean | null;
  partner: PartnerPresence['partner'];
  /** Asks the server right now, and answers. Used at the moment somebody presses Play. */
  refresh(): Promise<boolean | null>;
}

export function usePartnerPresence(): PartnerPresenceState {
  const { status } = useRealtime();
  const [online, setOnline] = useState<boolean | null>(null);
  const [partner, setPartner] = useState<PartnerPresence['partner']>(null);

  // Held in a ref as well as in state so the socket listener can compare against the current
  // partner without resubscribing every time the answer changes.
  const partnerRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await getFromApi<PartnerPresence>('/api/presence/partner');
    // A failed request says nothing about whether they are online, so it changes nothing — and it
    // answers `null` rather than `false`. Inventing "offline" out of our own bad network would stop
    // somebody playing against a partner who is sitting right there.
    if (!data) return null;

    partnerRef.current = data.partner?.id ?? null;
    setPartner(data.partner);
    setOnline(data.online);
    return data.online;
  }, []);

  useEffect(() => {
    let disposed = false;
    const tick = () => {
      if (!disposed) void refresh();
    };

    tick();
    const timer = setInterval(tick, BACKSTOP_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [refresh]);

  // A socket that dropped missed every transition in between, so the answer is asked for again
  // rather than trusted.
  useResyncOnReconnect(() => void refresh());

  useRealtimeEvent(
    useCallback((envelope) => {
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

  return {
    // Our own socket being down makes every answer we hold unverifiable, and an unverifiable
    // "offline" is a lie about somebody who may well be sitting there waiting. It reads as unknown
    // until we can see for ourselves again.
    online: status === 'connected' ? online : null,
    partner,
    refresh,
  };
}
