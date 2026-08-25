# Slice 11 — Game Integration Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the five games that have never run through `sessionRegistry` — memory, guess-my-answer, bomb-defusal, reflex, basketball — a committed, re-runnable integration suite against the real registry, the real match runner and real Postgres, and fix the tournament move-clock rule so a present-but-stalling player forfeits instead of forcing a restart.

**Architecture:** A new `apps/server/src/testing/integrationHarness.ts` mints two throwaway Supabase auth users through the Admin API, seeds their `public.users` rows and a `couples` row, and hands back a live context wired exactly like `apps/server/src/index.ts` does — real `createStatisticsRepository`, real `createMatchRecorder`, real `createSessionRegistry` — with a `dispose()` that deletes the auth users so the FK cascade removes everything. Integration suites are named `*.integration.test.ts` and are **excluded from the default `vitest run`**, because they mutate a real database and there is no database in a CI that does not yet exist. They run under their own config via `npm run test:integration`.

**Tech Stack:** TypeScript, Vitest, `pg` (node-postgres), Supabase Auth Admin REST API, existing `@rasmalai/games` rulebooks.

**Spec:** This plan implements the decisions recorded in the slice-11 readiness review. Governing documents: `docs/04_REALTIME_AND_WEBSOCKET_PROTOCOL.md` §6 (one clock, forfeit rules), `docs/09_TESTING_STRATEGY.md` (integration + realtime tiers), `docs/13_ARCHITECTURE_PROPOSAL.md` §6 and P-3/P-8, and `docs/14_PROGRESS.md` limitations 29–31.

## Global Constraints

- Node `>=22`; `.nvmrc` pins `24`. Do not add dependencies — `pg`, `vitest` and `zod` are already present.
- Integration tests MUST NOT run under `npm test`. `npm test` must stay green with no database reachable.
- Integration tests MUST clean up after themselves even on failure. A leaked `couples` row poisons the `matches_one_active_per_couple` partial unique index for that couple forever.
- Never print `DATABASE_URL`, `SUPABASE_SECRET_KEY`, or any token in test output or logs.
- All relative imports are extensionless (every consumer is a bundler).
- Seats are `0 | 1`; the platform maps seats to users. Test assertions address **users**, never seats, outside the game's own view.
- `RECONNECT_WINDOW_MS` and `MOVE_WINDOW_MS` are both `120_000` and are imported from `@rasmalai/shared` — never hardcoded.
- Do not modify any file under `packages/games/src/*/server.ts`. These suites test the platform's handling of those rulebooks, not the rulebooks themselves, which already have 215 passing unit tests.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `vitest.config.ts` (modify) | Add `exclude` so `*.integration.test.ts` never runs under `npm test`. |
| `vitest.integration.config.ts` (create) | Include only `*.integration.test.ts`; long timeout; single-threaded. |
| `package.json` (modify) | Add `test:integration` script. |
| `apps/server/src/testing/integrationHarness.ts` (create) | Throwaway couple lifecycle + live wiring + `dispose()`. The only file that talks to the Supabase Admin API. |
| `apps/server/src/testing/integrationHarness.integration.test.ts` (create) | Proves the harness itself: a couple appears, a match row lands, cleanup removes everything. |
| `apps/server/src/modules/sessions/games/memory.integration.test.ts` (create) | Secrecy of the board through the real registry; competitive recording despite casual category. |
| `apps/server/src/modules/sessions/games/guessMyAnswer.integration.test.ts` (create) | Simultaneous secret choice; social scoring records no winner. |
| `apps/server/src/modules/sessions/games/bombDefusal.integration.test.ts` (create) | Asymmetric views survive a real disconnect/resume; cooperative recording. |
| `apps/server/src/modules/sessions/games/reflex.integration.test.ts` (create) | Paused game clock across a real reconnect window; duration score recorded. |
| `apps/server/src/modules/sessions/games/basketball.integration.test.ts` (create) | Shot clock, server-solved trajectory, 20-shot completion, best-score aggregate. |
| `apps/server/src/modules/sessions/sessionRegistry.ts` (modify `resolveClock`, lines 559–566) | Tournament restart only on absence; a present staller forfeits. |
| `apps/server/src/modules/sessions/sessionRegistry.tournament.test.ts` (modify) | Unit coverage for the corrected stall rule. |
| `docs/14_PROGRESS.md` (modify) | Correct the stale slice-10 record; add slice 11. |

---

### Task 1: Gate integration tests out of the default suite

**Files:**
- Modify: `vitest.config.ts`
- Create: `vitest.integration.config.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: the file-naming contract `*.integration.test.ts`, and the command `npm run test:integration`. Every later task depends on both.

- [ ] **Step 1: Exclude integration tests from the default run**

Replace the whole of `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/server/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    // Integration suites talk to a real Postgres and a real Supabase project. They are opt-in
    // through `npm run test:integration`, so `npm test` stays runnable with no database at all.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    passWithNoTests: false,
  },
});
```

- [ ] **Step 2: Verify the default suite is unchanged**

Run: `npm test`
Expected: PASS, `Test Files 31 passed (31)`, `Tests 620 passed (620)`. If the count moved, something else changed — stop and investigate before continuing.

- [ ] **Step 3: Add the integration config**

Create `vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

