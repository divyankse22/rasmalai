# Rasmalai System Architecture

## 1. Architecture principle

Build a modular monolith, not microservices.

At V1 scale, one web application, one realtime backend, and one PostgreSQL database are sufficient.

## 2. High-level architecture

Browser:
- Next.js + TypeScript
- React UI
- Phaser game runtime
- WebSocket client

Backend:
- Node.js + TypeScript
- HTTP API for non-realtime operations
- WebSocket server for active game/session events
- authoritative game-session orchestration

Database:
- PostgreSQL via Supabase

Deployment:
- Netlify: frontend
- Render: backend
- Supabase: PostgreSQL
- Docker: backend packaging

## 3. Responsibilities

### Next.js
Owns:
- routes
- onboarding UI
- authentication UI integration
- dashboard
- game catalogue
- invitations
- lobby shell
- tournament configuration
- results
- statistics presentation

### Phaser
Owns:
- game canvas
- rendering
- animations
- local input
- local presentation
- game-specific client state
- touch/gesture controls

Phaser must not:
- query PostgreSQL
- implement authentication
- manage couple permissions
- directly mutate server state
- trust its own score as authoritative

### Backend
Owns:
- authentication/session validation
- couple permissions
- pairing
- invitations
- game session lifecycle
- player presence
- synchronization
- server time
- random seeds/events
- authoritative scoring
- tournament orchestration
- match completion
- retention jobs
- statistics aggregation

### PostgreSQL
Owns persistent data:
- users
- couples
- pairing requests
- game metadata
- matches
- tournament definitions/results
- lifetime aggregates
- profile/avatar metadata

Ephemeral room/game state stays in backend memory for V1 unless persistence is required for reconnection.

## 4. Logical modules

Backend:
- auth
- users
- couples
- pairing
- invitations
- presence
- game-sessions
- games
- tournaments
- statistics
- retention

Frontend:
- auth
- onboarding
- couple
- dashboard
- games
- lobby
- tournament
- profile
- realtime
- design-system

Game packages/modules:
- shared game contract
- basketball
- four-in-row
- reaction
- reflex
- bomb-defusal
- puzzle
- boat-escape
- survival
- social/casual games

## 5. State ownership

Persistent state:
PostgreSQL.

Ephemeral session state:
backend memory.

Authoritative active match state:
backend.

Rendered state:
client.

A client sends an intent/action. The server validates it, updates authoritative state, then emits an event/state update to clients.

## 6. No unnecessary polling

WebSocket presence/events are authoritative during an active session.
Do not poll every 5 seconds merely to detect partner presence.

Polling may be used only for a justified non-realtime UI need.

## 7. Scaling

Expected:
- 200 users
- 70–80 concurrent

A single Node.js backend instance is an appropriate starting point.
Avoid Redis/queues/microservices until load or reliability evidence requires them.

## 8. Security boundary

Client:
“Here is the action I attempted.”

Server:
“Here is the validated result.”

Never accept:
- client-provided winner
- client-provided score
- client-provided match completion
- arbitrary couple_id
- arbitrary player_id

The server derives these from authenticated session and active game state.

## 9. Future extensibility

Potential later modules:
- voice
- chat
- individual mode
- inter-couple sessions
- relationship progression
- achievements
- notifications
- analytics

Do not implement them in V1.
