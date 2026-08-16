# Rasmalai Realtime Architecture and WebSocket Protocol

## 1. Principle

The backend is authoritative.

Client sends:
- intent/action
- input relevant to the current game

Server decides:
- whether action is valid
- timing
- score
- game state
- winner
- random events
- match completion

## 2. Connection lifecycle

authenticated browser
→ WebSocket connect
→ authenticate socket using existing application session/token
→ server derives user and couple
→ client receives connection status
→ client joins permitted lobby/game session

## 3. Generic event envelope

Use a consistent envelope concept such as:

```json
{
  "type": "event.name",
  "requestId": "optional-client-generated-id",
  "timestamp": 0,
  "payload": {}
}
```

Do not finalize field names without reviewing the actual auth/session strategy.

## 4. Suggested event families

### Pairing
- pairing.request.created
- pairing.request.accepted
- pairing.request.rejected

### Invitation
- game.invitation.created
- game.invitation.accepted
- game.invitation.rejected
- game.invitation.expired
- game.invitation.invalidated

### Lobby
- lobby.joined
- lobby.player.ready
- lobby.player.unready
- lobby.starting
- lobby.started

### Presence
- player.connected
- player.disconnected
- player.reconnected
- session.reconnect_window_started
- session.reconnect_window_expired

### Game
- game.action.request
- game.state.updated
- game.event
- game.round.started
- game.round.ended
- game.finished

### Results
- match.result
- tournament.game.result
- tournament.updated

### Reactions
- reaction.sent

## 5. Server timestamps

Competitive games should use server timestamps when timing matters.

Do not compare browser clocks for fairness.

## 6. Reconnection and the move clock

Default active-session window:
120 seconds.

Behavior is game-specific.

There is one clock, and two ways onto it:

- **Being away** — no socket, or a socket that is not on the game's page. Each player has their own
  deadline, so both of them can be on it at once.
- **Being on the move** — the seat the game names through `turnOf`, during an active match. It
  restarts when the turn changes, and it does not run while anybody is away, because an action is
  refused in that state anyway.

A connected player who never moves and a player who walked out are the same thing from the other
side of the board, and are waited on the same way.

When the clock runs out, whoever is at fault loses:

- one at fault → the other player takes it (1–0, flagged as a forfeit rather than a scoreline);
  a game with no winner to award simply stops
- both at fault → nobody won anything; the session closes and counts towards nothing (P-8)

Both away resolves at the **later** of the two deadlines, so somebody who still has time on their
own clock can come back and claim it. The same window runs outside an active match, where nothing
is at stake but a session both of them have left must still stop holding the couple's one slot.

Tournament default:
- disconnect
- hold/reconnect for 120 seconds
- if player reconnects, game-specific restoration may occur
- if not, restart the affected tournament game

The game contract must explicitly declare its reconnection policy, and must name the seat it is
waiting on so the platform can run the move clock without knowing anything about the game.

## 7. Invitation lifecycle

Only one active invitation per couple.

New invitation:
- invalidate previous invitation
- create new invitation

Invitation TTL:
5 minutes.

## 8. Active session

Only one active game session per couple in V1.

## 9. Reaction event

Reaction is ephemeral:
client → server → permitted partner → UI animation → disappears.

Do not persist.

## 10. Determinism

For games requiring equal conditions:
server creates seed/configuration
→ both clients receive same seed/config
→ server remains authoritative for outcomes

## 11. Error handling

The server should return structured errors:
- not_authenticated
- not_authorized
- invalid_action
- invalid_game_state
- invitation_expired
- invitation_invalidated
- session_not_found
- reconnect_window_expired
- already_in_game
- pairing_required

Do not expose sensitive server internals.
