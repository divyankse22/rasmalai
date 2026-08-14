# Rasmalai Testing Strategy

## Priority

Realtime correctness > game polish.

## Unit tests

Test:
- pairing rules
- invitation invalidation
- invitation expiry
- tournament scoring
- game scoring
- game action validation
- win/draw/loss
- streak calculation
- seven-day retention logic
- days-together calculation

## Integration tests

Test:
- Google-authenticated user can create profile
- pairing request
- acceptance
- couple authorization
- invitation
- lobby
- match lifecycle
- result persistence
- statistics update

## Realtime tests

At least simulate:
- both players connect
- one disconnects
- reconnect within 120 seconds
- reconnect after timeout
- invalid action
- duplicate action
- stale action
- second invitation invalidating first

## End-to-end tests

Critical path:
```text
Google auth
→ onboarding
→ pair
→ dashboard
→ invite
→ accept
→ lobby
→ game
→ result
→ rematch
```

## Mobile tests

At least test:
- touch input
- portrait
- landscape
- small screen
- no hover dependency

## Manual game testing

Test with:
- normal latency
- artificial latency
- packet loss where practical
- tab backgrounding
- browser refresh
- temporary Wi-Fi loss
- mobile network switching

Do not claim multiplayer reliability without testing disconnect/reconnect behavior.