/**
 * The opt-in half of the suite: real Postgres, real Supabase auth users, real session registry.
 *
 * Single-threaded on purpose. Every suite creates a couple and plays matches through it, and
 * `matches_one_active_per_couple` plus the shared rate limits make concurrent runs against one
 * project flaky in ways that have nothing to do with the code under test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/server/src/**/*.integration.test.ts'],
    // A match plus its cleanup crosses the Atlantic several times.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    passWithNoTests: false,
  },
});
```

- [ ] **Step 4: Add the script**

In `package.json`, add to `scripts`, immediately after `"test:watch"`:

```json
"test:integration": "vitest run --config vitest.integration.config.ts",
```

- [ ] **Step 5: Verify the new config fails loudly with nothing to run**

Run: `npm run test:integration`
Expected: FAIL with "No test files found" (because `passWithNoTests: false` and no `*.integration.test.ts` exists yet). This confirms the glob is live rather than silently matching nothing.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts vitest.integration.config.ts package.json
git commit -m "test: add an opt-in integration test lane"
```

---

### Task 2: The integration harness

**Files:**
- Create: `apps/server/src/testing/integrationHarness.ts`
- Create: `apps/server/src/testing/integrationHarness.integration.test.ts`

**Interfaces:**
- Consumes: `createStatisticsRepository`, `createMatchRecorder`, `createSessionRegistry` from the existing modules; `SessionRegistry` and `SessionView` types.
- Produces:
  - `integrationEnv(): IntegrationEnv | null` — env vars, or `null` when the run should skip.
  - `createIntegrationContext(): Promise<IntegrationContext>`
  - `interface IntegrationContext { pool: Pool; sessions: SessionRegistry; recorder: MatchRecorder; alice: SeededUser; bob: SeededUser; coupleId: string; sent: SentFrame[]; online: Set<string>; framesFor(userId: string): SentFrame[]; lastSessionView(userId: string): SessionView; dispose(): Promise<void>; }`
  - `interface SeededUser { id: string; email: string; nickname: string }`
  - `interface SentFrame { userId: string; type: string; payload: unknown }`

Later tasks call `createIntegrationContext()` in `beforeEach` and `ctx.dispose()` in `afterEach`, and read `ctx.sessions`, `ctx.alice.id`, `ctx.bob.id`, `ctx.coupleId`, `ctx.pool`, `ctx.framesFor`, `ctx.lastSessionView`.

- [ ] **Step 1: Write the failing harness test**

Create `apps/server/src/testing/integrationHarness.integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

    // dispose() is called again by afterEach; it must be idempotent.
    const users = await ctx.pool.query('select 1 from public.users where id = $1', [aliceId]);
    const couples = await ctx.pool.query('select 1 from public.couples where id = $1', [coupleId]);

    expect(users.rowCount).toBe(0);
    expect(couples.rowCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:integration -- apps/server/src/testing/integrationHarness.integration.test.ts`
Expected: FAIL — cannot resolve `./integrationHarness`.

- [ ] **Step 3: Write the harness**

Create `apps/server/src/testing/integrationHarness.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { SessionView } from '@rasmalai/shared';
import { createMatchRecorder, type MatchRecorder } from '../modules/statistics/matchRecorder';
import { createStatisticsRepository } from '../modules/statistics/statisticsRepository';
import { createSessionRegistry, type SessionRegistry } from '../modules/sessions/sessionRegistry';

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
  /** Every frame the registry emitted, in order. Cleared by callers between phases. */
  sent: SentFrame[];
  online: Set<string>;
  framesFor(userId: string): SentFrame[];
  /** The most recent session view this person was sent. Throws if they were sent none. */
  lastSessionView(userId: string): SessionView;
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

async function deleteAuthUser(env: IntegrationEnv, userId: string): Promise<void> {
  // 404 is fine: a previous dispose already removed them.
  await adminRequest(env, `/users/${userId}`, { method: 'DELETE' });
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

  const authIds: string[] = [];
  let disposed = false;

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    // Deleting the auth user cascades through `public.users` and everything keyed to it.
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
      for (const [id, nickname, gender] of [
        [aliceId, `ali-${stamp}`, 'female'],
        [bobId, `bo-${stamp}`, 'male'],
      ] as const) {
        await pool.query(
          `insert into public.users (id, nickname, birth_year, gender, avatar_key,
                                     pairing_code, onboarding_completed_at)
           values ($1, $2, 1995, $3, 'fox', $4, now())`,
          [id, nickname, gender, `IT${stamp.toUpperCase()}${id.slice(0, 2).toUpperCase()}`],
        );
      }

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

    const framesFor = (userId: string): SentFrame[] =>
      sent.filter((frame) => frame.userId === userId);

    const lastSessionView = (userId: string): SessionView => {
      const frame = [...sent]
        .reverse()
        .find(
          (candidate) =>
            candidate.userId === userId &&
            typeof candidate.payload === 'object' &&
            candidate.payload !== null &&
            'session' in candidate.payload,
        );
      if (!frame) throw new Error(`no session frame was sent to ${userId}`);
      return (frame.payload as { session: SessionView }).session;
    };

    return {
      pool,
      sessions,
      recorder,
      alice: { id: aliceId, email: aliceEmail, nickname: `ali-${stamp}` },
      bob: { id: bobId, email: bobEmail, nickname: `bo-${stamp}` },
      coupleId,
      sent,
      online,
      framesFor,
      lastSessionView,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
```

- [ ] **Step 4: Run the harness test**

Run: `npm run test:integration -- apps/server/src/testing/integrationHarness.integration.test.ts`
Expected: PASS, 3 tests. If it fails on the `users` insert, read the current column list with `\d public.users` equivalent (`select column_name, is_nullable from information_schema.columns where table_name='users'`) and adjust the insert — `0006_onboarding_branches.sql` dropped four NOT NULLs, so the required set is smaller than it looks.

- [ ] **Step 5: Confirm the default suite still ignores it**

