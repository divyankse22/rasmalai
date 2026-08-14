# Claude Start Here

You are not authorized to start coding immediately.

## Step 1

Read:
- `CLAUDE.md`
- all files under `docs/`
- all files under `skills/`

## Step 2 — inspect repository

Determine:
- whether code already exists
- package manager
- existing framework
- existing environment files
- git state
- existing dependencies
- existing configuration

Do not delete existing work.

## Step 3 — requirements interview

Ask the user only questions that are still unresolved after reading the repository and specs.

Specifically verify before implementation:
- exact Google OAuth/session approach
- Supabase auth vs application-managed OAuth/session
- exact frontend/backend repository structure
- WebSocket library choice
- first game for the vertical slice
- exact retention implementation
- profile image storage strategy
- whether local PostgreSQL or Supabase development DB is preferred
- exact domain only when deployment starts

If a decision has already been made in the docs, do not ask it again.

## Step 4 — architecture proposal

Before coding, present:
- final component architecture
- data flow
- auth flow
- pairing flow
- invitation flow
- WebSocket lifecycle
- reconnect behavior
- first game's lifecycle
- database migration plan
- local development commands

Ask for confirmation.

## Step 5 — implementation

Implement the smallest complete vertical slice.

The first success criterion is:

Google login
→ onboarding
→ pair
→ dashboard
→ invitation
→ acceptance
→ lobby
→ synchronized game
→ result
→ rematch.

## Step 6 — after each milestone

Report:
- files changed
- architecture impact
- tests
- known limitations
- next milestone

Do not silently expand scope.
