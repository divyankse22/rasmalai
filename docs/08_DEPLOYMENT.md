# Rasmalai Deployment Plan

## Local first

Initial development should run entirely locally.

Suggested services:
- Next.js frontend
- Node.js WebSocket backend
- PostgreSQL via Supabase development project, or local PostgreSQL if desired

Dockerize the backend.

## Production candidate

Frontend:
Vercel (switched from the originally-planned Netlify — see CLAUDE.md's Stack direction for why:
a fresh 2026 Netlify account's free tier is credit-based with much less effective bandwidth and
pauses the site on overage, where Vercel Hobby is a flat 100GB with first-party Next.js support).
WebSocket traffic bypasses this host entirely — the browser connects directly to the backend's
`NEXT_PUBLIC_WS_URL` — so this choice only affects how fast the app shell itself loads.

Backend:
Render, free tier. Its one real caveat: a free web service spins down after 15 minutes with no
inbound traffic (HTTP or WebSocket) and takes 30-60s to wake on the next request. WebSocket
traffic itself resets that timer, so this only affects the *first* reconnect after a genuine idle
gap, not anything mid-session. Worth a "waking up, hang tight" loading state on first connect
rather than hiding it. (Fly.io was considered and ruled out: it removed its free tier in 2024.
Oracle Cloud's Always Free VM would eliminate the cold start entirely but trades the built-in
git-push deploy pipeline for owning basic SSH/Docker ops — decided against for now in favour of
Render's zero-setup path.)

Database:
Supabase PostgreSQL

Domain:
Launching on each platform's free subdomain (`*.onrender.com`, `*.vercel.app`) — no custom domain
chosen yet. `mydomain.com` stays a placeholder until one is picked; swapping it in later only
means updating `APP_ORIGIN`, the Supabase redirect URLs, and the Google OAuth authorized origins —
nothing in the app code depends on the domain being fixed at launch.

## WebSocket

Production browser connects to secure WebSocket endpoint:
`wss://...`

The final hostname must be decided during deployment configuration.

## Environment variables

Never commit secrets.

Expected categories:
- Google OAuth client configuration
- application/session secrets
- database connection information
- frontend/backend URLs
- WebSocket endpoint
- environment name

Claude must create a safe `.env.example` without real credentials.

## Docker

Backend should have:
- deterministic dependency installation
- production build
- health endpoint
- graceful shutdown
- non-root container if practical
- explicit port configuration

## Health

Expose a lightweight health/readiness endpoint.
Do not expose database credentials or sensitive runtime information.

## CI

For the initial weekend project, keep CI simple:
- install
- typecheck
- lint
- unit tests
- build

Deployment automation can be added once local functionality is stable.
