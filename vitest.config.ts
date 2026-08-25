import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Two suites, split by file extension.
 *
 *   *.test.ts   → node    — pure logic: server routes, game rules, decision modules.
 *   *.test.tsx  → jsdom   — component behaviour in `apps/web`.
 *
 * The extension is the routing signal, so a test lands in the right environment by being named
 * correctly and nothing else. This matters: the previous single-project config included only
 * `*.test.ts`, so a `.tsx` test would have been collected by no project at all and silently never
 * run — green suite, zero coverage.
 *
 * The jsdom half exists to protect a visual restyle. The tests assert roles, accessible names and
 * behaviour, never class names, so they must stay byte-identical while the styling underneath them
 * changes. A component test that needs editing to go green means behaviour moved, not styling.
 *
 * (This file used to say the web app had no DOM harness and did not need one. That was true while
 * the only thing worth testing there was pure decision logic. It stopped being true when a restyle
 * needed a regression net.)
 */

const webSrc = fileURLToPath(new URL('./apps/web/src', import.meta.url));

export default defineConfig({
  test: {
    // Kept at root: `npm run test:coverage` drives this through CLI flags, and coverage is a
    // whole-run concern rather than a per-project one.
    coverage: {
      provider: 'v8',
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'apps/server/src/**/*.test.ts',
            'apps/web/src/**/*.test.ts',
            'packages/*/src/**/*.test.ts',
          ],
          // Integration suites talk to a real Postgres and a real Supabase project. They are
          // opt-in through `npm run test:integration`, so `npm test` stays runnable with no
          // database at all.
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
          // 138 of these tests build an Express app and bind a real TCP listener per test, across
          // eight files. The whole suite finishes in about three seconds, but vitest's 5s default
          // leaves no headroom: under load — `npm run verify` running typecheck first, or coverage
          // instrumentation — a single `listen()` plus round trip can cross it, and the suite
          // fails somewhere different each time. Nothing here legitimately takes ten seconds, so
          // this only costs time when a test is already hung.
          testTimeout: 20_000,
          passWithNoTests: false,
        },
      },
      {
        // `apps/web/tsconfig.json` sets `"jsx": "preserve"` for Next, which means esbuild would
        // hand vitest untransformed JSX and every .tsx test would fail to parse. Overriding the
        // transform here is enough; @vitejs/plugin-react would also work but currently demands
        // vite 8 while this repo is on 7.
        esbuild: {
          jsx: 'automatic',
          jsxImportSource: 'react',
        },
        // Vitest does not read tsconfig `paths`, and `apps/web` imports through `@/` everywhere.
        resolve: {
          alias: { '@': webSrc },
        },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.tsx'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          setupFiles: ['./apps/web/src/test/setup.ts'],
          testTimeout: 10_000,
          passWithNoTests: false,
          restoreMocks: true,
          // Both workspace packages ship raw TypeScript through `exports` with no build step.
          // Vitest usually inlines symlinked workspace deps on its own; pin it rather than rely
          // on the heuristic.
          server: { deps: { inline: ['@rasmalai/shared', '@rasmalai/games'] } },
        },
      },
    ],
  },
});
