# Multiplayer Engineering Skill

## Principles

- Server authoritative.
- Clients send intents, not outcomes.
- Server owns authoritative time.
- Validate every action.
- Use deterministic seeds when equal conditions matter.
- Separate persistent state from ephemeral session state.
- Reconnection is a first-class state transition.
- Never trust room IDs or couple IDs from clients without authorization.

## Required states

At minimum reason explicitly about:
- disconnected
- connecting
- connected
- invited
- invitation expired
- lobby
- ready
- countdown
- active
- paused/reconnecting
- finished
- cancelled/restarted

## Testing

Every multiplayer game should test:
- simultaneous connection
- duplicate action
- invalid action
- stale action
- disconnect
- reconnect
- timeout
- refresh
- race conditions between player actions
