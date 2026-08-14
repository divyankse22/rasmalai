import { createSupabaseServerClient } from '@/lib/supabase/server';

export type Gender = 'male' | 'female';

export interface UserProfile {
  id: string;
  actualName: string;
  nickname: string;
  birthYear: number;
  avatarKey: string;
  gender: Gender;
  partnerLabelName: string;
  partnerLabelNickname: string;
  firstMetDate: string;
  locationType: string;
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

/** The signed-in user's profile, or null when they have not been through onboarding yet. */
export async function getMyProfile(): Promise<UserProfile | null> {
  const response = await fetchFromApi('/api/me');
  if (!response.ok) return null;

  const body = (await response.json()) as { profile: UserProfile | null };
  return body.profile;
}

export interface PairingPerson {
  id: string;
  actualName: string;
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

export async function getPairingState(): Promise<PairingState | null> {
  const response = await fetchFromApi('/api/pairing');
  if (!response.ok) return null;
  return (await response.json()) as PairingState;
}
