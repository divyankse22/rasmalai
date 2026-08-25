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
Netlify

Backend:
Render

Database:
Supabase PostgreSQL

Domain:
`mydomain.com` placeholder until actual domain is chosen.

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
