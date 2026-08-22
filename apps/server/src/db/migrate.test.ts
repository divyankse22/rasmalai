import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pendingMigrations, runMigrations } from './migrate';

/**
 * A pool that records every statement instead of running one.
 *
 * The SQL these migrations contain is asserted against real Postgres by the migration itself
 * having been applied; what is untested is the *runner* — what it decides to apply, in what order,
 * and what it does when one fails halfway.
 */
function recordingPool(options: { applied?: string[]; failOn?: string } = {}) {
  const statements: string[] = [];
  let applied = options.applied ?? [];

  const client = {
    async query(sql: string, values?: unknown[]) {
      statements.push(sql.trim().split('\n')[0]!.trim());
      if (options.failOn && sql.includes(options.failOn)) {
        throw new Error('syntax error at or near "oops"');
      }
      if (sql.startsWith('insert into public.schema_migrations')) {
        applied = [...applied, values![0] as string];
      }
      return { rows: [] };
    },
    release() {
      released += 1;
    },
  };

  let released = 0;

  const pool = {
    async query(sql: string) {
      statements.push(sql.trim().split('\n')[0]!.trim());
      if (sql.includes('select name from public.schema_migrations')) {
        return { rows: applied.map((name) => ({ name })) };
      }
      return { rows: [] };
    },
    async connect() {
      return client as unknown as PoolClient;
    },
  } as unknown as Pool;

  return {
    pool,
    statements,
    get applied() {
      return applied;
    },
    get released() {
      return released;
    },
  };
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rasmalai-migrations-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const write = (name: string, sql = 'select 1;') => writeFile(join(directory, name), sql, 'utf8');

describe('deciding which migrations still need to run', () => {
  it('returns everything when the table is empty', async () => {
    await write('0001_users.sql');
    await write('0002_pairing.sql');
    const db = recordingPool();

    expect(await pendingMigrations(db.pool, directory)).toEqual([
      '0001_users.sql',
      '0002_pairing.sql',
    ]);
  });

  it('skips what has already been applied', async () => {
    await write('0001_users.sql');
    await write('0002_pairing.sql');
    const db = recordingPool({ applied: ['0001_users.sql'] });

    expect(await pendingMigrations(db.pool, directory)).toEqual(['0002_pairing.sql']);
  });

  it('returns nothing when the database is up to date', async () => {
    await write('0001_users.sql');
    const db = recordingPool({ applied: ['0001_users.sql'] });

    expect(await pendingMigrations(db.pool, directory)).toEqual([]);
  });

  it('ignores anything that is not a .sql file', async () => {
    await write('0001_users.sql');
    await write('README.md', '# not a migration');
    await write('0002_pairing.sql.bak');
    const db = recordingPool();

    expect(await pendingMigrations(db.pool, directory)).toEqual(['0001_users.sql']);
  });

  it('orders by filename, not by the order the directory happens to list them', async () => {
    // Written newest-first on purpose; readdir order is not guaranteed either way.
    await write('0010_tournament_requests.sql');
    await write('0002_pairing.sql');
    await write('0001_users.sql');
    const db = recordingPool();

    expect(await pendingMigrations(db.pool, directory)).toEqual([
      '0001_users.sql',
      '0002_pairing.sql',
      '0010_tournament_requests.sql',
    ]);
  });

  /**
   * This repository really does have two `0009` files. They are independent, so today the order
   * between them does not matter — but the order is decided by an alphabetical tie-break on the
   * rest of the name, not by intent, and that is worth pinning so nobody discovers it during an
   * outage. See known limitation 28 in `docs/14_PROGRESS.md`.
   */
  it('breaks a duplicated numeric prefix alphabetically, by accident rather than by intent', async () => {
    await write('0009_slice_10_games.sql');
    await write('0009_basketball.sql');
    const db = recordingPool();

    expect(await pendingMigrations(db.pool, directory)).toEqual([
      '0009_basketball.sql',
      '0009_slice_10_games.sql',
    ]);
  });

  /**
   * `0010` sorts before `0002` under a plain string sort, so the zero padding is not cosmetic —
   * it is the only thing keeping the order right once the count passes nine.
   */
  it('depends on the zero padding to keep double digits in order', async () => {
    await write('0002_pairing.sql');
    await write('0010_tournament_requests.sql');
    await write('2_unpadded.sql');
    await write('10_unpadded.sql');
    const db = recordingPool();

    const names = await pendingMigrations(db.pool, directory);
    expect(names.indexOf('0002_pairing.sql')).toBeLessThan(
      names.indexOf('0010_tournament_requests.sql'),
    );
    // The unpadded pair demonstrates the failure the padding avoids.
    expect(names.indexOf('10_unpadded.sql')).toBeLessThan(names.indexOf('2_unpadded.sql'));
  });
});

describe('applying migrations', () => {
  it('wraps each migration in its own transaction and records it', async () => {
    await write('0001_users.sql', 'create table users (id uuid);');
    const db = recordingPool();

    expect(await runMigrations(db.pool, directory)).toEqual(['0001_users.sql']);
    expect(db.statements).toContain('begin');
    expect(db.statements).toContain('commit');
    expect(db.applied).toEqual(['0001_users.sql']);
  });

  it('commits each one separately, so a later failure keeps the earlier work', async () => {
    await write('0001_users.sql', 'create table users (id uuid);');
    await write('0002_pairing.sql', 'oops not sql;');
    const db = recordingPool({ failOn: 'oops' });

    await expect(runMigrations(db.pool, directory)).rejects.toThrow(
      'migration 0002_pairing.sql failed',
    );
    // The first one is committed and recorded; only the second rolled back.
    expect(db.applied).toEqual(['0001_users.sql']);
    expect(db.statements.filter((s) => s === 'commit')).toHaveLength(1);
    expect(db.statements.filter((s) => s === 'rollback')).toHaveLength(1);
  });

  it('names the migration that failed, and keeps the original error as the cause', async () => {
    await write('0001_users.sql', 'oops not sql;');
    const db = recordingPool({ failOn: 'oops' });

    await expect(runMigrations(db.pool, directory)).rejects.toThrow(
      /migration 0001_users\.sql failed: syntax error/,
    );
    expect(db.applied).toEqual([]);
  });

  it('gives the connection back even when the migration threw', async () => {
    await write('0001_users.sql', 'oops not sql;');
    const db = recordingPool({ failOn: 'oops' });

    await expect(runMigrations(db.pool, directory)).rejects.toThrow();
    // A leaked client on every failed migration would exhaust the pool.
    expect(db.released).toBe(1);
  });

  it('creates the bookkeeping table before reading it', async () => {
    await write('0001_users.sql');
    const db = recordingPool();
    await runMigrations(db.pool, directory);

    const createdAt = db.statements.findIndex((s) => s.startsWith('create table if not exists'));
    const readAt = db.statements.findIndex((s) => s.startsWith('select name from'));
    expect(createdAt).toBeGreaterThanOrEqual(0);
    expect(createdAt).toBeLessThan(readAt);
  });

  it('does nothing at all when the database is already up to date', async () => {
    await write('0001_users.sql');
    const db = recordingPool({ applied: ['0001_users.sql'] });

    expect(await runMigrations(db.pool, directory)).toEqual([]);
    expect(db.statements).not.toContain('begin');
  });
});
