# Rasmalai Security and Privacy Requirements

## Authentication

Google OAuth only in V1.

Never store:
- Google passwords
- OAuth client secrets in frontend
- access tokens in unsafe persistent browser storage

Use the framework/provider-supported secure session strategy.

## Authorization

A user may access:
- their own account
- their own couple
- their paired partner's permitted couple-visible information
- active game sessions belonging to their couple

No user may:
- query another couple
- modify another couple's matches
- join an arbitrary game session by guessing an ID
- submit arbitrary winner/score data

## Pairing

Pairing codes must be sufficiently random.
Do not use sequential IDs as pairing codes.

Pairing acceptance must be performed server-side.

Once paired in V1, the pair is permanent.

## Game security

Server validates:
- player identity
- couple membership
- active session
- game state
- action validity
- timing where relevant
- score
- winner

## Realtime security

Authenticate WebSocket connections.
Do not assume a socket is authorized merely because it knows a room/session ID.

## Rate limiting

At minimum consider:
- pairing requests
- game invitations
- reaction events
- WebSocket action frequency
- authentication-related endpoints

Do not overengineer before measuring, but protect obvious abuse paths.

## Privacy

No public discoverability in V1.
Couple data is private.
Relationship metadata is private.
Do not expose exact personal profile data to anyone outside the couple.

## Retention

Raw match history expires after 7 days.
Lifetime aggregates remain.

Implement deletion deterministically and test it.

## Ads

Avoid ads as much as possible in V1.
Do not design core UX around ad placements.
