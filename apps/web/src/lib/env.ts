/**
 * Browser-visible configuration.
 *
 * These are read as literal `process.env.NEXT_PUBLIC_*` expressions so the bundler can inline them.
 * Nothing secret belongs here: everything in this file ships to the browser by definition.
 */
function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill in the Supabase values.`);
  }
  return value;
}

export const publicEnv = {
  supabaseUrl: required(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: required(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ),
  websocketUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws',
};