Run: `npm test`
Expected: PASS, still `31 passed` files. The new file must not appear.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/testing/integrationHarness.ts \
        apps/server/src/testing/integrationHarness.integration.test.ts
git commit -m "test: add a real-Postgres integration harness with throwaway couples"
```

---

### Task 3: Memory through the real registry

**Files:**
- Create: `apps/server/src/modules/sessions/games/memory.integration.test.ts`

**Interfaces:**
- Consumes: `createIntegrationContext`, `integrationEnv`, `IntegrationContext` from Task 2.
- Produces: nothing later tasks depend on. Establishes the per-game suite shape the next four copy.

What this proves that nothing else does: the board's secret survives the platform's own view-building, and a game shelved `casual` is recorded `competitive` because `games.scoring_kind` says so (P-3 is read from the catalogue, not the module).

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/modules/sessions/games/memory.integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, type SessionView } from '@rasmalai/shared';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

const env = integrationEnv();

interface MemoryCardView {
  face: string | null;
  claimedBy: number | null;
}

interface MemoryView {
  cards: MemoryCardView[];
}

describe.skipIf(env === null)('memory, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  /** Opens a memory session with both players on the page and both ready, and starts the match. */
  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'memory',
      gameName: 'Memory',
      players: [
        { userId: ctx.alice.id, nickname: ctx.alice.nickname, avatarKey: 'fox', gender: 'female' },
        { userId: ctx.bob.id, nickname: ctx.bob.nickname, avatarKey: 'penguin', gender: 'male' },
      ],
    });
    ctx.sessions.join(view.id, ctx.alice.id);
    ctx.sessions.join(view.id, ctx.bob.id);
    ctx.sessions.setReady(view.id, ctx.alice.id, true);
    ctx.sessions.setReady(view.id, ctx.bob.id, true);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 1);
    return view.id;
  }

  const memoryView = (view: SessionView): MemoryView => view.game!.state as MemoryView;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a match and writes an active row for the right game', async () => {
    const sessionId = await startMatch();
    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('active');

    await ctx.recorder.drain();

    const { rows } = await ctx.pool.query<{ status: string; slug: string; mode: string }>(
      `select m.status, g.slug, m.mode
         from public.matches m join public.games g on g.id = m.game_id
        where m.couple_id = $1`,
      [ctx.coupleId],
    );

    expect(rows).toEqual([{ status: 'active', slug: 'memory', mode: 'individual' }]);
  });

  it('never shows an unclaimed, face-down card to either player', async () => {
    const sessionId = await startMatch();

    for (const userId of [ctx.alice.id, ctx.bob.id]) {
      const cards = memoryView(ctx.sessions.viewFor(sessionId, userId)).cards;
      expect(cards).not.toHaveLength(0);
      // At the start nothing is turned over and nothing is claimed, so no face may be readable.
      expect(cards.every((card) => card.face === null)).toBe(true);
    }
  });

  it('reveals a face only to the seat that turned it, and only while it is up', async () => {
    const sessionId = await startMatch();
    const turn = ctx.sessions.viewFor(sessionId, ctx.alice.id).turnUserId!;
    const waiting = turn === ctx.alice.id ? ctx.bob.id : ctx.alice.id;

    ctx.sessions.submitAction(
      sessionId,
      turn,
      { type: 'flip', card: 0 },
      { receivedAt: Date.now(), compensationMs: 0 },
    );

    const flipped = memoryView(ctx.sessions.viewFor(sessionId, turn)).cards[0]!;
    const partnerSees = memoryView(ctx.sessions.viewFor(sessionId, waiting)).cards[0]!;

    expect(flipped.face).not.toBeNull();
    // A face-up card is public — both are looking at the same table.
    expect(partnerSees.face).toBe(flipped.face);
    // Everything still face down stays hidden from both.
    expect(
      memoryView(ctx.sessions.viewFor(sessionId, waiting)).cards.filter(
        (card) => card.face !== null,
      ),
    ).toHaveLength(1);
  });

  it('records the match as competitive even though memory is shelved casual', async () => {
    const sessionId = await startMatch();

    // Play it out by flipping every card twice; the rules resolve pairs and end the match.
    const total = memoryView(ctx.sessions.viewFor(sessionId, ctx.alice.id)).cards.length;
    for (let pass = 0; pass < 4; pass += 1) {
      for (let card = 0; card < total; card += 1) {
        const view = ctx.sessions.viewFor(sessionId, ctx.alice.id);
        if (view.phase !== 'active') break;
        const mover = view.turnUserId;
        if (!mover) break;
        try {
          ctx.sessions.submitAction(
            sessionId,
            mover,
            { type: 'flip', card },
            { receivedAt: Date.now(), compensationMs: 0 },
          );
        } catch {
          // An illegal flip (already claimed, or during a peek) is expected while brute forcing.
        }
        await vi.advanceTimersByTimeAsync(2_000);
      }
    }

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    await ctx.recorder.drain();

    const { rows } = await ctx.pool.query<{ status: string; score_a: number; score_b: number }>(
      'select status, score_a, score_b from public.matches where couple_id = $1',
      [ctx.coupleId],
    );
    expect(rows[0]!.status).toBe('completed');

    // P-3 reads `games.scoring_kind`, which `0009_slice_10_games.sql` moved to competitive.
    const stats = await ctx.pool.query<{ total_games: number; competitive_games: number }>(
      'select total_games, competitive_games from public.lifetime_statistics where couple_id = $1',
      [ctx.coupleId],
    );
    expect(stats.rows[0]!.total_games).toBe(1);
    expect(stats.rows[0]!.competitive_games).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- apps/server/src/modules/sessions/games/memory.integration.test.ts`
