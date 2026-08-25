import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  createIntegrationContext,
  createIntegrationPool,
  insertSeedUser,
  integrationEnv,
  PAIRING_CODE_MAX_ATTEMPTS,
  type IntegrationContext,
} from './integrationHarness';

/**
 * A collision on `users.pairing_code` (`23505` on the `users_pairing_code_key` constraint), the
 * only error `insertSeedUser`'s retry loop is meant to catch.
 */
function pairingCodeCollision(): Error & { code: string; constraint: string } {
  const error = new Error(
    'duplicate key value violates unique constraint "users_pairing_code_key"',
  ) as Error & { code: string; constraint: string };
  error.code = '23505';
  error.constraint = 'users_pairing_code_key';
  return error;
}

/** A fake `PoolClient` that records every statement it was asked to run, needing no real DB. */
function fakeClient(onInsert: () => void): {
  client: Pick<PoolClient, 'query'>;
  calls: string[];
} {
  const calls: string[] = [];
  const client: Pick<PoolClient, 'query'> = {
    query: (async (text: unknown) => {
      const sql = String(text);
      calls.push(sql);
      if (sql.trim().startsWith('insert into public.users')) onInsert();
      return { rows: [], rowCount: 0 };
    }) as PoolClient['query'],
  };
  return { client, calls };
}

describe('insertSeedUser retry path (no database required)', () => {
  it('retries with a fresh pairing code once, then succeeds', async () => {
    let attempts = 0;
    const { client, calls } = fakeClient(() => {
      attempts += 1;
      if (attempts === 1) throw pairingCodeCollision();
    });

    const codes = ['AAAAAAAA', 'BBBBBBBB'];
    let codeIndex = 0;

    await insertSeedUser(
      client,
      { id: randomUUID(), nickname: 'retry-once', gender: 'female' },
      () => codes[codeIndex++]!,
    );

    expect(attempts).toBe(2);
    expect(codeIndex).toBe(2);
    expect(calls).toEqual([
      'savepoint seed_user_insert',
      expect.stringContaining('insert into public.users'),
      'rollback to savepoint seed_user_insert',
      'savepoint seed_user_insert',
      expect.stringContaining('insert into public.users'),
      'release savepoint seed_user_insert',
    ]);
  });

  it('gives up and rethrows the collision after exhausting every attempt', async () => {
    let attempts = 0;
    const { client } = fakeClient(() => {
      attempts += 1;
      throw pairingCodeCollision();
    });

    await expect(
      insertSeedUser(
        client,
        { id: randomUUID(), nickname: 'retry-exhausted', gender: 'male' },
        () => 'CCCCCCCC',
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'users_pairing_code_key' });

    expect(attempts).toBe(PAIRING_CODE_MAX_ATTEMPTS);
  });

  it('does not retry a collision on a different constraint', async () => {
    const otherError = new Error('duplicate key value violates unique constraint "users_pkey"') as Error & {
      code: string;
      constraint: string;
    };
    otherError.code = '23505';
    otherError.constraint = 'users_pkey';

    let attempts = 0;
    const { client } = fakeClient(() => {
      attempts += 1;
      throw otherError;
    });

    await expect(
      insertSeedUser(
        client,
        { id: randomUUID(), nickname: 'wrong-constraint', gender: 'female' },
        () => 'DDDDDDDD',
      ),
    ).rejects.toBe(otherError);

    expect(attempts).toBe(1);
  });
});

const env = integrationEnv();

describe.skipIf(env === null)('the integration harness', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  it('seeds two real users paired into one couple', async () => {
    const { rows } = await ctx.pool.query<{ id: string; couple_id: string }>(
      'select id, couple_id from public.users where id = any($1::uuid[]) order by id',
      [[ctx.alice.id, ctx.bob.id].sort()],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!.couple_id).toBe(ctx.coupleId);
    expect(rows[1]!.couple_id).toBe(ctx.coupleId);
  });

  it('starts with a clean slate: no matches, and a lifetime row at zero', async () => {
    const matches = await ctx.pool.query(
      'select 1 from public.matches where couple_id = $1',
      [ctx.coupleId],
    );
    expect(matches.rowCount).toBe(0);

    const lifetime = await ctx.pool.query<{ total_games: number }>(
      'select total_games from public.lifetime_statistics where couple_id = $1',
      [ctx.coupleId],
    );
    expect(lifetime.rows[0]?.total_games).toBe(0);
  });

  it('removes every trace of the couple on dispose', async () => {
    const coupleId = ctx.coupleId;
    const aliceId = ctx.alice.id;

    await ctx.dispose();

    // dispose() is called again by afterEach; it must be idempotent. `ctx.pool` is closed by the
    // dispose() above (dispose() calls pool.end()), so verification runs against a short-lived
    // pool of its own rather than the now-dead one.
    const env2 = integrationEnv();
    if (!env2) throw new Error('integration env vanished mid-test');

    const verifyPool = createIntegrationPool(env2, { max: 1 });

    try {
      const users = await verifyPool.query('select 1 from public.users where id = $1', [
        aliceId,
      ]);
      const couples = await verifyPool.query('select 1 from public.couples where id = $1', [
        coupleId,
      ]);

      expect(users.rowCount).toBe(0);
      expect(couples.rowCount).toBe(0);
    } finally {
      await verifyPool.end();
    }
  });
});
