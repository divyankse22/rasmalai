import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { loadEnv } from '../config/env';
import { createPool } from './pool';
import { logger } from '../logger';

/**
 * A deliberately tiny migration runner.
 *
 * The Supabase CLI would also work, but it wants its own login and project link, whereas we already
 * have a verified DATABASE_URL. Applying ordered .sql files inside a transaction and recording them
 * in a table is about forty lines and needs nothing installed, which is the right trade at this size.
 */
export const MIGRATIONS_DIR = resolve(process.cwd(), '../../supabase/migrations');

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  // RLS, deny-all, no policy — the same backstop every table in supabase/migrations/ gets, so the
  // public Supabase key can never read or write migration bookkeeping directly via the REST API.
  await pool.query(`
    create table if not exists public.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
    alter table public.schema_migrations enable row level security;
  `);
}

export async function pendingMigrations(pool: Pool, directory: string): Promise<string[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string }>('select name from public.schema_migrations');
  const applied = new Set(rows.map((row) => row.name));
  return files.filter((file) => !applied.has(file));
}

export async function runMigrations(pool: Pool, directory = MIGRATIONS_DIR): Promise<string[]> {
  await ensureMigrationsTable(pool);
  const pending = await pendingMigrations(pool, directory);

  for (const name of pending) {
    const sql = await readFile(resolve(directory, name), 'utf8');
    const client = await pool.connect();
    try {
      // Each migration is all-or-nothing, so a failure never leaves a half-applied schema.
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into public.schema_migrations (name) values ($1)', [name]);
      await client.query('commit');
      logger.info({ migration: name }, 'applied migration');
    } catch (error) {
      await client.query('rollback');
      throw new Error(`migration ${name} failed: ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  return pending;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);

  try {
    const applied = await runMigrations(pool);
    if (applied.length === 0) logger.info('database already up to date');
    else logger.info({ count: applied.length }, 'migrations complete');
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly, so the functions above stay importable from tests.
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  main().catch((error: unknown) => {
    logger.error({ err: error }, 'migration failed');
    process.exit(1);
  });
}
