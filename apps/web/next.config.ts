import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

// Next only reads env files from its own directory, but the backend and the web app share one
// root .env so a value can never drift between them. Loading it here, before the build reads
// process.env, keeps that single file as the only place secrets and URLs are configured.
loadDotenv({ path: resolve(repoRoot, '.env'), quiet: true });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Both workspace packages ship TypeScript source rather than a build step.
  transpilePackages: ['@rasmalai/shared', '@rasmalai/games'],
  // Trace from the monorepo root, so an unrelated lockfile elsewhere on the machine
  // cannot be mistaken for this workspace's root during a build.
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
