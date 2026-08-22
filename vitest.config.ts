import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/server/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    // Integration suites talk to a real Postgres and a real Supabase project. They are opt-in
    // through `npm run test:integration`, so `npm test` stays runnable with no database at all.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    // 138 of these tests build an Express app and bind a real TCP listener per test, across eight
    // files. The whole suite finishes in about three seconds, but vitest's 5s default leaves no
    // headroom: under load — `npm run verify` running typecheck first, or coverage instrumentation
    // — a single `listen()` plus round trip can cross it, and the suite fails somewhere different
    // each time. Nothing here legitimately takes ten seconds, so this only costs time when a test
    // is already hung.
    testTimeout: 20_000,
    passWithNoTests: false,
  },
});
