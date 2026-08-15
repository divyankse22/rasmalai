import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages are source-only, so they must be bundled rather than resolved at runtime.
  // Only the entrypoints the server actually imports come along: `@rasmalai/games/server` pulls in
  // the rulebooks, and nothing here reaches a renderer.
  noExternal: ['@rasmalai/shared', '@rasmalai/games'],
});
