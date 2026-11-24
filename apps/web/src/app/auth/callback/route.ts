import { redirectAfterAuth } from '@/lib/supabase/redirect';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Exchange the one-time code for a session. Only our own error codes go in the redirect. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const providerError = searchParams.get('error');
  if (providerError) {
    return redirectAfterAuth(
      providerError === 'access_denied' ? '/?error=declined' : '/?error=sign_in_failed',
    );
  }

  const code = searchParams.get('code');
  if (!code) return redirectAfterAuth('/?error=missing_code');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return redirectAfterAuth(error ? '/?error=sign_in_failed' : '/dashboard');
}
