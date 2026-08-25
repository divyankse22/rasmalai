import pg from 'pg';
import { resolveCertificateAuthority } from './certificateAuthority';
import { logger } from '../logger';

export type Database = pg.Pool;

let pool: pg.Pool | undefined;

export function createPool(connectionString: string): pg.Pool {
  const created = new pg.Pool({
    connectionString,
    // Full verification against Supabase's pinned CA. `rejectUnauthorized: false` would keep the
    // connection encrypted while accepting any certificate at all, which is no protection on the
    // link carrying every couple's data.
    ssl: { ca: resolveCertificateAuthority(process.env), rejectUnauthorized: true },
    // Small on purpose: one backend process serving 70-80 concurrent people needs very few
    // connections, and the shared pooler is happier when we are frugal.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  created.on('error', (error) => {
    logger.error({ err: error }, 'idle database client errored');
  });

  return created;
}

/** Process-wide pool, created once on first use. */
export function getPool(connectionString: string): pg.Pool {
  pool ??= createPool(connectionString);
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = undefined;
  await closing.end();
}
