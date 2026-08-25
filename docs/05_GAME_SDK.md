# Rasmalai Game Module Contract

## Purpose

Every game must be a replaceable module.

Adding a new game should not require rewriting:
- authentication
- couple management
- dashboard
- PostgreSQL access
- invitation logic
- tournament orchestration
- deployment

## Conceptual lifecycle

```text
registered
→ invited
→ accepted
→ lobby
→ ready
→ countdown
→ round(s)
→ finished
→ results
```

## Game responsibilities

A game defines:
- metadata
- supported input
- player count = 2
- game configuration
- client presentation
- player action format
- server-side validation rules
- scoring rules
- win/draw/loss behavior
- round structure
- randomness requirements
- reconnect policy
- mobile input requirements

## Game must NOT own

- Google auth
- user account creation
- couple pairing
- direct database access
- invitation creation
- cross-couple authorization
- deployment
- global statistics persistence

## Suggested conceptual interface

```ts
interface GameDefinition {
  id: string;
  slug: string;
  name: string;
  category: GameCategory;
  version: string;

  createMatch(config: MatchConfig): ServerGameState;

  validateAction(
    state: ServerGameState,
    player: PlayerRef,
    action: unknown
  ): ValidationResult;

  applyAction(
    state: ServerGameState,
    player: PlayerRef,
    action: unknown
  ): GameTransition;

  getResult(state: ServerGameState): GameResult;

  getReconnectPolicy(): ReconnectPolicy;
}
```

This is conceptual. Claude must adapt it to the actual code architecture rather than blindly copying it.

## Client-side concept

The Phaser game receives:
- initial game configuration
- server state/events
- local input

It emits player intents through the platform realtime client.

## Input abstraction

Each game should support appropriate:
- mouse
- keyboard
- tap
- swipe
- touch buttons
- gestures

Do not force one input model onto every game.

## Responsive design

Each game declares its layout preference but should adapt where feasible:
- portrait
- landscape
- desktop
- tablet
- mobile

## Game categories

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
- Truth/Dare-style

Casual:
- Drawing
- Word
- Memory

## Recommended first game

Choose a game that validates the platform rather than maximizing visual complexity.

A simple reaction/reflex game or Four in a Row is a strong first vertical slice because it validates:
- synchronized start
- authoritative actions
- scoring
- rounds
- result calculation
- reactions
- rematch
- reconnect behavior

Claude should propose the first game and explain why before implementing it.
