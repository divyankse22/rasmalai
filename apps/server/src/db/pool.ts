import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { logger } from '../logger';

export type Database = pg.Pool;

/**
 * Supabase terminates Postgres TLS with its own private CA ("Supabase Root 2021 CA"), which is not
 * in Node's trust store. The tempting fix - `rejectUnauthorized: false` - would encrypt the
 * connection while accepting *any* certificate, which is no protection at all on the link carrying
 * every couple's data. So we pin their root instead and keep full verification on.
 *
 * Replace this file with the copy from your project's Connect panel to be certain of its
 * provenance; `openssl x509 -in supabase/prod-ca.crt -noout -fingerprint -sha256` must match.
 */
const CA_PATH = resolve(process.cwd(), '../../supabase/prod-ca.crt');

function readCertificateAuthority(): string {
  try {
    return readFileSync(CA_PATH, 'utf8');
  } catch {
    throw new Error(
      `Could not read the Supabase CA certificate at ${CA_PATH}. Download it from your project's ` +
        'Connect panel and save it there. Refusing to connect without certificate verification.',
    );
  }
}

let pool: pg.Pool | undefined;

export function createPool(connectionString: string): pg.Pool {
  const created = new pg.Pool({
    connectionString,
    ssl: { ca: readCertificateAuthority(), rejectUnauthorized: true },
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