Expected: the first three may pass immediately (the harness is real and memory works). The fourth is the one to watch. If `competitive_games` is `0`, that is a genuine finding: the module and the catalogue disagree, and `catalogue.test.ts` should have caught it — report it rather than editing the assertion to match.

- [ ] **Step 3: Fix whatever the run exposes**

Do not weaken an assertion to make it pass. If the brute-force loop cannot finish a board, replace it with a deterministic one: read `cards[i].face` from the *mover's* own view after each flip to learn the layout as a player legitimately would, then pair them up.

- [ ] **Step 4: Re-run until green**

Run: `npm run test:integration -- apps/server/src/modules/sessions/games/memory.integration.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/sessions/games/memory.integration.test.ts
git commit -m "test: run memory through the real registry and real Postgres"
```

---

### Task 4: Guess My Answer through the real registry

**Files:**
- Create: `apps/server/src/modules/sessions/games/guessMyAnswer.integration.test.ts`

**Interfaces:**
- Consumes: `createIntegrationContext`, `integrationEnv`, `IntegrationContext` from Task 2.
- Produces: nothing.

What this proves: both seats act at once and neither waits on the other; a `social` game reaches the recorder with **no winner** and touches no competitive counter (P-3).

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/modules/sessions/games/guessMyAnswer.integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS } from '@rasmalai/shared';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

const env = integrationEnv();

