import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type DatabaseError, type PoolClient } from 'pg';
import { createMatchRecorder, type MatchRecorder } from '../modules/statistics/matchRecorder';
import { createStatisticsRepository } from '../modules/statistics/statisticsRepository';
import { createSessionRegistry, type SessionRegistry } from '../modules/sessions/sessionRegistry';
import { generatePairingCode } from '../modules/users/pairingCode';
import type { Gender } from '../modules/users/user.schema';

export interface IntegrationEnv {
  databaseUrl: string;
  supabaseUrl: string;
  secretKey: string;
  caCertificate: string | undefined;
}

export interface SeededUser {
  id: string;
  email: string;
  nickname: string;
}

export interface SentFrame {
  userId: string;
  type: string;
  payload: unknown;
}

export interface IntegrationContext {
  pool: Pool;
  sessions: SessionRegistry;
  recorder: MatchRecorder;
  alice: SeededUser;
  bob: SeededUser;
  coupleId: string;
  /**
   * Every frame the registry emitted, in order. Nothing filters or indexes it - it is the raw
   * record the emitter writes to, and the only diagnostic a failing test has into what the
   * registry actually sent and to whom.
   */
  sent: SentFrame[];
  /**
   * Who the fake presence source considers online. Starts with both seeded users present; tests
   * mutate it directly before calling `sessions.handlePresence` to simulate a disconnect or a
   * reconnect.
   */
  online: Set<string>;
  dispose(): Promise<void>;
}

const ROOT = resolve(import.meta.dirname, '../../../..');

/** Reads the root `.env` without a dependency, and without overwriting anything already set. */
function loadRootEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(resolve(ROOT, '.env'), 'utf8');
  } catch {
    return;
  }

  for (const line of contents.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key!] !== undefined) continue;
    process.env[key!] = rawValue!.replace(/^["']|["']$/g, '');
  }
}

/**
 * The environment these suites need, or `null` when they should be skipped.
 *
 * Skipping rather than failing is deliberate: somebody running the repository's tests on a laptop
 * with no Supabase project should get a green `npm test` and a clearly skipped integration lane,
 * not a wall of connection errors that look like broken code.
 */
export function integrationEnv(): IntegrationEnv | null {
  loadRootEnv();

  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!databaseUrl || !supabaseUrl || !secretKey) return null;

  let caCertificate: string | undefined;
  try {
    caCertificate = readFileSync(resolve(ROOT, 'supabase/prod-ca.crt'), 'utf8');
  } catch {
    caCertificate = undefined;
  }

  return { databaseUrl, supabaseUrl, secretKey, caCertificate };
}

/**
 * Node's `new URL()` - which `pg-connection-string` calls internally and rethrows verbatim on a
 * malformed string (see its `index.js`, `throw err` right out of the `catch`) - attaches the raw
 * input as `error.input`. `DATABASE_URL` can carry a password, so letting that error propagate
 * would print the whole connection string the moment anything serializes the error rather than
 * just reading `.message` (a test reporter dumping a caught error, for instance). Validating the
 * shape ourselves first means a malformed value can only ever surface as this function's own,
 * static, secret-free message.
 */
function assertParsableConnectionString(url: string): void {
  try {
    new URL(url);
  } catch {
    throw new Error('DATABASE_URL could not be parsed as a connection string.');
  }
}

/**
 * The one place a `Pool` gets constructed, so the connection-string safety check above always
 * runs before pg's own parser gets anywhere near a malformed value.
 */
export function createIntegrationPool(env: IntegrationEnv, options: { max?: number } = {}): Pool {
  assertParsableConnectionString(env.databaseUrl);
  return new Pool({
    connectionString: env.databaseUrl,
    ssl: env.caCertificate
      ? { ca: env.caCertificate, rejectUnauthorized: true }
      : { rejectUnauthorized: true },
    max: options.max ?? 4,
  });
}

