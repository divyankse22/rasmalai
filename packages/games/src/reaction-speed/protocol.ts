/**
 * What crosses the wire for Reaction Speed. Safe for the browser: no rules, no server state.
 *
 * Everything here is already resolved to one reader's point of view — `you` and `them` — for the
 * same reason `SessionView` is. A renderer that had to work out which seat it was would get it
 * wrong eventually, and it would get it wrong in front of somebody mid-game.
 */

/** Best of five (`docs/13` section 8). Every round is played; there is no early finish. */
export const ROUNDS = 5;

/** The random wait before a round goes live. Long enough that you cannot anticipate it. */
export const ARM_MIN_MS = 1_500;
export const ARM_MAX_MS = 4_000;

/** How long a live round waits for a tap before giving up on it. */
export const TAP_TIMEOUT_MS = 3_000;

/** The pause on the round result, so both of them get to read it before the next one arms. */
export const BREATHER_MS = 2_000;

/**
 * The most the server will forgive of one player's connection, from `docs/13` section 8.
 *
 * Compensation is not charity: measuring purely by arrival time means the partner on hotel wifi
 * loses every round to their router. Capping it stops a genuinely broken connection from being
 * turned into an advantage.
 */
export const MAX_COMPENSATION_MS = 150;

export type RoundPhase = 'arming' | 'live' | 'over';

export type RoundOutcome = 'won' | 'lost' | 'drawn';

/** Why a round ended, so the screen can say something better than a number. */
export type RoundEnding = 'tapped' | 'false-start' | 'nobody-tapped';

export interface RoundView {
  /** 1-based, because it is read by a person. */
  number: number;
  phase: RoundPhase;
  /** Server epoch ms the round went live, or null while it is still arming. */
  startedAt: number | null;
  /** Your reaction in ms — null until the round ends, or if you never tapped. */
  yourReactionMs: number | null;
  /** Theirs. Withheld until the round is over, so nobody plays off their partner's tap. */
  theirReactionMs: number | null;
  yourFalseStart: boolean;
  theirFalseStart: boolean;
  /** Set once the round is over. */
  outcome: RoundOutcome | null;
  ending: RoundEnding | null;
}

export interface ReactionSpeedView {
  rounds: number;
  roundNumber: number;
  yourRoundsWon: number;
  theirRoundsWon: number;
  /** The round being played, or the one just finished while the next arms. */
  current: RoundView;
  /** Finished rounds, oldest first. */
  history: RoundView[];
  /** Whether you have already tapped this round — the only thing you know before it ends. */
  youTapped: boolean;
  /** Your quickest tap so far, for a small brag on screen. */
  yourBestMs: number | null;
  /** True while a player is missing; the clock is stopped and the round will restart. */
  paused: boolean;
  complete: boolean;
}

/** The only thing a player can do. `round` makes a late frame from a finished round obvious. */
export interface ReactionTapAction {
  type: 'tap';
  round: number;
}

export type ReactionSpeedAction = ReactionTapAction;
