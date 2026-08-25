# Architecture Decision Record

## ADR-001: Browser-first

Decision: Build Rasmalai as a browser application.

Reason:
- target is mobile-responsive
- no installation requirement
- domain-based experience
- easy distribution to two people
- dashboard and games share one environment

## ADR-002: Phaser instead of Godot

Decision: TypeScript + Phaser.

Reason:
- browser-native
- TypeScript ecosystem
- easier integration with Next.js
- touch/gesture support
- appropriate for 2D mini-games
- avoids embedding a separate game runtime in a web product

## ADR-003: Node.js WebSocket backend

Decision: Node.js + TypeScript + WebSocket.

Reason:
- existing TypeScript ecosystem
- small expected scale
- direct control over authoritative realtime behavior
- modular game session architecture
- avoids unnecessary third-party multiplayer abstraction

## ADR-004: PostgreSQL

Decision: PostgreSQL through Supabase.

Reason:
- relational data fits users/couples/matches/tournaments
- strong constraints
- simple querying
- adequate scale

## ADR-005: Modular monolith

Decision: one backend service.

Reason:
- V1 scale is tiny
- faster development
- easier debugging
- fewer deployment failure modes

## ADR-006: Permanent pairing

Decision: pairing is permanent in V1.

Reason:
- product is explicitly private and couple-centric
- dramatically simplifies authorization and discovery

## ADR-007: Server authority

Decision: server authoritative for competitive outcomes.

Reason:
- fairness
- synchronization
- anti-cheat
- consistent results

## ADR-008: Raw match retention = 7 days

Decision: raw match history expires after 7 days; lifetime aggregates remain.

Reason:
- desired product behavior
- reduced storage
- simpler privacy model

## ADR-009: One active game per couple

Decision: one active game session.

Reason:
- prevents conflicting game state
- simple UX
- matches couple experience

## ADR-010: One active invitation

Decision: new invitation invalidates the previous invitation.

Reason:
- removes ambiguous pending game choices.

## ADR-011: No voice/chat/sound/music in V1

Decision: omit.

Reason:
- weekend scope
- focus on core gaming loop
- extension points remain possible.

## ADR-012: No public discoverability

Decision: private couple-only V1.

Reason:
- privacy
- simpler authorization
- no moderation requirement.

## ADR-013: Future inter-couple play

Decision: do not implement now, but retain first-class Couple entity.

Reason:
- future competitions can treat a couple as a participant without redesigning current data model.
