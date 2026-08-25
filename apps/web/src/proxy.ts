import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// `middleware.ts` was deprecated and renamed to `proxy.ts` in Next.js 16.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Runs on every route except static assets, per Next's recommendation for auth.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
