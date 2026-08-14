# Rasmalai Implementation Plan

## Phase 0 — Discovery lock

Before coding:
- read all specifications
- resolve questions
- produce Architecture Decision Record
- agree first game
- agree auth/session implementation
- agree exact database schema

Exit condition:
explicit user confirmation.

## Phase 1 — Repository foundation

- Next.js + TypeScript
- backend TypeScript service
- shared types/package if useful
- lint/typecheck/test
- environment configuration
- Docker backend
- local development commands
- basic design-system foundation

## Phase 2 — Authentication

- Google OAuth
- secure application session
- protected routes
- authenticated WebSocket handshake

## Phase 3 — Onboarding

Collect:
- actual name
- nickname
- birth year
- partner actual name
- partner nickname
- first-met date
- relationship location type
- avatar/profile image

Validate and persist.

## Phase 4 — Pairing

- generate private pairing code
- enter code
- create pairing request
- receiver Accept/Reject
- permanent pairing
- couple access rules

## Phase 5 — Couple dashboard

Implement:
- couple header
- avatars
- days together
- seven-day stats
- lifetime stats
- game catalogue
- tournament entry

## Phase 6 — Realtime session infrastructure

Implement:
- WebSocket auth
- presence
- invitation
- invitation invalidation
- invitation TTL
- lobby
- ready
- synchronized countdown
- active game session
- reconnect window
- reactions

Do not add game complexity until this works.

## Phase 7 — First game

Pick a simple game that validates:
- synchronized start
- server authority
- actions
- scoring
- result
- rematch
- mobile controls

Complete it end-to-end.

## Phase 8 — Results/statistics

- match record
- seven-day query
- lifetime aggregate
- streaks
- game performance
- tournament statistics

## Phase 9 — Tournament engine

- create
- choose games
- lock game list
- sequential matches
- 3/1/0 scoring
- restart affected game after failed reconnect
- final winner

## Phase 10 — Remaining games

Add games one at a time through the shared game contract.

Suggested sequence:
1. Four in a Row
2. Reaction Speed
3. Reflex
4. Basketball
5. Bomb Defusal
6. Memory
7. social game
8. another cooperative/casual game

## Phase 11 — Mobile polish

- touch controls
- gesture handling
- responsive layout
- orientation adaptation
- mobile performance

## Phase 12 — Deployment

- production environment
- Netlify
- Render
- Supabase
- domain
- WSS
- secure environment variables
- health checks

## Phase 13 — Final V1 polish

- cute animations
- avatar selection
- empty states
- reconnect messages
- error states
- loading states
- friendly microcopy
- accessibility
- performance

Do not add V2 features before V1's core loop is reliable.
