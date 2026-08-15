'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/design-system/Button';
import { postToApi } from '@/lib/clientApi';

/**
 * Asks a partner to play one particular game.
 *
 * Sending a second invitation quietly replaces the first (ADR-010) — that happens in one
 * transaction on the server, so this button never has to think about it. The partner sees the new
 * one and the old one disappears from both screens.
 */
export function InviteButton({ gameSlug, gameName }: { gameSlug: string; gameName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function invite() {
    setBusy(true);
    setError(undefined);

    const result = await postToApi('/api/invitations', { gameSlug });
    setBusy(false);

    if (result.ok) {
      // The invitation sheet is driven by the socket event, which both partners get. Refreshing
      // keeps the rest of the page honest without a second source of truth for the invitation.
      router.refresh();
      return;
    }

    // Already mid-game: the way back in is the resume button, not a second invitation.
    setError(result.error.message);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        className="min-h-9 px-4 text-sm"
        disabled={busy}
        aria-label={`Ask them to play ${gameName}`}
        onClick={() => void invite()}
      >
        {busy ? 'Asking…' : 'Play'}
      </Button>
      {error && (
        <p className="max-w-40 text-right text-xs text-berry" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