describe.skipIf(env === null)('guess my answer, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ctx = await createIntegrationContext();
  });

  afterEach(async () => {
    await ctx.dispose();
    vi.useRealTimers();
  });

  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'guess-my-answer',
      gameName: 'Guess My Answer',
      players: [
        { userId: ctx.alice.id, nickname: ctx.alice.nickname, avatarKey: 'fox', gender: 'female' },
        { userId: ctx.bob.id, nickname: ctx.bob.nickname, avatarKey: 'penguin', gender: 'male' },
      ],
    });
    ctx.sessions.join(view.id, ctx.alice.id);
    ctx.sessions.join(view.id, ctx.bob.id);
    ctx.sessions.setReady(view.id, ctx.alice.id, true);
    ctx.sessions.setReady(view.id, ctx.bob.id, true);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 1);
    return view.id;
  }

  it('names nobody on the move while both are still deciding', async () => {
    const sessionId = await startMatch();
    // Both seats act simultaneously, so there is no turn to take.
    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).turnUserId).toBeNull();
  });

  it('tells the partner that an answer landed without telling them what it was', async () => {
    const sessionId = await startMatch();

    ctx.sessions.submitAction(
      sessionId,
      ctx.alice.id,
      { type: 'choose', round: 0, option: 1 },
      { receivedAt: Date.now(), compensationMs: 0 },
    );

    const partnerView = ctx.sessions.viewFor(sessionId, ctx.bob.id);
    // Alice's chosen option must not appear anywhere in what Bob is sent.
    expect(JSON.stringify(partnerView.game!.state)).not.toContain('"chosen":1');
    // Once one of them is in, the clock is waiting on the straggler.
    expect(partnerView.turnUserId).toBe(ctx.bob.id);
  });

  it('records a social match with no winner and no competitive counter', async () => {
    const sessionId = await startMatch();

    for (let round = 0; round < 12; round += 1) {
      const view = ctx.sessions.viewFor(sessionId, ctx.alice.id);
      if (view.phase !== 'active') break;
      for (const userId of [ctx.alice.id, ctx.bob.id]) {
        try {
          ctx.sessions.submitAction(
            sessionId,
            userId,
            { type: 'choose', round, option: 0 },
            { receivedAt: Date.now(), compensationMs: 0 },
          );
        } catch {
          // The guesser's action differs from the answerer's; whichever is refused is fine here.
        }
        try {
          ctx.sessions.submitAction(
            sessionId,
            userId,
            { type: 'next', round },
            { receivedAt: Date.now(), compensationMs: 0 },
          );
        } catch {
          // Not every seat may advance every round.
        }
      }
      await vi.advanceTimersByTimeAsync(1_000);
    }

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    await ctx.recorder.drain();

    const match = await ctx.pool.query<{ status: string; winner_user_id: string | null }>(
      'select status, winner_user_id from public.matches where couple_id = $1',
      [ctx.coupleId],
    );
    expect(match.rows[0]!.status).toBe('completed');
    expect(match.rows[0]!.winner_user_id).toBeNull();

    const stats = await ctx.pool.query<{
      total_games: number;
      competitive_games: number;
      draws: number;
    }>(
      `select total_games, competitive_games, draws
         from public.lifetime_statistics where couple_id = $1`,
      [ctx.coupleId],
    );
    // P-3: played and timed, and counted by nothing else. A social game is never a draw.
    expect(stats.rows[0]!.total_games).toBe(1);
    expect(stats.rows[0]!.competitive_games).toBe(0);
    expect(stats.rows[0]!.draws).toBe(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration -- apps/server/src/modules/sessions/games/guessMyAnswer.integration.test.ts`
Expected: FAIL on the loop if the action shape is wrong. Read `packages/games/src/guess-my-answer/protocol.ts` for the exact action union and correct the calls — do not change the assertions about secrecy or P-3.

- [ ] **Step 3: Re-run until green**

Run: same command.
Expected: PASS, 3 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/sessions/games/guessMyAnswer.integration.test.ts
git commit -m "test: run guess my answer through the real registry and real Postgres"
```

---

### Task 5: Bomb Defusal through a real disconnect

**Files:**
- Create: `apps/server/src/modules/sessions/games/bombDefusal.integration.test.ts`

**Interfaces:**
- Consumes: `createIntegrationContext`, `integrationEnv`, `IntegrationContext` from Task 2.
- Produces: nothing.

What this proves: the asymmetric `getView` fork survives the platform's real pause/resume path, and the manual never reaches the defuser through a session frame. `pauseOnDisconnect: true`, so the fuse must come back with what it had.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/modules/sessions/games/bombDefusal.integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, RECONNECT_WINDOW_MS } from '@rasmalai/shared';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

const env = integrationEnv();

describe.skipIf(env === null)('bomb defusal, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ctx = await createIntegrationContext();
  });

  afterEach(async () => {
    await ctx.dispose();
    vi.useRealTimers();
  });

  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'bomb-defusal',
      gameName: 'Bomb Defusal',
      players: [
        { userId: ctx.alice.id, nickname: ctx.alice.nickname, avatarKey: 'fox', gender: 'female' },
        { userId: ctx.bob.id, nickname: ctx.bob.nickname, avatarKey: 'penguin', gender: 'male' },
      ],
    });
    ctx.sessions.join(view.id, ctx.alice.id);
    ctx.sessions.join(view.id, ctx.bob.id);
    ctx.sessions.setReady(view.id, ctx.alice.id, true);
    ctx.sessions.setReady(view.id, ctx.bob.id, true);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 1);
    return view.id;
  }

  it('gives the two of them different screens', async () => {
    const sessionId = await startMatch();

    const forAlice = JSON.stringify(ctx.sessions.viewFor(sessionId, ctx.alice.id).game!.state);
    const forBob = JSON.stringify(ctx.sessions.viewFor(sessionId, ctx.bob.id).game!.state);

    expect(forAlice).not.toBe(forBob);
  });

  it('never sends the manual to the defuser', async () => {
    const sessionId = await startMatch();

    // The manual's own words, from packages/games/src/bomb-defusal/server.ts.
    const manualPhrase = 'cut the SECOND wire';

    const seen = [
      JSON.stringify(ctx.sessions.viewFor(sessionId, ctx.alice.id).game!.state),
      JSON.stringify(ctx.sessions.viewFor(sessionId, ctx.bob.id).game!.state),
    ];

    // Exactly one of them is the expert, so the manual reaches exactly one screen.
    expect(seen.filter((state) => state.includes(manualPhrase))).toHaveLength(1);
  });

  it('freezes the fuse across a real disconnect and gives it back intact', async () => {
    const sessionId = await startMatch();

    const fuseOf = (userId: string): number => {
      const state = ctx.sessions.viewFor(sessionId, userId).game!.state as { fuseMsLeft: number };
      return state.fuseMsLeft;
    };

    await vi.advanceTimersByTimeAsync(5_000);
    const before = fuseOf(ctx.alice.id);

    // Bob's last socket closes.
    ctx.online.delete(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, false);

    // Half the reconnect window passes with nobody able to play.
    await vi.advanceTimersByTimeAsync(RECONNECT_WINDOW_MS / 2);
    expect(fuseOf(ctx.alice.id)).toBe(before);

    ctx.online.add(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, true);
    ctx.sessions.join(sessionId, ctx.bob.id);

    expect(fuseOf(ctx.bob.id)).toBe(before);
    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('active');
  });

  it('records a cooperative ending as played and nothing more', async () => {
    const sessionId = await startMatch();

    // Let the fuse run all the way out rather than defusing: the bomb going off is a real ending.
    await vi.advanceTimersByTimeAsync(160_000);

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    await ctx.recorder.drain();

    const stats = await ctx.pool.query<{
      total_games: number;
      competitive_games: number;
      user_a_wins: number;
      user_b_wins: number;
    }>(
      `select total_games, competitive_games, user_a_wins, user_b_wins
         from public.lifetime_statistics where couple_id = $1`,
      [ctx.coupleId],
    );

    expect(stats.rows[0]!.total_games).toBe(1);
    expect(stats.rows[0]!.competitive_games).toBe(0);
    expect(stats.rows[0]!.user_a_wins).toBe(0);
    expect(stats.rows[0]!.user_b_wins).toBe(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration -- apps/server/src/modules/sessions/games/bombDefusal.integration.test.ts`
Expected: FAIL if the view field is not `fuseMsLeft`. Read `packages/games/src/bomb-defusal/protocol.ts` and use the real field name. The *assertion* — that the value is unchanged across the window — must not be relaxed.

- [ ] **Step 3: Re-run until green**

Run: same command.
Expected: PASS, 4 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/sessions/games/bombDefusal.integration.test.ts
git commit -m "test: run bomb defusal through a real disconnect against real Postgres"
```

---

### Task 6: Reflex through the real registry

**Files:**
- Create: `apps/server/src/modules/sessions/games/reflex.integration.test.ts`

**Interfaces:**
- Consumes: `createIntegrationContext`, `integrationEnv`, `IntegrationContext` from Task 2.
- Produces: nothing.

What this proves: the platform's `pause`/`resume` on a real disconnect preserves *game time* rather than wall clock, which is Reflex's whole timing model, and a duration score reaches `couple_game_stats.best_score`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/modules/sessions/games/reflex.integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, RECONNECT_WINDOW_MS } from '@rasmalai/shared';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

const env = integrationEnv();

describe.skipIf(env === null)('reflex, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ctx = await createIntegrationContext();
  });

  afterEach(async () => {
    await ctx.dispose();
    vi.useRealTimers();
  });

  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'reflex',
      gameName: 'Reflex',
      players: [
        { userId: ctx.alice.id, nickname: ctx.alice.nickname, avatarKey: 'fox', gender: 'female' },
        { userId: ctx.bob.id, nickname: ctx.bob.nickname, avatarKey: 'penguin', gender: 'male' },
      ],
    });
    ctx.sessions.join(view.id, ctx.alice.id);
    ctx.sessions.join(view.id, ctx.bob.id);
    ctx.sessions.setReady(view.id, ctx.alice.id, true);
    ctx.sessions.setReady(view.id, ctx.bob.id, true);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 1);
    return view.id;
  }

  it('gives both runners the identical hazard schedule', async () => {
    const sessionId = await startMatch();

    const scheduleOf = (userId: string): unknown =>
      (ctx.sessions.viewFor(sessionId, userId).game!.state as { hazards: unknown }).hazards;

    expect(scheduleOf(ctx.alice.id)).toEqual(scheduleOf(ctx.bob.id));
  });

  it('stops game time while somebody is away and resumes with what was left', async () => {
    const sessionId = await startMatch();

    const elapsedOf = (userId: string): number =>
      (ctx.sessions.viewFor(sessionId, userId).game!.state as { elapsedMs: number }).elapsedMs;

    await vi.advanceTimersByTimeAsync(3_000);
    const before = elapsedOf(ctx.alice.id);

    ctx.online.delete(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, false);

    await vi.advanceTimersByTimeAsync(RECONNECT_WINDOW_MS / 2);
    // Wall clock moved by a minute; game time must not have.
    expect(elapsedOf(ctx.alice.id)).toBe(before);

    ctx.online.add(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, true);
    ctx.sessions.join(sessionId, ctx.bob.id);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(elapsedOf(ctx.alice.id)).toBeGreaterThan(before);
  });

  it('refuses a move from a player while their partner is away', async () => {
    const sessionId = await startMatch();

    ctx.online.delete(ctx.bob.id);
    ctx.sessions.handlePresence(ctx.bob.id, false);

    expect(() =>
      ctx.sessions.submitAction(
        sessionId,
        ctx.alice.id,
        { type: 'move', direction: 'left' },
        { receivedAt: Date.now(), compensationMs: 0 },
      ),
    ).toThrow();
  });

  it('records the duration score against the game', async () => {
    const sessionId = await startMatch();

    // Nobody dodges anything; the run ends when the hazards catch both of them.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    await ctx.recorder.drain();

    const { rows } = await ctx.pool.query<{ plays: number }>(
      `select cgs.plays
         from public.couple_game_stats cgs join public.games g on g.id = cgs.game_id
        where cgs.couple_id = $1 and g.slug = 'reflex'`,
      [ctx.coupleId],
    );
    expect(rows[0]!.plays).toBe(1);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration -- apps/server/src/modules/sessions/games/reflex.integration.test.ts`
Expected: FAIL on field names. Read `packages/games/src/reflex/protocol.ts` for the real view shape (`hazards`, `elapsedMs` are the guesses to check) and correct them. The paused-clock assertion is the point of the task and must survive intact.

- [ ] **Step 3: Re-run until green**

Run: same command.
Expected: PASS, 4 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/sessions/games/reflex.integration.test.ts
git commit -m "test: run reflex through the real registry, proving game time pauses"
```

---

### Task 7: Basketball through the real registry

**Files:**
- Create: `apps/server/src/modules/sessions/games/basketball.integration.test.ts`

**Interfaces:**
- Consumes: `createIntegrationContext`, `integrationEnv`, `IntegrationContext` from Task 2.
- Produces: nothing.

What this proves: the largest and newest rulebook — 548 lines, shipped under a commit titled "minor fixes applied" with no integration coverage at all — actually completes 20 shots through the platform, and the server rejects an out-of-range shot rather than trusting it.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/modules/sessions/games/basketball.integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS } from '@rasmalai/shared';
import {
  createIntegrationContext,
  integrationEnv,
  type IntegrationContext,
} from '../../../testing/integrationHarness';

const env = integrationEnv();

describe.skipIf(env === null)('basketball, through the real registry', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ctx = await createIntegrationContext();
  });

  afterEach(async () => {
    await ctx.dispose();
    vi.useRealTimers();
  });

  async function startMatch(): Promise<string> {
    const view = ctx.sessions.create({
      coupleId: ctx.coupleId,
      gameSlug: 'basketball',
      gameName: 'Basketball',
      players: [
        { userId: ctx.alice.id, nickname: ctx.alice.nickname, avatarKey: 'fox', gender: 'female' },
        { userId: ctx.bob.id, nickname: ctx.bob.nickname, avatarKey: 'penguin', gender: 'male' },
      ],
    });
    ctx.sessions.join(view.id, ctx.alice.id);
    ctx.sessions.join(view.id, ctx.bob.id);
    ctx.sessions.setReady(view.id, ctx.alice.id, true);
    ctx.sessions.setReady(view.id, ctx.bob.id, true);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 1);
    return view.id;
  }

  it('refuses a shot with an angle outside the legal range', async () => {
    const sessionId = await startMatch();
    const shooter = ctx.sessions.viewFor(sessionId, ctx.alice.id).turnUserId!;

    expect(() =>
      ctx.sessions.submitAction(
        sessionId,
        shooter,
        { type: 'shoot', shot: 0, angle: 89, power: 0.5 },
        { receivedAt: Date.now(), compensationMs: 0 },
      ),
    ).toThrow();
  });

  it('refuses a shot from the player whose turn it is not', async () => {
    const sessionId = await startMatch();
    const shooter = ctx.sessions.viewFor(sessionId, ctx.alice.id).turnUserId!;
    const waiting = shooter === ctx.alice.id ? ctx.bob.id : ctx.alice.id;

    expect(() =>
      ctx.sessions.submitAction(
        sessionId,
        waiting,
        { type: 'shoot', shot: 0, angle: 45, power: 0.6 },
        { receivedAt: Date.now(), compensationMs: 0 },
      ),
    ).toThrow();
  });

  it('plays all twenty shots and records a completed competitive match', async () => {
    const sessionId = await startMatch();

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const view = ctx.sessions.viewFor(sessionId, ctx.alice.id);
      if (view.phase !== 'active') break;
      const shooter = view.turnUserId;
      if (!shooter) {
        await vi.advanceTimersByTimeAsync(2_000);
        continue;
      }
      const shot = (view.game!.state as { shot: number }).shot;
      try {
        ctx.sessions.submitAction(
          sessionId,
          shooter,
          { type: 'shoot', shot, angle: 45, power: 0.62 },
          { receivedAt: Date.now(), compensationMs: 0 },
        );
      } catch {
        // A stale shot number is expected while the ball is still in the air.
      }
      // Let the ball land and the next shot arm.
      await vi.advanceTimersByTimeAsync(4_000);
    }

    expect(ctx.sessions.viewFor(sessionId, ctx.alice.id).phase).toBe('finished');
    await ctx.recorder.drain();

    const match = await ctx.pool.query<{ status: string; score_a: number; score_b: number }>(
      'select status, score_a, score_b from public.matches where couple_id = $1',
      [ctx.coupleId],
    );
    expect(match.rows[0]!.status).toBe('completed');

    const stats = await ctx.pool.query<{ competitive_games: number }>(
      'select competitive_games from public.lifetime_statistics where couple_id = $1',
      [ctx.coupleId],
    );
    expect(stats.rows[0]!.competitive_games).toBe(1);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration -- apps/server/src/modules/sessions/games/basketball.integration.test.ts`
Expected: FAIL on the action shape or the view's shot field. Read `packages/games/src/basketball/protocol.ts` for the exact `shoot` action and the view's shot counter, then correct the calls.

- [ ] **Step 3: If the twenty-shot loop cannot finish, say so rather than deleting the test**

If the match will not complete inside 60 attempts, that is a finding about the shot clock or the arming path and belongs in the slice report. Mark the test `it.fails(...)` only as a temporary, commented step and raise it — do not silently drop the assertion.

- [ ] **Step 4: Re-run until green**

Run: same command.
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/sessions/games/basketball.integration.test.ts
git commit -m "test: run basketball through the real registry and real Postgres"
```

---

### Task 8: A present staller forfeits, even in a tournament

**Files:**
- Modify: `apps/server/src/modules/sessions/sessionRegistry.ts` (`resolveClock`, currently lines 559–566)
- Modify: `apps/server/src/modules/sessions/sessionRegistry.tournament.test.ts`

**Interfaces:**
- Consumes: the existing `atFault`, `isPresent`, `forfeit`, `endSession`, `broadcast` helpers already in scope inside `createSessionRegistry`.
- Produces: no new exported symbol. Behaviour change only.

The bug: the tournament branch fires for **any** expired clock, so a present player who simply stops moving triggers a restart. Two of those pause the series. `docs/04` §6 says the at-fault player loses, and only contemplates disconnects — so a player losing a board can currently force a replay by walking away from their turn.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/modules/sessions/sessionRegistry.tournament.test.ts`, inside the existing top-level `describe`:

```ts
  it('forfeits a tournament game when a present player just stops moving', async () => {
    const id = startTournamentSession('four-in-a-row');
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 1);

    const stalling = sessions.viewFor(id, ALICE).turnUserId!;
    const waiting = stalling === ALICE ? BOB : ALICE;

    // Nobody disconnects. The player on the move simply never moves.
    await vi.advanceTimersByTimeAsync(MOVE_WINDOW_MS + 1);

    expect(sessions.viewFor(id, waiting).result).toMatchObject({
      outcome: 'won',
      byForfeit: true,
    });
    // A restart would have reported the game as unplayed to the engine.
    expect(tournamentCalls.filter((call) => call.method === 'matchEnded')).toHaveLength(1);
    expect(tournamentCalls.at(-1)).toMatchObject({ method: 'matchEnded', played: true });
  });

  it('still restarts a tournament game when somebody actually drops off', async () => {
    const id = startTournamentSession('four-in-a-row');
    sessions.setReady(id, ALICE, true);
    sessions.setReady(id, BOB, true);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 1);

    online.delete(BOB);
    sessions.handlePresence(BOB, false);
    await vi.advanceTimersByTimeAsync(RECONNECT_WINDOW_MS + 1);

    expect(tournamentCalls.at(-1)).toMatchObject({ method: 'matchEnded', played: false });
  });
