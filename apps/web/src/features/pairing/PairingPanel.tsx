'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { EVENTS } from '@rasmalai/shared';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { PersonName, type Gender } from '@/design-system/PersonName';
import { avatarGlyph } from '@/features/onboarding/avatars';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useRealtimeConnection } from '@/realtime/useRealtimeConnection';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface PairingRequestView {
  id: string;
  otherUser: { id: string; actualName: string; nickname: string; avatarKey: string; gender: Gender };
}

const PAIRING_EVENTS = new Set<string>([
  EVENTS.pairing.requestCreated,
  EVENTS.pairing.requestAccepted,
  EVENTS.pairing.requestRejected,
  EVENTS.pairing.requestCancelled,
]);

export function PairingPanel({
  pairingCode,
  incoming,
  outgoing,
}: {
  pairingCode: string;
  incoming: PairingRequestView[];
  outgoing: PairingRequestView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  // A request arriving, or being answered, changes what this page should show. Refreshing the
  // server component is enough - no duplicate client-side copy of the state to keep in sync.
  const onEvent = useCallback(
    (envelope: { type: string }) => {
      if (PAIRING_EVENTS.has(envelope.type)) router.refresh();
    },
    [router],
  );
  const status = useRealtimeConnection({ onEvent });

  // Events that fired while this device was asleep or offline are simply gone, so a screen that
  // was disconnected can be showing a request the other device already answered. Resyncing on
  // reconnect closes that window without any polling.
  const wasOffline = useRef(false);
  useEffect(() => {
    if (status === 'connected' && wasOffline.current) {
      wasOffline.current = false;
      router.refresh();
    } else if (status === 'offline') {
      wasOffline.current = true;
    }
  }, [status, router]);

  async function post(path: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return false;
      }

      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        router.refresh();
        return true;
      }

      const payload = (await response.json()) as { error?: { message?: string } };
      setError(payload.error?.message ?? 'That did not work.');
      return false;
    } catch {
      setError('Could not reach Rasmalai. Check your connection.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Hold the form element now: the browser clears `currentTarget` once dispatch finishes, so
    // reading it after the await below would be null and throw on .reset().
    const form = event.currentTarget;
    const code = String(new FormData(form).get('code') ?? '');

    if (await post('/api/pairing/requests', { code })) form.reset();
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the code is on screen to read anyway.
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {incoming.length > 0 && (
        <Card className="flex flex-col gap-4 border-berry">
          <h2 className="font-display text-lg font-semibold text-ink">
            {incoming.length === 1 ? 'Someone wants to pair' : 'Pairing requests'}
          </h2>
          {incoming.map((request) => (
            <div key={request.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-11 items-center justify-center rounded-pill bg-blush text-2xl"
                  aria-hidden="true"
                >
                  {avatarGlyph(request.otherUser.avatarKey)}
                </span>
                <p className="text-ink">
                  <PersonName
                    name={request.otherUser.actualName}
                    gender={request.otherUser.gender}
                  />{' '}
                  wants to pair with you ❤️
                </p>
              </div>
              <p className="text-sm text-muted">
                Pairing is permanent — you two stay linked from here on.
              </p>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={busy}
                  onClick={() =>
                    void post(`/api/pairing/requests/${request.id}/respond`, { accept: true })
                  }
                >
                  Accept ❤️
                </Button>
                <Button
                  variant="soft"
                  className="flex-1"
                  disabled={busy}
                  onClick={() =>
                    void post(`/api/pairing/requests/${request.id}/respond`, { accept: false })
                  }
                >
                  Not now
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card className="flex flex-col items-center gap-3 text-center">
        <h2 className="font-display text-lg font-semibold text-ink">Your pairing code</h2>
        <p className="text-muted">Share this with your person so they can find you.</p>
        <p className="rounded-soft bg-cream px-5 py-3 font-display text-3xl font-bold tracking-[0.2em] text-berry">
          {pairingCode}
        </p>
        <Button variant="soft" onClick={() => void copyCode()}>
          {copied ? 'Copied ✨' : 'Copy code'}
        </Button>
      </Card>

      {incoming.length > 0 ? (
        // Entering their code here could only ever fail: they have already asked, so the one
        // useful action is the Accept button above. Offering the form anyway is a trap.
        <p className="px-4 text-center text-sm text-muted">
          No need for a code — {incoming[0]?.otherUser.actualName} already found you. Just accept
          above.
        </p>
      ) : outgoing.length > 0 ? (
        <Card className="flex flex-col items-center gap-3 text-center">
          <p className="text-ink">
            Waiting for{' '}
            <PersonName
              name={outgoing[0]?.otherUser.actualName ?? ''}
              gender={outgoing[0]?.otherUser.gender}
            />{' '}
            to accept…
          </p>
          <p className="text-sm text-muted">
            It is on their screen now — only they can accept it. This page updates itself the
            moment they do.
          </p>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void post(`/api/pairing/requests/${outgoing[0]?.id}/cancel`, {})}
          >
            Cancel request
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-semibold text-ink">Got their code?</h2>
          <form className="flex flex-col gap-3" onSubmit={(event) => void submitCode(event)}>
            <input
              name="code"
              placeholder="ABCD1234"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={16}
              required
              className="min-h-11 w-full rounded-soft border border-line bg-cream px-4 text-center font-display text-xl tracking-[0.2em] text-ink uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-berry"
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send pairing request'}
            </Button>
          </form>
        </Card>
      )}

      {error && (
        <p className="text-center text-sm text-berry" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
