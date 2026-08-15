'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface ApiFailure {
  message: string;
  /** The backend's machine-readable reason, when it gave one. */
  reason?: string;
  status?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

/**
 * Calls the backend from the browser with the signed-in user's access token.
 *
 * The token is attached here and nowhere else, so no component has to know how a session is
 * stored. The backend verifies it and derives the user id itself — the browser never says who it
 * is (`docs/02_ARCHITECTURE.md` section 8).
 *
 * Returns a result rather than throwing: a refused action is an ordinary outcome with a message
 * meant for a person, not an exception.
 */
export async function postToApi<T>(path: string, body: unknown = {}): Promise<ApiResult<T>> {
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return { ok: false, error: { message: 'Your session ended. Sign in again.', status: 401 } };
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; reason?: string };
    };

    if (!response.ok) {
      const reason = payload.error?.reason;
      return {
        ok: false,
        error: {
          message: payload.error?.message ?? 'That did not work.',
          // Spread rather than assigned: `exactOptionalPropertyTypes` distinguishes an absent
          // property from one explicitly set to undefined, and this one is genuinely absent.
          ...(reason === undefined ? {} : { reason }),
          status: response.status,
        },
      };
    }

    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, error: { message: 'Could not reach Rasmalai. Check your connection.' } };
  }
}

/** The same, for reads. */
export async function getFromApi<T>(path: string): Promise<T | null> {
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;

    const response = await fetch(`${API_BASE}${path}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    });
    if (!response.ok) return null;

    return (await response.json()) as T;
  } catch {
    return null;
  }
}
