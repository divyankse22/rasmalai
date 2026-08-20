import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from './integrationHarness';

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

    const verifyPool = new Pool({
      connectionString: env2.databaseUrl,
      ssl: env2.caCertificate
        ? { ca: env2.caCertificate, rejectUnauthorized: true }
        : { rejectUnauthorized: true },
      max: 1,
    });

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
