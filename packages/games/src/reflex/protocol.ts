/**
 * What crosses the wire for Reflex. Safe for the browser: no rules, no server state.
 *
 * Nothing here is secret. Both players run the **same** pattern of hazards at the same moments, and
 * both are told the whole schedule up front — the game is not knowing what is coming, it is getting
 * out of the way in time. That is also what makes it fair: neither of them can draw a luckier board.
 */

/** Five lanes. Wide enough to run out of room, narrow enough for a thumb on a phone. */
export const LANES = 5;

/** Both players start in the middle, so neither begins nearer safety than the other. */
export const START_LANE = 2;

/** How many hazards a full run holds. Reached only by somebody who dodges all of them. */
export const WAVES = 45;

/** A breath before the first one, so nobody dies to a screen they had not finished reading. */
export const LEAD_IN_MS = 2_500;

/** The gap between hazards at the start, and the floor it tightens to. */
export const START_INTERVAL_MS = 1_000;
export const FASTEST_INTERVAL_MS = 420;
/** How much each wave takes off the interval. */
export const INTERVAL_STEP_MS = 14;

/** How many waves pass before another lane closes. One lane is always left open. */
export const WAVES_PER_EXTRA_LANE = 9;

/**
 * One step per move, and this long between steps.
 *
 * The whole difficulty of the game lives in this number. Without it a player could jump anywhere at
 * any time and never be caught out; with it, being on the wrong side of the board when four lanes
 * close is a mistake you made two seconds ago.
 */
export const MOVE_COOLDOWN_MS = 150;

/**
 * How long after a hazard's moment the server waits before judging it.
 *
 * A dodge made in time but delivered late would otherwise be a death caused by wifi. The grace is
 * the same 150ms cap the platform puts on latency compensation, so a move made before the hazard
 * lands is counted as long as it arrives inside the window it was promised.
 */
export const GRACE_MS = 150;

/** The most one-way delay a player is ever forgiven, matching the platform's own cap. */
export const MAX_COMPENSATION_MS = 150;

/** One hazard: the moment it lands, and the lanes it lands on. */
export interface Wave {
  /** Milliseconds from the start of the run — game time, which does not advance while paused. */
  at: number;
  /** Lane indices that are deadly at that moment. Never all of them. */
  blocked: number[];
}

/** One player, from the reader's side. */
export interface Runner {
  lane: number;
  alive: boolean;
  /** Game-time milliseconds survived. The score, and the only number that matters. */
  survivedMs: number;
}

export interface ReflexView {
  lanes: number;
  /**
   * The wall-clock epoch ms that game time zero corresponds to, or null while paused.
   *
   * The renderer places every hazard from this: a wave at `at` is due at `originAt + at`. The
   * server still decides every death — this is for drawing, and a client whose clock is a little
   * out draws a little early or late without changing anything that counts.
   */
  originAt: number | null;
  /** Game time already banked, so a paused screen can still show where the run had got to. */
  elapsedMs: number;
  /** The whole run, sent once and unchanging: 45 hazards is smaller than the frame carrying it. */
  waves: Wave[];
  /** Total length of a perfect run, for the progress bar. */
  totalMs: number;
  you: Runner;
  them: Runner;
  paused: boolean;
  outcome: 'won' | 'lost' | 'drawn' | null;
  complete: boolean;
}

/**
 * One step, left or right.
 *
 * A direction rather than a lane: a client naming a lane could cross the board in one frame, and
 * the cooldown between steps is the entire difficulty of the game.
 */
export interface MoveAction {
  type: 'move';
  direction: 'left' | 'right';
}

export type ReflexAction = MoveAction;
