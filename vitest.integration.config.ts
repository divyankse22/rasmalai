import { defineConfig } from 'vitest/config';

/**
 * The opt-in half of the suite: real Postgres, real Supabase auth users, real session registry.
 *
 * Single-threaded on purpose. Every suite creates a couple and plays matches through it, and
 * `matches_one_active_per_couple` plus the shared rate limits make concurrent runs against one
 * project flaky in ways that have nothing to do with the code under test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/server/src/**/*.integration.test.ts'],
    // A match plus its cleanup crosses the Atlantic several times.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    passWithNoTests: false,
  },
});
