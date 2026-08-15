/**
 * The contract every Rasmalai game is written against.
 *
 * `docs/05_GAME_SDK.md` is the requirement: a game must be replaceable, and adding one must not
 * touch authentication, pairing, invitations, the lobby, the database or deployment. Everything a
 * game is allowed to know is in this file.
 *
 * What a game therefore never sees: user ids, couples, sockets, Postgres, or which half of the
 * couple is which. Players are `0` and `1` — two seats at a table. The platform maps seats to
 * people on the way in and out, and it is the only thing that can.
 *
 * The rules are **pure**. They own no timers, hold no sockets, and never reach for a clock: every
 * moment that matters arrives as an argument, and every moment they want in the future is handed
 * back through `nextTickAt`. That is what makes an entire match reproducible in a unit test, and it
 * is what keeps the server the single authority on timing (`docs/04` section 5).
 */

import type { SessionPlayer } from '@rasmalai/shared';

export type GameCategory = 'competitive' | 'cooperative' | 'social' | 'casual';

/** P-6: each game picks the cheapest renderer that works. */
export type Renderer = 'react' | 'phaser';

/** A seat, not a person. */
export type PlayerIndex = 0 | 1;

export const PLAYERS: readonly PlayerIndex[] = [0, 1];

/** The other seat. */
export function opponentOf(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

export interface GameMeta {
  slug: string;
  name: string;
  category: GameCategory;
  /**
   * What this game does to statistics and to tournament points, which is deliberately separate from
   * where the catalogue files it (P-3, P-4). A game could sit in the casual aisle and still be
   * scored competitively.
   */
  scoringKind: GameCategory;
  renderer: Renderer;
  players: 2;
  orientation: 'any' | 'portrait' | 'landscape';
  inputs: readonly ('tap' | 'swipe' | 'keyboard' | 'pointer')[];
}

export interface ReconnectPolicy {
  /** `docs/04` section 6 fixes the platform default at 120 seconds. */
  windowMs: number;
  /**
   * Whether the game's clock stops while a player is missing. A timed game must say yes, or the
   * absent player loses rounds they were never shown.
   */
  pauseOnDisconnect: boolean;
  /** What the platform does when the window runs out. Individual matches abandon (P-8). */
  onExpire: 'abandon' | 'restart';
}

/**
 * Everything non-deterministic a game is allowed to touch.
 *
 * Randomness is the server's, never the client's, and never the game's own (`docs/04` section 10).
 * Passing it in is also what lets a test replay an entire match with a fixed sequence.
 */
export interface GameContext {
  /** Uniform in [0, 1), from the server. */
  random(): number;
}

/**
 * When an action reached the server, and how much of that was the wire.
 *
 * Both numbers are server-observed. A client never asserts its own timing — it says "I tapped",
 * and the server decides when that was (`docs/02` section 8).
 */
export interface ActionTiming {
  /** Server clock when the frame arrived. */
  receivedAt: number;
  /**
   * Estimated one-way delay from that player, already capped by the platform. Subtracting it is
   * what stops the partner on worse wifi from losing every round to their connection rather than
   * their thumb.
   */
  compensationMs: number;
}

export type ValidationResult<Action> =
  | { ok: true; action: Action }
  | { ok: false; code: 'invalid_action' | 'invalid_game_state'; message: string };

/**
 * Something the platform should tell the players about.
 *
 * Only a name: the payload is always the session view, which already carries the whole game state
 * rendered for that reader. One shape of frame means the client has no partial updates to merge and
 * no chance of applying two of them out of order.
 */
export interface GameEvent {
  /** A name from `EVENTS.game.*`. */
  type: string;
  /** Who is told. Omitted means both — the usual case. */
  to?: PlayerIndex;
}

export interface Transition<State> {
  state: State;
  events: readonly GameEvent[];
}

export interface GameResult {
  /** Null on a draw, and on every game whose `scoringKind` is not competitive. */
  winner: PlayerIndex | null;
  draw: boolean;
  /**
   * The authoritative match score per seat. Higher is always better, so a game where lower is
   * faster reports rounds won rather than milliseconds — the same rule `matches.score_a` follows.
   */
  scores: [number, number];
}

/**
 * `State` is the server's private, authoritative state. `View` is what one player is allowed to
 * see — the two are different types on purpose, so a game that holds a secret cannot leak it by
 * accident.
 */
export interface GameRules<State, Action, View> {
  readonly meta: GameMeta;
  readonly reconnectPolicy: ReconnectPolicy;

  createMatch(now: number, context: GameContext): State;

  /** Shape and legality. Returning `ok` is the only way an action reaches `applyAction`. */
  validateAction(state: State, player: PlayerIndex, action: unknown): ValidationResult<Action>;

  applyAction(
    state: State,
    player: PlayerIndex,
    action: Action,
    at: ActionTiming,
    context: GameContext,
  ): Transition<State>;

  /** The clock reached `nextTickAt`. Timed games advance here; turn-based games do nothing. */
  tick(state: State, now: number, context: GameContext): Transition<State>;

  /**
   * When `tick` next needs calling, or null when the game is waiting on a player rather than on
   * time. The platform holds exactly one timer per match, so a game must not poll.
   */
  nextTickAt(state: State): number | null;

  /**
   * A player's connection dropped. Returns state with anything in flight discarded — a round nobody
   * could see must not be scored.
   */
  pause(state: State, now: number): State;

  /** They made it back. Restarts from a clean point rather than resuming mid-flight. */
  resume(state: State, now: number, context: GameContext): Transition<State>;

  getView(state: State, player: PlayerIndex): View;

  isComplete(state: State): boolean;

  /** Only meaningful once `isComplete` is true. */
  getResult(state: State): GameResult;
}

/**
 * What every renderer is handed.
 *
 * The two players arrive already resolved to `you` and `partner`, exactly as the lobby resolves
 * them, so a game never works out which seat it is drawing for. `act` sends an intent — never an
 * outcome, never a score (`docs/02` section 8).
 */
export interface GameRenderProps<View = unknown> {
  view: View;
  you: SessionPlayer;
  partner: SessionPlayer;
  act(action: unknown): void;
}

/**
 * A rules object with its types forgotten, which is all the platform can hold.
 *
 * The methods above are declared as methods rather than properties on purpose: TypeScript checks
 * method parameters bivariantly, so a concrete rulebook still fits here. The types are enforced
 * where each game declares its own rules, which is the only place they can be checked honestly.
 */
export type AnyGameRules = GameRules<unknown, unknown, unknown>;
