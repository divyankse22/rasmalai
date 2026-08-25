import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Where Google sends the browser back to. Exchanges the one-time code for a session and writes the
 * httpOnly cookies. Failures land back on the landing page with a short reason code - never with a
 * provider error message, which can carry detail we would rather not put in a URL bar.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  if (searchParams.get('error')) {
    return NextResponse.redirect(`${origin}/?error=declined`);
  }

  const code = searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(`${origin}/?error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/?error=sign_in_failed`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
