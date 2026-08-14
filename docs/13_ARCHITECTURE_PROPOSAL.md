# Rasmalai Architecture Proposal (Phase 0 exit document)

Status: **awaiting confirmation**. No application code is written until this is approved.

This document resolves every item `docs/12_CLAUDE_START_HERE.md` requires before implementation.
It supplements `docs/11_ARCHITECTURE_DECISIONS.md` and does not contradict any existing ADR.

---

## 0. Decisions locked in the requirements interview

### Product decisions

| # | Decision |
|---|---|
| P-1 | Partner name/nickname captured at onboarding is a **private pet-name label**, owned by the user who wrote it. After pairing, the partner's real profile is the system record; the label is only how that one user sees their partner. Labels are asymmetric and never shown to the other person. |
| P-2 | `couples.first_met_date` and `couples.location_type` are **seeded from the pairing requester's** onboarding answers. Either partner can edit them afterwards. |
| P-3 | Win statistics are **competitive-only**. Cooperative/social/casual matches increment games-played and time-played, and touch nothing else. The dashboard renders the two groups as separate blocks. |
| P-4 | Tournaments may include **any** game category, but **only competitive games score** (3/1/0). Non-competitive games run as unscored rounds recorded as a team result. |
| P-5 | Lifetime-relevant values (best score, closest margin, favourite-game counters, duration) are **snapshotted into `lifetime_statistics` at match completion**, so the raw match row can expire at 7 days losing nothing. |
| P-6 | Each game picks the **cheapest renderer that works**: `react` for board/turn/text games, `phaser` for motion/physics games. The server-side rules are renderer-agnostic and identical either way. |
| P-7 | The authenticated socket is **open app-wide after login**, so invitations arrive instantly with no polling. Declining an invitation may carry a **counter-proposal** for a different game. |
| P-8 | An **abandoned match never counts**. The row is written and visible in the 7-day history, but it is excluded from every aggregate and every dashboard counter. Only `status = 'completed'` matches feed statistics. |

### Technical decisions

| # | Decision |
|---|---|
| T-1 | **Supabase Auth** with the Google provider. Supabase issues the JWT; Next.js guards routes with it; the Node backend verifies the same JWT to authenticate WebSockets. |
| T-2 | **Supabase cloud dev project** for local development. Same platform as production, one identity system. |
| T-3 | First slice is **Reaction Speed**, immediately followed by **Four in a Row** to prove the game contract is additive. |
| T-4 | **Monorepo with npm workspaces.** |
| T-5 | Raw **`ws`** for the socket, with our own typed envelope (per ADR-003). No Socket.IO. |
| T-6 | V1 avatars are **preset abstract avatars + the Google picture URL**. Uploads and Supabase Storage deferred. |
| T-7 | Retention is a **daily in-process job** on the backend, plus lazy filtering on read. No pg_cron. |

---

## 1. Component architecture

```text
rasmalai/
  package.json                  npm workspaces + root scripts
  tsconfig.base.json
  .env.example
  apps/
    web/                        Next.js (App Router) + TypeScript  → Netlify
      src/app/                  routes and layouts
      src/features/             auth, onboarding, couple, dashboard, lobby,
                                tournament, profile
      src/realtime/             socket client, typed dispatch, connection store
      src/design-system/        tokens, primitives, animation timings
      src/games/                thin renderer mounts (delegates to packages/games)
    server/                     Node + TypeScript + ws + Docker      → Render
      src/http/                 REST routes
      src/ws/                   socket server, auth handshake, envelope router
      src/modules/              auth, users, couples, pairing, invitations,
                                presence, sessions, games, tournaments,
                                statistics, retention
      src/db/                   pool, repositories
      Dockerfile
  packages/
    shared/                     envelope, event names, error codes, DTOs, zod schemas
    games/                      one folder per game (see §7)
  supabase/
    migrations/                 versioned SQL
```

**Why the games live in one package rather than split across app boundaries:** `docs/05` wants a game to be a single replaceable module. Each game folder therefore holds its metadata, protocol types, server rules, and client renderer together, exposed through separate subpath entrypoints (`@rasmalai/games/<slug>/server`, `/client`, `/meta`). An ESLint `no-restricted-imports` rule forbids `apps/web` from importing any `/server` entrypoint, so authoritative rules can never be bundled into the browser. One folder per game, zero leakage.

