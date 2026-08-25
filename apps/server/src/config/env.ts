import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// The repository keeps a single .env at the root so both workspaces read the same values.
loadDotenv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

/**
 * Only the variables the current slice actually needs are required here. Slice 2 adds the Supabase
 * block, slice 3 adds DATABASE_URL. Keeping the schema honest means a missing variable fails fast
 * at boot with a readable message instead of surfacing as a confusing runtime error later.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('debug'),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),

  // Deliberately the NEXT_PUBLIC_ variable rather than a duplicate: it is the same project URL,
  // it is public by nature, and one value in one place cannot drift out of sync with itself.
  // Only the public JWKS is read from it - no secret is involved in verifying a token.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),

  DATABASE_URL: z.string().startsWith('postgres', 'must be a postgres connection string'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\n\nSee .env.example.`);
  }

  return parsed.data;
}
