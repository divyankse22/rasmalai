import { redirectAfterAuth } from '@/lib/supabase/redirect';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** POST-only, so a prefetch or an image tag can never sign someone out. */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return redirectAfterAuth('/');
}