```

If `startTournamentSession` and `tournamentCalls` do not already exist in that file under those names, use whatever the file already calls them — read the top of the file first and match its existing helpers rather than adding parallel ones.

- [ ] **Step 2: Run it and watch the first test fail**

Run: `npm test -- apps/server/src/modules/sessions/sessionRegistry.tournament.test.ts`
Expected: FAIL — the stalling test reports `played: false` (a restart) instead of a forfeit. The second test should already pass.

- [ ] **Step 3: Make the fix**

In `apps/server/src/modules/sessions/sessionRegistry.ts`, delete the tournament block currently at lines 559–566:

```ts
    // Tournaments restart the affected game instead of awarding it — one dropped connection must
    // not hand over points in a standings table (`docs/04` section 6, CLAUDE.md). Slice 9 is what
    // makes this branch reachable.
    if (session.mode === 'tournament') {
      broadcast(session, EVENTS.presence.reconnectWindowExpired);
      endSession(session, 'abandoned', 'abandoned');
      return;
    }
```

and re-insert it immediately after the `blamed.length === 0` guard (that is, after the block ending `      return;\n    }` which logs `'a clock expired with nobody on it'`), rewritten as:

```ts
    // Tournaments restart a game lost to a dropped connection — one bad wifi moment must not hand
    // over points in a standings table (`docs/04` section 6). A player who is *present* and simply
    // stops moving is not that: they forfeit exactly as they would in an individual match. Letting
    // a restart cover them would mean anybody losing a board could force a replay by sitting on
    // their turn, which is the one thing the move clock exists to prevent.
    if (session.mode === 'tournament' && blamed.some((seat) => !isPresent(session.players[seat]))) {
      broadcast(session, EVENTS.presence.reconnectWindowExpired);
      endSession(session, 'abandoned', 'abandoned');
      return;
    }