---

## 2. Data flow — one path, one authorization site

The browser's Supabase client is used for **authentication only**. It never queries tables.
All data access goes through the Node backend, which is the single place couple-scoping is enforced.

```text
Browser ──HTTP (JWT)──▶ Node API ──pg──▶ Postgres
   │                        ▲
   └──WSS (JWT)─────────────┘
```

Next.js server components fetch from the Node API with the user's JWT forwarded, rather than
reading Postgres directly. This deliberately avoids a second data path with its own copy of the
authorization rules.

Consequence: **Row Level Security is enabled on every table with no permissive policy for `anon`
or `authenticated`.** The backend uses the service role and does its own authorization. RLS is
therefore a hard deny-all backstop — if a key ever leaks to the browser, nothing is readable.

---

## 3. Auth flow

1. Landing page → "Continue with Google" → `supabase.auth.signInWithOAuth({ provider: 'google' })`.
2. Google → Supabase callback → `/auth/callback` in Next.js exchanges the code via `@supabase/ssr`.
   The session lives in **httpOnly cookies**. No tokens in `localStorage`.
3. Next.js middleware refreshes the session and guards `/onboarding`, `/dashboard`, `/play/*`.
4. `auth.users` is Supabase's. Our `public.users` row is created **in application code when
   onboarding is submitted**, with `users.id = auth.users.id`. No database triggers — explicit and
   testable.
5. A user who is authenticated but has no `public.users` row is routed to onboarding; one with a
   profile but no couple is routed to pairing; one with a couple lands on the dashboard.

**Socket authentication.** The client opens the socket and sends `connection.authenticate` as the
first frame carrying the access token — never in the query string, which would land tokens in
access logs. The server verifies the JWT against the project's **public JWKS** at
`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` (new Supabase projects sign
asymmetrically, so there is no shared HS256 secret to distribute to Render at all), derives
`user_id` from `sub`, loads the user and couple, and marks the socket authenticated. A socket that has not authenticated within 10 seconds is closed.
Access tokens expire hourly; the client sends `connection.reauthenticate` on refresh, and a socket
whose token expires without reauthentication is closed with `not_authenticated`.

We never see, store, or proxy Google credentials.

---

## 4. Pairing flow

**Code generation.** On onboarding completion each user receives an 8-character code drawn from a
lookalike-free alphabet using `crypto.randomBytes`, stored under a unique index with retry on
collision. Roughly 10^12 possibilities, never sequential, and code lookups are rate limited.

**Request.** `POST /api/pairing/requests { code }` validates: the code resolves, the target is not
the caller, neither party is already coupled, and no pending request already exists in either
direction. The target receives `pairing.request.created` on their socket if connected, and sees it
on next load otherwise.

**Response.** `POST /api/pairing/requests/:id/respond { accept | reject }` runs in one transaction
with both user rows locked: verify the caller is the target and the request is still pending,
re-check neither user is coupled, insert the `couples` row (`user_a` = requester, `user_b` =
target, metadata seeded per **P-2**), mark the request accepted, cancel any other pending requests
involving either user, and create the `lifetime_statistics` row. Both sides get
`pairing.request.accepted`.

Rejected requests are terminal and can never be accepted later. A fresh request may be sent
afterwards, rate limited to discourage nagging.

**Assumption to confirm:** a rejection does not permanently block that requester.

---

## 5. Invitation flow

Invitations are **persisted**, not in-memory, so an offline partner still finds one waiting and a
backend restart cannot lose it.

```sql
CREATE UNIQUE INDEX one_active_invitation_per_couple
  ON invitations (couple_id) WHERE status = 'pending';
```

That partial index is what actually enforces "one active invitation per couple" — invalidating the
previous row and inserting the new one happen in a single transaction, and the index makes the
race unwinnable.

- **TTL** is 5 minutes. A live timer emits `game.invitation.expired`, *and* every read treats
  `expires_at < now()` as expired. Both, because in-process timers die with the process.
- **Accept** creates the in-memory game session and emits `game.invitation.accepted` with the
  session id to both players, who navigate to `/play/:sessionId`.
