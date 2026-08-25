# Rasmalai UX and State Flows

## New user

```text
Landing
→ Google Sign In
→ Onboarding
→ Account created
→ Pairing code shown
→ Enter partner code OR share own code
→ Pending / paired
→ Couple dashboard
```

## Pairing request

Requester:
```text
Enter partner code
→ request sent
→ wait
```

Receiver:
```text
Pairing request
"Divyank wants to pair with you ❤️"
→ Accept / Reject
```

Pending requests remain indefinitely.

Pairing is permanent in V1.

## Dashboard

```text
Couple identity
→ days together
→ weekly statistics
→ lifetime statistics
→ game catalogue
→ tournament entry
```

## Game invitation

```text
A selects game
→ B receives invitation
→ ❤️ PLAY
or
→ 🙈 NOT NOW
```

New invitation invalidates old active invitation.
Invitation expires after 5 minutes.

## Lobby

```text
Game accepted
→ lobby
→ both players connected
→ ready state
→ synchronized countdown
→ game
```

## Disconnect

```text
player disconnects
→ partner sees friendly reconnect state
→ session held for up to 120 seconds
→ player reconnects
→ game-specific restore/resume behavior
```

Tournament default if reconnection fails:
restart affected game.

## Game result

```text
game finishes
→ authoritative result
→ cute result animation
→ individual score
→ tournament score if applicable
→ rematch
or
→ choose another game
or
→ dashboard
```

## Mobile

All game controls must be touch-friendly.
Examples:
- tap
- swipe
- gesture
- virtual buttons

No hover-only interaction.

## Reactions

During game:
tap reaction
→ realtime partner display
→ ephemeral animation
→ disappears

## Visual system

Centralize:
- colors
- typography
- spacing
- radii
- shadows
- animation timings
- component variants

The visual theme must be replaceable.
