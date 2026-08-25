import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** POST-only, so a prefetch or an image tag can never sign someone out. */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  // 303 turns the POST into a GET for the redirect.
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}