- **Decline** sets `rejected` and emits `game.invitation.rejected`. If the response carries
  `counterGameSlug`, the same transaction immediately creates a new pending invitation in the
  opposite direction (**P-7**). The counter reuses the single active slot, so the one-invitation
  rule holds automatically.

---

## 6. WebSocket lifecycle and reconnection

**Envelope** is exactly the shape in `docs/04`: `{ type, requestId?, ts, payload }`. Errors come
back as `{ type: 'error', requestId, payload: { code, message } }` using that document's code list,
with no internals leaked.

**Liveness.** Server pings every 20s and terminates a socket that misses two pongs (~45s). The
client reconnects with exponential backoff plus jitter.

**Multiple sockets per user are allowed.** Presence is "online if at least one socket". A game
session binds to the *user*, not the socket, so a refresh or a second tab is a non-event rather
than a disconnect. Actions are accepted from any authenticated socket belonging to that user.

**Registries** live in backend memory: sockets by user, couple rooms, sessions by id. Persistent
things (invitations, matches) survive restarts; live sessions do not. A restart mid-match returns
both players to the dashboard with a friendly message rather than a stuck screen. **Known
limitation, accepted for V1** — persisting live match state is exactly the complexity `docs/02`
tells us not to add yet.

**Reconnection.** Each game declares
`{ windowMs: 120000, pauseOnDisconnect, restoreState, onExpire }`.

```text
last socket for a player closes during an active session
  → partner sees a friendly reconnecting state
  → session.reconnect_window_started, authoritative clock pauses
  → reconnect inside 120s → full state snapshot → 3-2-1 resume
  → window expires → onExpire
```

`onExpire` defaults: **individual match → abandon**, written as an `abandoned` row that counts
toward nothing per **P-8** (nothing in the specs awards a win for a disconnect); **tournament game
→ restart**, as `docs/04` requires. After two consecutive failed restarts of the same tournament
game, the tournament moves to `paused` and is resumable from the dashboard rather than restarting
forever.

---

## 7. Game module contract

```ts
// packages/games/<slug>/meta.ts        — shared, safe for the browser
export const meta: GameMeta = {
  slug, name, category,
  scoringKind: 'competitive' | 'cooperative' | 'social' | 'casual',
  renderer: 'react' | 'phaser',
  players: 2,
  orientation: 'any' | 'portrait' | 'landscape',
  inputs: ['tap', 'swipe', 'keyboard', 'pointer'],
};

// packages/games/<slug>/server.ts      — never bundled to the browser
export const rules: GameRules<State, Action> = {
  createMatch(config, rng): State;
  validateAction(state, player, action): ValidationResult;
  applyAction(state, player, action, now): Transition;
  tick?(state, now): Transition;          // for timed games
  getResult(state): GameResult;
  reconnectPolicy: ReconnectPolicy;
};

// packages/games/<slug>/client.tsx      — renderer per P-6
```

`scoringKind` is the single field that drives **P-3** and **P-4**: statistics and tournament
scoring branch on it, so adding a cooperative game never requires touching the stats module.

Randomness comes from a server-held seeded RNG. Clients receive the seed only when equal
conditions require it, never the outcomes.

---

## 8. First game — Reaction Speed

Best of 5 rounds.

```text
lobby → both ready → synchronized countdown → round armed
  → server waits a random 1.5–4.0s (server-side crypto RNG)
  → game.round.started broadcast with server ts
  → each client sends game.action.request { roundId, type: 'tap' }
  → server records its own receive time per player
  → round ends when both have tapped, or after a 3s timeout
  → 5 rounds → most rounds won; tie = draw
```

Tapping before `round.started` is a **false start** and loses that round.

**Latency fairness.** Measuring purely by server arrival time punishes whoever has the worse
connection, which for a couple on different networks is a real unfairness rather than a
theoretical one. The server therefore keeps a rolling per-socket RTT estimate from its own
heartbeats and scores `receivedAt - roundStart - min(halfRTT, 150ms)`. The compensation is
computed entirely server-side from server-observed timings — the client never asserts a number —
so server authority is fully preserved.

Reaction Speed then proves: synchronized start, server-owned timing, per-action validation,
rounds, authoritative scoring, results, reactions, rematch, and reconnect.

**Four in a Row follows immediately** and proves the other half: turn ownership validation, illegal
move rejection, full-state restore on reconnect, and a genuinely different renderer — all with zero
changes to the platform. That is the real test of the game contract.