```

- [ ] **Step 4: Run the tournament tests**

Run: `npm test -- apps/server/src/modules/sessions/sessionRegistry.tournament.test.ts`
Expected: PASS, all tests including both new ones.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `npm test`
Expected: PASS, `622 passed` (620 plus the two new tests). Any other change in the count is a regression — investigate before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/sessions/sessionRegistry.ts \
        apps/server/src/modules/sessions/sessionRegistry.tournament.test.ts
git commit -m "fix: a present player who stalls forfeits their tournament game"
```

---

### Task 9: Correct the progress record

**Files:**
- Modify: `docs/14_PROGRESS.md`

**Interfaces:**
- Consumes: the outcomes of Tasks 1–8.
- Produces: nothing.

`docs/14_PROGRESS.md` is one commit stale and its evidence section overstates what is reproducible. Every claim corrected here was verified during the slice-11 readiness review.

- [ ] **Step 1: Correct the stale facts**

Make these edits:

1. Slice-status table, row 10: change the scope cell to `Memory, Guess My Answer, Bomb Defusal, Reflex (Phaser), Basketball (Phaser); counter-proposal UI; score units; tournament requests` — Basketball and migrations `0009_basketball.sql`, `0010`, `0011` landed in `acd3c54` and were never recorded.
2. The line reading `Gate at the time of writing: **557 tests passing**` — change to the real current number from `npm test`.
3. Everywhere the document says six games, change to seven.
4. Limitation 28 (`0009` has been written but not applied) — replace with: **Resolved. All twelve migrations are applied**, confirmed against the live project; `0009_basketball.sql` and `0009_slice_10_games.sql` share a prefix and are ordered only by an alphabetical tie-break.
5. Limitation 31 (a tournament still has not been played) — keep it, and note the move-clock rule changed in slice 11.

