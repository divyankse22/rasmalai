# Implementation Progress

Companion to `docs/13_ARCHITECTURE_PROPOSAL.md`. That document records **intent** — the locked
decisions. This one records **state**: what exists, what has actually been verified, and what is
knowingly incomplete.

Update it at the end of every slice.

Last updated: end of slice 4.

---

## Slice status

| Slice | Scope | Status |
|---|---|---|
| 1 | Monorepo, tooling, design tokens, Docker, health endpoint | **done, verified** |
| 2 | Supabase Google auth, guarded routes, authenticated socket | **done, verified** |
| 3 | Onboarding, first migration, profiles, pairing codes | **done, verified** |
| 4 | Pairing: codes, requests, accept/reject, permanent couple | **done, verified** |
| 5 | Couple dashboard | next |
| 6 | Realtime: invitations, TTL, lobby, ready, countdown, reactions | not started |
| 7 | Reaction Speed (first game, end to end) | not started |
| 7b | Four in a Row | not started |
| 8 | Results, statistics, retention job | not started |
| 9 | Tournaments | not started |
| 10+ | Remaining games, mobile polish, deployment | not started |

Gate at the time of writing: **96 tests passing**, typecheck, lint and both builds green
(`npm run verify`).

---

## What exists

### Repository

npm workspaces monorepo: `apps/web` (Next.js 16), `apps/server` (Node + Express 5 + ws),
`packages/shared` (protocol), `supabase/migrations`.

`packages/shared` is source-only — no build step. The server bundles it with tsup; the web app
transpiles it. All relative imports are extensionless, because every consumer is a bundler and
Next's bundler will not resolve `.js` to `.ts`.

### Backend

- `/healthz` exposing nothing about the environment, and SIGTERM handling with a 10s grace period.
- `createTokenVerifier` — verifies Supabase access tokens against the project's public JWKS,
  asserting **both** issuer and audience. The audience check is what stops an `anon` token from
  being accepted as a signed-in user.
- WebSocket at `/ws`: identity is proven in the first frame, anonymous sockets are closed after
  10s, multiple sockets per user are allowed, expired tokens are dropped on the next heartbeat.
- `requireUser` middleware: the user id comes from the verified token and nowhere else.
- `GET /api/me`, `POST /api/onboarding`, `GET /api/pairing`, `POST /api/pairing/requests`,
  `POST /api/pairing/requests/:id/respond`, `POST /api/pairing/requests/:id/cancel`.
- Every SQL column that joins two tables is aliased. `pairing_requests` and `users` both have an
  `id`, and node-postgres lets a later column silently overwrite an earlier one — which handed back
  a user id as a request id and broke accept with a 404.
- In-memory fixed-window rate limiting on pairing code submission, so a code cannot be ground down.
- A notifier that lets HTTP routes push events to a person's open sockets, which is how an accept
  reaches the other partner without polling.
- Migration runner (`npm run db:migrate`): ordered `.sql` files, one transaction each, tracked in
  `public.schema_migrations`. Idempotent.

### Database

`public.users`, `public.couples` and `public.pairing_requests`. Everything is keyed to
`auth.users.id` with `on delete cascade`, and RLS is enabled with **zero policies** — the deny-all
backstop from `docs/13` section 2. The Google subject and email are deliberately *not* duplicated
here; `auth.users` already holds them.

"At most one couple per person" is enforced by `users.couple_id`: a single column cannot hold two
values, which unique indexes on the couples table alone could not guarantee. "One pending request
per pair" is a partial unique index over the normalised pair, so it holds in either direction.

### Web

Google sign-in via `@supabase/ssr` with httpOnly cookies, `proxy.ts` for optimistic redirects and
cookie refresh, `getUser()` in pages for the authoritative check, onboarding form, a pairing screen
that updates itself when a request arrives or is answered, and a couple dashboard.

Routing between them is by state, not by navigation: no profile sends you to `/onboarding`, no
couple sends you to `/pairing`, and a couple sends you to `/dashboard`.

The entire visual identity is `apps/web/src/design-system/theme.css`. Swap that file to reskin.

---

## Verified, with evidence

Not "it compiles" — these were actually run.

- Docker image builds, runs as non-root (`uid=1000`), reports `healthy`, logs JSON in production,
  and exits 0 on SIGTERM in 0.2s.
- Socket rejects: silent connections (4408), garbage tokens, forged tokens, and actions sent
  before authenticating (4401). A forged-but-well-formed token produced `JWKSNoMatchingKey`,
  which is only reachable *after* the real key set was fetched — proving the JWKS wiring is live.
- Socket **accepts** a genuinely Supabase-signed token and derives the right user id.
- `/dashboard` returns 307 to `/` when signed out.
- `NEXT_PUBLIC_*` values from the single root `.env` are inlined into the client bundle.
- Full onboarding path against the real database: null profile → validation errors with field
  names → 201 with pairing code → read back → 409 on repeat → row confirmed in Postgres →
  cascade-deleted with the auth user.
- Full pairing path with three real users: own code refused, unknown code refused, request
  delivered over the partner's socket, duplicate and reverse-direction requests refused, neither
  the requester nor a stranger able to answer, **two simultaneous accepts resolving to exactly one
  couple (200 and 409)**, both sides agreeing on the partner and the date, and pairing proving
  permanent afterwards.

---

## Known limitations, accepted for now

1. **Live game sessions do not survive a backend restart.** Invitations and matches persist;
   in-flight match state is memory-only. A restart mid-game returns both players to the dashboard.
   Persisting live state is the complexity `docs/02` tells us not to add yet.
2. **`supabase/prod-ca.crt` is trust-on-first-use.** It was extracted from the live TLS chain
   because Supabase's published CA URL now 404s. Replace it with the copy from the project's
   Connect panel; the SHA-256 fingerprint must be
   `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
   Certificate verification is fully on — `rejectUnauthorized: false` was deliberately not used.
3. **The Email auth provider is still enabled** on the Supabase project, leaving an
   email/password signup path open on a product that is meant to be Google-only and invisible.
4. **Nobody has completed a pairing through the browser yet.** Sign-in, onboarding and the pairing
   screens have all been exercised; the final accept is left for the couple, since it is permanent.
5. **`apps/web/AGENTS.md` and `apps/web/CLAUDE.md` are generated by `next dev`**, not hand-written.
   Committing them keeps the working tree clean.

---

## Environment notes

- One root `.env` serves both workspaces; `next.config.ts` loads it so the values are not
  duplicated. `.env.example` marks which slice first needs each variable.
- Supabase project is on `ap-south-1`, signing with **ES256** (asymmetric), so no JWT secret
  exists to leak.
- Connection uses the **session** pooler on 5432, not the transaction pooler on 6543: the backend
  is a long-lived process, not a serverless function.
- Testing pairing needs **two Google accounts and two browser profiles**, both added as Test users
  in Google Auth Platform → Audience.
