/**
 * What crosses the wire for Bomb Defusal. Safe for the browser — and, uniquely so far, **different
 * for each of the two readers**.
 *
 * Every other game sends both players the same picture with one player's secrets removed. This one
 * sends two genuinely different screens: one person is holding a bomb they cannot read, the other
 * is holding a manual they cannot see the bomb through. Neither half is playable alone, which is
 * what makes it cooperative rather than two people taking turns.
 *
 * Note what is **not** in this file: the manual. Its text lives in the rulebook, server-side, and
 * reaches the expert's screen and nobody else's. A public constant would let the defuser read it
 * out of their own bundle and solve the bomb alone, which is the one way this game can be broken.
 */

/** Six wires, every stage. Enough to be a puzzle, few enough to fit across a phone. */
export const WIRES = 6;

/** Three bombs to get through. Who defuses which alternates, so both of you do both jobs. */
export const STAGES = 3;

/** Two wrong cuts are survivable. The third is not. */
export const MAX_STRIKES = 3;

/**
 * How long the whole bomb lasts, in milliseconds.
 *
 * One clock for the match rather than one per stage: a stage that went quickly should buy time for
 * the one that does not, and a couple who get stuck should be able to feel it running out together.
 */
export const FUSE_MS = 150_000;

export const COLOURS = ['red', 'blue', 'yellow', 'white'] as const;

export type Colour = (typeof COLOURS)[number];

/** Which half of the bomb a seat is holding this stage. */
export type Role = 'defuser' | 'expert';

/** One wire, as this reader can see it. */
export interface WireView {
  /**
   * The colour — or **null** when this reader has not been told it.
   *
   * The defuser always sees all six, because they are looking at the bomb. The expert sees only the
   * ones that have been reported to them, which is the entire communication channel this game has:
   * `docs/01` section 14 rules out voice and text for V1, so the game has to carry the conversation
   * itself.
   */
  colour: Colour | null;
  /** Whether the defuser has told the expert about this one. Both of them see this. */
  reported: boolean;
  /** Cut, and therefore out of play. Only ever one per stage, and it ends the stage. */
  cut: boolean;
}

export interface BombDefusalView {
  role: Role;
  stage: number;
  stages: number;
  strikes: number;
  maxStrikes: number;
  /** Epoch ms, server clock, when it goes off. Null while the fuse is paused. */
  explodesAt: number | null;
  /** Frozen because somebody is away. The fuse does not burn while nobody can play. */
  paused: boolean;
  wires: WireView[];
  /**
   * The manual, which is the expert's whole half of the game — and null for the defuser.
   *
   * Rendered server-side into plain sentences so the renderer never has to hold a rule it might one
   * day be tempted to evaluate.
   */
  manual: readonly string[] | null;
  /** The wire the expert is pointing at, or null. Both of them see it: that is the point of it. */
  pointedAt: number | null;
  /** How the last cut went, so the screen can flinch. Cleared when the next stage starts. */
  lastCut: { wire: number; correct: boolean } | null;
  outcome: 'defused' | 'exploded' | null;
  complete: boolean;
}

/** Defuser → expert: "this one is blue." The only way a colour ever reaches the other screen. */
export interface ReportAction {
  type: 'report';
  wire: number;
}

/** Expert → defuser: "that one." Replaces any previous instruction rather than queueing. */
export interface PointAction {
  type: 'point';
  wire: number;
}

/** Defuser only, and the only action in the game that can lose it. */
export interface CutAction {
  type: 'cut';
  wire: number;
}

export type BombDefusalAction = ReportAction | PointAction | CutAction;