---

## 9. Database and migration plan

Versioned SQL under `supabase/migrations/`, applied with the Supabase CLI against the dev project.

`0001_init.sql` creates: `users`, `couples`, `pairing_requests`, `games`, `invitations`, `matches`,
`tournaments`, `tournament_games`, `lifetime_statistics` — following `docs/03` with these
deliberate refinements:

- `users.partner_label_name` / `users.partner_label_nickname` for **P-1**, plus
  `users.pairing_code` (unique) and `users.couple_id` (nullable FK).
- Membership uniqueness is enforced two ways: `users.couple_id` is a single column so a user
  cannot be in two couples by construction, and `couples` carries unique indexes on both
  `user_a_id` and `user_b_id` plus `CHECK (user_a_id <> user_b_id)`.
- `games.scoring_kind` and `games.renderer`, seeded from the games registry so the catalogue is
  data, not hardcoded UI (`docs/03`).
- `invitations` with the partial unique index from §5.
- `matches.expires_at` defaulting to `started_at + 7 days`, driving retention.
- `tournament_games.scored boolean` so **P-4** is explicit in the data.
- RLS enabled everywhere with deny-all, per §2.

Retention: a daily job deletes `matches` where `expires_at < now()`. Because of **P-5** the
aggregates are already updated, so deletion is lossless for statistics. This gets a unit test that
inserts a 8-day-old match and asserts both the deletion and the survival of the aggregate.

---

## 10. Local development

```bash
npm install                 # root, installs all workspaces
npm run db:migrate          # supabase migrations against the dev project
npm run db:seed             # game catalogue
npm run dev                 # web on :3000, server on :4000
npm run typecheck && npm run lint && npm run test && npm run build
npm run docker:server       # build/run the backend container
```

`.env.example` covers: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_WS_URL`, `APP_ORIGIN`, `PORT`, `NODE_ENV`. No real credentials, ever.

**Practical note:** testing pairing and multiplayer solo needs **two Google accounts and two
browser profiles** (one normal, one incognito is enough).

---

## 11. Slice sequence

| Slice | Content | Done when |
|---|---|---|
| 1 | Monorepo, tooling, design tokens, Docker, health endpoint | typecheck/lint/test/build green |
| 2 | Supabase Google auth, guarded routes, authenticated socket handshake | a real Google account reaches an empty dashboard |
| 3 | Onboarding incl. pet-name labels and preset avatars | profile persists, validation covered |
| 4 | Pairing codes, requests, accept/reject, permanent couple | two accounts pair for real |
| 5 | Couple dashboard, days-together, catalogue from DB, empty states | reads correct with zero matches |
| 6 | Presence, invitations, invalidation, TTL, counter-proposal, lobby, ready, countdown, reactions | realtime state tests pass |
| 7 | Reaction Speed end-to-end | full login→rematch loop on desktop and phone |
| 7b | Four in a Row | added with no platform changes |
| 8 | Match records, 7-day queries, lifetime aggregates, streaks, retention job | retention and streak tests pass |
| 9 | Tournaments: create, lock, sequential, 3/1/0, restart-on-failed-reconnect | tournament scoring tests pass |
| 10+ | Remaining games, mobile polish, deployment | — |

Each slice ends with typecheck, lint, tests, build, manual verification of the flow, and a report
of exactly what changed — per `CLAUDE.md` and `skills/testing-and-review.skill.md`.

---

## 12. Resolved assumptions

All four confirmed:

1. **Confirmed.** Rejecting a pairing request does not permanently block that requester from
   asking again. Re-requests are rate limited.
2. **Confirmed.** A tournament game that fails reconnect twice moves the tournament to `paused`,
   resumable from the dashboard, rather than restarting forever.
3. **Confirmed with amendment (P-8).** An abandoned match is written as a `matches` row with
   status `abandoned` — it stays visible in the 7-day raw history and expires like any other row —
   but it is **never counted anywhere**: not games played, not wins or losses, not time played,
   not streaks, not favourite game, and not the 7-day dashboard count. Every aggregate query and
   every completion-time snapshot filters `status = 'completed'`.
4. **Confirmed.** A tournament containing zero competitive games ends with no winner and a shared
   result screen.
