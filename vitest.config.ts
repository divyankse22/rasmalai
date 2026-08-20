import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/server/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    // Integration suites talk to a real Postgres and a real Supabase project. They are opt-in
    // through `npm run test:integration`, so `npm test` stays runnable with no database at all.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    passWithNoTests: false,
  },
});
