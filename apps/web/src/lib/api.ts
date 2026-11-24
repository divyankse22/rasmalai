import type { DashboardPayload } from '@rasmalai/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type Gender = 'male' | 'female';

export interface UserProfile {
  id: string;
  nickname: string;
  birthYear: number;
  avatarKey: string;
  gender: Gender;
  partnerLabelNickname: string;
  /** Null for whoever signed up holding a code: their partner is the author of these two. */
  firstMetDate: string | null;
  locationType: string | null;
  pairingCode: string;
}

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Calls the backend on behalf of the signed-in user, from a server component or route handler.
 *
 * The access token is forwarded rather than re-derived: the backend verifies it itself, so
 * authorization is decided in exactly one place (`docs/13_ARCHITECTURE_PROPOSAL.md` section 2).
 */
export async function fetchFromApi(path: string, init: RequestInit = {}): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session.access_token}` } : {}),
      ...init.headers,
    },
    cache: 'no-store',
  });
}

async function readFromApi<T>(path: string): Promise<T> {
  const response = await fetchFromApi(path);
  if (!response.ok) throw new Error(`Rasmalai API ${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** The signed-in user's profile, or null when they have not been through onboarding yet. */
export async function getMyProfile(): Promise<UserProfile | null> {
  const { profile } = await readFromApi<{ profile: UserProfile | null }>('/api/me');
  return profile;
}

export interface PairingPerson {
  id: string;
  nickname: string;
  avatarKey: string;
  gender: Gender;
}

export interface PairingState {
  couple: {
    id: string;
    firstMetDate: string;
    locationType: string;
    partner: PairingPerson;
  } | null;
  incoming: { id: string; otherUser: PairingPerson }[];
  outgoing: { id: string; otherUser: PairingPerson }[];
}

export function getPairingState(): Promise<PairingState> {
  return readFromApi<PairingState>('/api/pairing');
}

/**
 * Everything the dashboard draws, in one request.
 *
 * The payload type is shared with the backend rather than re-declared here, so a stat that changes
 * shape breaks the build instead of quietly rendering `undefined`.
 */
export function getDashboard(): Promise<DashboardPayload> {
  return readFromApi<DashboardPayload>('/api/dashboard');
}
