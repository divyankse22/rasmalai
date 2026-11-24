import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/games',
  '/onboarding',
  '/pairing',
  '/play',
  '/tournament',
];

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const pendingCookies: Parameters<SetAllCookies>[0] = [];
  const headers = new Headers();
  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, cacheHeaders) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        pendingCookies.push(...cookiesToSet);
        for (const [name, value] of Object.entries(cacheHeaders)) headers.set(name, value);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + '/'),
  );

  // A refresh can happen on the same request that redirects the browser.
  // Send its cookies on the response that will actually reach the visitor.
  let response: NextResponse;
  if (!user && isProtected) {
    response = NextResponse.redirect(new URL('/', request.url), { headers });
  } else if (user && path === '/') {
    response = NextResponse.redirect(new URL('/dashboard', request.url), { headers });
  } else {
    response = NextResponse.next({ request, headers });
  }
  for (const { name, value, options } of pendingCookies) response.cookies.set(name, value, options);
  return response;
}