async function adminRequest(
  env: IntegrationEnv,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(`${env.supabaseUrl}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: env.secretKey,
      authorization: `Bearer ${env.secretKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/** Creates a throwaway auth user. The password is random and never used to sign in. */
async function createAuthUser(env: IntegrationEnv, email: string): Promise<string> {
  const response = await adminRequest(env, '/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: randomUUID(), email_confirm: true }),
  });

  if (!response.ok) {
    throw new Error(`could not create a throwaway auth user (${String(response.status)})`);
  }

  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error('the auth admin API returned a user with no id');
  return body.id;
}

/**
 * Deletes a throwaway auth user by id, and only ever one this same run created (R7: the harness
 * must never touch a real person's account). Deleting the auth user cascades through
 * `public.users` via `on delete cascade`, which is what takes the couple's rows with it too once
 * both partners are gone.
 *
 * Checks the response: a 404 is fine (a previous `dispose()` already removed them), but anything
 * else failing is a real leak and must not be swallowed. Only the status code goes in the thrown
 * message - never the response body, which could echo back request details.
 */
async function deleteAuthUser(env: IntegrationEnv, userId: string): Promise<void> {
  const response = await adminRequest(env, `/users/${userId}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new Error(`could not delete a throwaway auth user (status ${String(response.status)})`);
  }
}

const PAIRING_CODE_UNIQUE_VIOLATION = '23505';
export const PAIRING_CODE_MAX_ATTEMPTS = 5;

function isPairingCodeCollision(error: unknown): boolean {
  const dbError = error as Partial<DatabaseError>;
  return (
    dbError.code === PAIRING_CODE_UNIQUE_VIOLATION && dbError.constraint === 'users_pairing_code_key'
  );
}

interface SeedUserInput {
  id: string;
  nickname: string;
  gender: Gender;
}

/**
 * Inserts one seeded user, retrying with a freshly generated pairing code on the (astronomically
 * unlikely, per `pairingCode.ts`) event that `generatePairingCode()` collides with a code already
 * in the table. Wrapped in its own savepoint so a collision only unwinds this one insert rather
 * than poisoning the whole seeding transaction.
 *
 * Takes a single already-checked-out `PoolClient` rather than a `Pool` deliberately: `Pool.query`
 * checks a client out, runs one statement, and releases it back (destroying it on any error - see
 * `pg-pool/index.js`'s `_release`), so consecutive `pool.query()` calls have no guaranteed
 * relationship to each other's connection or transaction state, and a `ROLLBACK TO SAVEPOINT`
 * issued that way can land on a brand-new connection with no transaction open at all. Running the
 * whole thing on one held client makes `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` mean what they say.
 *
 * `nextPairingCode` defaults to the real generator; tests inject a scripted one to make the
 * retry path deterministic instead of waiting on an 8-character collision that will not happen on
 * its own.
 */
export async function insertSeedUser(
  client: Pick<PoolClient, 'query'>,
  user: SeedUserInput,
  nextPairingCode: () => string = generatePairingCode,
): Promise<void> {
  for (let attempt = 1; attempt <= PAIRING_CODE_MAX_ATTEMPTS; attempt += 1) {
    const pairingCode = nextPairingCode();
    await client.query('savepoint seed_user_insert');
    try {
      await client.query(
        `insert into public.users
           (id, nickname, birth_year, gender, avatar_key, partner_label_nickname, pairing_code,
            onboarding_completed_at)
         values ($1, $2, 1995, $3, 'fox', $4, $5, now())`,
        [user.id, user.nickname, user.gender, `partner-of-${user.nickname}`, pairingCode],
      );
      await client.query('release savepoint seed_user_insert');
      return;
    } catch (error) {
      await client.query('rollback to savepoint seed_user_insert');
      if (isPairingCodeCollision(error) && attempt < PAIRING_CODE_MAX_ATTEMPTS) continue;
      throw error;
    }
  }
}

interface SeedCoupleInput {
  aliceId: string;
  aliceNickname: string;
  bobId: string;
  bobNickname: string;
  coupleId: string;
}

/**
 * Seeds both users and their couple in one real transaction, all on the one client the caller
 * checked out - never through `pool.query()`, for the reasons on `insertSeedUser`.
 */
async function seedCouple(client: PoolClient, input: SeedCoupleInput): Promise<void> {
  await client.query('begin');
  try {
    await insertSeedUser(client, {
      id: input.aliceId,
      nickname: input.aliceNickname,
      gender: 'female',
    });
    await insertSeedUser(client, { id: input.bobId, nickname: input.bobNickname, gender: 'male' });

    await client.query(
      `insert into public.couples (id, user_a_id, user_b_id, first_met_date, location_type)
       values ($1, $2, $3, date '2019-05-04', 'same_city')`,
      [input.coupleId, input.aliceId, input.bobId],
    );
    await client.query('update public.users set couple_id = $1 where id = any($2::uuid[])', [
      input.coupleId,
      [input.aliceId, input.bobId],
    ]);
    await client.query(
      'insert into public.lifetime_statistics (couple_id) values ($1) on conflict do nothing',
      [input.coupleId],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function createIntegrationContext(): Promise<IntegrationContext> {
  const env = integrationEnv();
  if (!env) throw new Error('createIntegrationContext called without integration env');

  const pool = createIntegrationPool(env);

  const stamp = randomUUID().slice(0, 8);
  const aliceEmail = `rasmalai+it-${stamp}-a@example.com`;
  const bobEmail = `rasmalai+it-${stamp}-b@example.com`;
  const aliceNickname = `ali-${stamp}`;
  const bobNickname = `bo-${stamp}`;

  const authIds: string[] = [];
  let disposed = false;
  // Assigned once the recorder exists, below. `dispose()` closes over this rather than the `const`
  // it is eventually bound to, because `dispose()` can run from the `catch` at the bottom of this
  // function before that assignment ever happens - and a reference to a not-yet-initialized `const`
  // would throw there instead of cleaning anything up.
  let recorder: MatchRecorder | undefined;

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;

    // A match write can still be queued in the `MatchRecorder` when a test finishes - draining it
    // first means the throwaway auth users below are never deleted out from under a write still in
    // flight, which would otherwise surface only as a swallowed foreign-key-violation log line in
    // whatever test runs next. This is a safety net, not a substitute for the explicit
    // `await ctx.recorder.drain()` a test still needs before it asserts against `matches`: that one
    // has to land before the assertion, not merely before teardown.
    if (recorder) {
      await recorder.drain().catch(() => {
        // A rejected drain must not stop the deletions or `pool.end()` below from running. The real
        // recorder's `drain()` never rejects by design (`matchRecorder.ts` swallows every write
        // failure into a log line internally) - this does not rely on that holding forever.
      });
    }

    // R7: delete only the auth users this run created, by id, via the Admin API. Deleting them
    // cascades through public.users and everything keyed to it - never a `delete` against
    // public.couples/users/matches by predicate.
    //
    // Each deletion is guarded on its own so one failing can't skip the rest, and `pool.end()`
    // always runs in `finally` - a mid-cleanup failure must not leave sockets open on the
    // single-threaded integration worker, nor a couple row leaked to poison
    // `matches_one_active_per_couple` forever.
    const deletionErrors: unknown[] = [];
    try {
      for (const id of authIds) {
        try {
          // `env` was already null-checked above; the `!` is for TS's benefit inside this
          // closure, which TS cannot see was only ever defined after that check.
          await deleteAuthUser(env!, id);
        } catch (error) {
          deletionErrors.push(error);
        }
      }
    } finally {
      await pool.end();
    }

    if (deletionErrors.length > 0) {
      throw new AggregateError(
        deletionErrors,
        `dispose() failed to delete ${String(deletionErrors.length)} of ${String(
          authIds.length,
        )} throwaway auth user(s) - they may still exist in Supabase`,
      );
    }
  }

  try {
    const aliceId = await createAuthUser(env, aliceEmail);
    authIds.push(aliceId);
    const bobId = await createAuthUser(env, bobEmail);
    authIds.push(bobId);

    const coupleId = randomUUID();

    const client = await pool.connect();
    try {
      await seedCouple(client, { aliceId, aliceNickname, bobId, bobNickname, coupleId });
    } finally {
      client.release();
    }

    const sent: SentFrame[] = [];
    const online = new Set([aliceId, bobId]);

    const statistics = createStatisticsRepository(pool);
    recorder = createMatchRecorder(statistics);
    const sessions = createSessionRegistry(
      {
        sendToUser(userId, type, payload) {
          sent.push({ userId, type, payload });
        },
      },
      { isOnline: (userId) => online.has(userId) },
      { recorder },
    );

    return {
      pool,
      sessions,
      recorder,
      alice: { id: aliceId, email: aliceEmail, nickname: aliceNickname },
      bob: { id: bobId, email: bobEmail, nickname: bobNickname },
      coupleId,
      sent,
      online,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
