# Claude Code Operating Contract — Rasmalai

You are implementing Rasmalai from the specifications in this repository.

## Non-negotiable process

BEFORE modifying or creating application code:

1. Read every file under `docs/`.
2. Read every file under `skills/`.
3. Build a concise understanding of the product, architecture, data model, realtime lifecycle, and game SDK.
4. Ask the user questions whenever:
   - two requirements conflict,
   - a requirement is ambiguous,
   - an implementation choice materially changes user experience,
   - security/privacy implications are unclear,
   - the selected technology cannot cleanly satisfy a requirement.
5. Keep asking focused questions until both sides explicitly agree that they are on the same page.
6. Do NOT silently choose a product behavior merely because it is convenient to code.
7. Do NOT delete or rewrite existing work wholesale if this repository later contains implementation. Preserve useful code and make targeted changes.
8. Before major architectural changes, explain the proposed change and its consequences.
9. Prefer the simplest architecture that satisfies the current scale: roughly 200 registered users and up to 70–80 concurrent users.
10. Do not introduce Redis, queues, microservices, Kubernetes, or other infrastructure unless a measured requirement justifies it.

## Product priorities

1. The couple must be able to play together reliably.
2. Multiplayer correctness and synchronization matter more than visual polish.
3. The code must be modular enough to add games and future features.
4. Keep the V1 cute, fast, and simple.
5. Do not overengineer for hypothetical scale.

## Stack direction

- Next.js + TypeScript for the web application
- Phaser 3 + TypeScript for games
- Node.js + TypeScript WebSocket backend
- Google OAuth
- PostgreSQL via Supabase
- Vercel for frontend (switched from the original Netlify pick: a fresh Netlify account's 2026 free
  tier is credit-based, ~15GB/month effective bandwidth, and pauses the site on overage; Vercel's
  Hobby plan is a flat 100GB with first-party Next.js support — decided with the user 2026-08-25)
- Render for backend
- Dockerize the backend
- Local development first

## Security

Never store Google credentials.
Use authenticated application sessions/tokens.
All couple resources are private and scoped to the authenticated couple.
Never trust a client for competitive outcomes.
The server is authoritative for competitive game actions, timing, scoring, randomness, and match completion.

## Realtime

Use WebSockets for active sessions. Do not implement unnecessary five-second polling for partner presence when a WebSocket connection can provide connection state.

## Delivery discipline

Work in vertical slices:
1. project foundation
2. authentication
3. onboarding
4. permanent pairing
5. dashboard
6. invitation/lobby
7. one game
8. results/statistics
9. tournament foundation
10. remaining games

After each slice:
- run tests
- run type checking
- run linting
- manually verify the relevant user flow
- report exactly what changed

## Game architecture

Games must be isolated modules. A game must not directly know about:
- Google OAuth
- PostgreSQL
- couple records
- account management
- deployment
- unrelated UI

Games communicate through a platform game-session contract and validated player actions.

## Current V1 game categories

Competitive:
- Basketball
- Four in a Row
- Reaction Speed
- Reflex

Cooperative:
- Bomb Defusal
- Puzzle Solving
- Boat Escape
- Survival

Social:
- Who's More Likely
- Never Have I Ever
- Would You Rather
- Guess My Answer
- Couple Trivia
- Truth/Dare-style games

Casual:
- Drawing
- Word games
- Memory games

Everything is unlocked in V1.

## UX constraints

- Browser-based at `mydomain.com` in production.
- Mobile responsive.
- Games themselves must support mobile input using tap, swipe, touch controls, gestures, etc. where appropriate.
- Automatically adapt between portrait and landscape where practical.
- Cute/cartoon visual direction, abstract/cute avatars, rounded UI, soft visual language, small animations.
- Visual design must be themeable and replaceable later.
- No voice chat in V1.
- No text chat in V1.
- No sound/music in V1.
- Reactions such as 😂 ❤️ 😭 😡 👀 are available during games and disappear immediately.
- No public discoverability in V1.
- No cross-couple access.
- One active game session per couple.
- One active game invitation per couple. Sending a new invitation quickly invalidates the previous one.
- Game invitations expire after 5 minutes.
- Pairing requests remain pending indefinitely until accepted/rejected.
- Pairing is permanent in V1.
- Tournament games are selected before starting and locked after the tournament begins.
- Both partners can create tournaments.
- V1 supports two players only.

## Reconnection

Connection behavior depends on the game, but the platform must expose reconnection lifecycle support.
For tournament games, if a player disconnects and fails to reconnect within the 120-second reconnection window, the current game is restarted rather than silently awarding a win.

## Data retention

Raw match history exists for the last 7 days only.
Lifetime aggregate statistics remain.
The app should calculate “days together” from the exact first-met date.

## Do not prematurely implement V2

V2 ideas include:
- individual games when a partner is absent
- inter-couple competitions
- relationship-level game unlocking
- chat
- voice
- sound/music
- richer achievements

Design extension points, but do not build these features unless explicitly requested.
