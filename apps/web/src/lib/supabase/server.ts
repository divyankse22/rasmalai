import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

/**
 * Supabase client for server components, route handlers and server actions.
 *
 * Always pair this with `auth.getUser()` rather than `auth.getSession()` on the server:
 * `getUser()` validates the token with the auth server, while `getSession()` trusts whatever is in
 * the cookie. Only the former is safe to make an authorization decision on.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot write cookies. The proxy refreshes the session on every
          // request, so it is safe to ignore this rather than fail the render.
        }
      },
    },
  });
}