- [ ] **Step 2: Add the honest note about the older evidence**

Add to the top of the "Verified, with evidence" section:

```markdown
> **On reproducibility.** The real-Postgres runs described below for slices 5–9 were driven by
> scripts that were never committed — 227 files have existed in this repository and none of them was
> an integration harness. Those results were true when they were run and cannot be re-run. Slice 11
> adds `apps/server/src/testing/integrationHarness.ts` and the `*.integration.test.ts` lane so that
> everything claimed from here on can be checked with `npm run test:integration`.
```

- [ ] **Step 3: Add the slice 11 section**

Write a section describing: the integration lane and why it is opt-in, the five games now covered, what each suite proves that its unit tests could not, and the tournament stall fix with the reasoning from Task 8.

- [ ] **Step 4: Run the full gate**

Run: `npm run verify`
Expected: PASS — typecheck, lint, tests and both builds green.

- [ ] **Step 5: Run the integration lane**

Run: `npm run test:integration`
Expected: PASS, all five game suites plus the harness suite.

- [ ] **Step 6: Commit**

```bash
git add docs/14_PROGRESS.md
git commit -m "docs: correct the slice 10 record and write up slice 11"
```

---

## Self-Review

**Spec coverage.** The user's two decisions are both covered: integration coverage for the five unproven games (Tasks 3–7, on the harness from Tasks 1–2) and the tournament stall rule (Task 8). `docs/09_TESTING_STRATEGY.md`'s integration tier — "match lifecycle, result persistence, statistics update" — is reached for the first time by Tasks 3–7, since those are the first tests in the repository's history to execute SQL. Its E2E and mobile tiers remain unaddressed and are deliberately out of this slice's scope; they need a browser and belong with the two-account sitting that limitations 18/24/26/29–31 all name.

**Known gaps carried forward, not fixed here.** The `readView` couple-scope gap, the ~20-second post-expiry socket window, unvalidated `game.event` relay, unmetered `lobby.*` frames, the duplicate `0009` prefix, and the four dead `GameMeta` fields are all recorded in the readiness review and are candidates for a hardening slice. None is a prerequisite for this one.

**Placeholder scan.** Every step names an exact file, an exact command, and its expected result. Where a field name is a guess from the progress doc rather than read from source (`fuseMsLeft`, `hazards`, `elapsedMs`, basketball's shot counter), the step says so explicitly and directs the implementer to the protocol file — with the instruction that the surrounding assertion must not be weakened to accommodate whatever they find. That is deliberate: inventing a field name here would be worse than naming the file to read.

**Type consistency.** `IntegrationContext`, `SeededUser`, `SentFrame`, `integrationEnv()` and `createIntegrationContext()` are defined once in Task 2 and used under exactly those names in Tasks 3–7. `ctx.online` is a `Set<string>` mutated directly before `handlePresence`, consistently in Tasks 5 and 6. The `submitAction` signature `(sessionId, userId, action, { receivedAt, compensationMs })` matches `SessionRegistry` as read from `sessionRegistry.ts:298`.
