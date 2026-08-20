import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type DatabaseError } from 'pg';
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
 */
async function deleteAuthUser(env: IntegrationEnv, userId: string): Promise<void> {
  // 404 is fine: a previous dispose already removed them.
  await adminRequest(env, `/users/${userId}`, { method: 'DELETE' });
}

const PAIRING_CODE_UNIQUE_VIOLATION = '23505';
const PAIRING_CODE_MAX_ATTEMPTS = 5;

function isPairingCodeCollision(error: unknown): boolean {
  const dbError = error as Partial<DatabaseError>;
  return dbError.code === PAIRING_CODE_UNIQUE_VIOLATION && dbError.constraint === 'users_pairing_code_key';
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
 */
async function insertSeedUser(pool: Pool, user: SeedUserInput): Promise<void> {
  for (let attempt = 1; attempt <= PAIRING_CODE_MAX_ATTEMPTS; attempt += 1) {
    const pairingCode = generatePairingCode();
    await pool.query('savepoint seed_user_insert');
    try {
      await pool.query(
        `insert into public.users
           (id, nickname, birth_year, gender, avatar_key, partner_label_nickname, pairing_code,
            onboarding_completed_at)
         values ($1, $2, 1995, $3, 'fox', $4, $5, now())`,
        [user.id, user.nickname, user.gender, `partner-of-${user.nickname}`, pairingCode],
      );
      await pool.query('release savepoint seed_user_insert');
      return;
    } catch (error) {
      await pool.query('rollback to savepoint seed_user_insert');
      if (isPairingCodeCollision(error) && attempt < PAIRING_CODE_MAX_ATTEMPTS) continue;
      throw error;
    }
  }
}

export async function createIntegrationContext(): Promise<IntegrationContext> {
  const env = integrationEnv();
  if (!env) throw new Error('createIntegrationContext called without integration env');

  const pool = new Pool({
    connectionString: env.databaseUrl,
    ssl: env.caCertificate
      ? { ca: env.caCertificate, rejectUnauthorized: true }
      : { rejectUnauthorized: true },
    max: 4,
  });

  const stamp = randomUUID().slice(0, 8);
  const aliceEmail = `rasmalai+it-${stamp}-a@example.com`;
  const bobEmail = `rasmalai+it-${stamp}-b@example.com`;
  const aliceNickname = `ali-${stamp}`;
  const bobNickname = `bo-${stamp}`;

  const authIds: string[] = [];
  let disposed = false;

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    // R7: delete only the auth users this run created, by id, via the Admin API. Deleting them
    // cascades through public.users and everything keyed to it - never a `delete` against
    // public.couples/users/matches by predicate.
    // `env` was already null-checked above; the `!` is for TS's benefit inside this closure.
    for (const id of authIds) await deleteAuthUser(env!, id);
    await pool.end();
  }

  try {
    const aliceId = await createAuthUser(env, aliceEmail);
    authIds.push(aliceId);
    const bobId = await createAuthUser(env, bobEmail);
    authIds.push(bobId);

    const coupleId = randomUUID();

    await pool.query('begin');
    try {
      await insertSeedUser(pool, { id: aliceId, nickname: aliceNickname, gender: 'female' });
      await insertSeedUser(pool, { id: bobId, nickname: bobNickname, gender: 'male' });

      await pool.query(
        `insert into public.couples (id, user_a_id, user_b_id, first_met_date, location_type)
         values ($1, $2, $3, date '2019-05-04', 'same_city')`,
        [coupleId, aliceId, bobId],
      );
      await pool.query('update public.users set couple_id = $1 where id = any($2::uuid[])', [
        coupleId,
        [aliceId, bobId],
      ]);
      await pool.query(
        'insert into public.lifetime_statistics (couple_id) values ($1) on conflict do nothing',
        [coupleId],
      );
      await pool.query('commit');
    } catch (error) {
      await pool.query('rollback');
      throw error;
    }

    const sent: SentFrame[] = [];
    const online = new Set([aliceId, bobId]);

    const statistics = createStatisticsRepository(pool);
    const recorder = createMatchRecorder(statistics);
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
