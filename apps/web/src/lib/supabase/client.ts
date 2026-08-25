import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/** Supabase client for the browser. Only ever used from client components. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
}
