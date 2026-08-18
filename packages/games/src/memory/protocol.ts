/**
 * What crosses the wire for Memory. Safe for the browser: no rules, and — the whole point of this
 * game — no face the reader has not earned the right to see.
 *
 * Everything is resolved to one reader's point of view, `you` and `them`, exactly as `SessionView`
 * is. A renderer that had to work out which seat it was drawing for would get it wrong eventually,
 * and it would get it wrong in front of somebody mid-game.
 */

/** Four across and five up: a portrait grid that fits a phone without shrinking the cards. */
export const COLUMNS = 4;
export const ROWS = 5;
export const CARDS = COLUMNS * ROWS;
export const PAIRS = CARDS / 2;

/**
 * How long a mismatched pair stays visible before it turns back over.
 *
 * Long enough to read and commit to memory, short enough that the other player is not sitting
 * watching a frozen board. The server owns it, so both of them see the same cards for the same
 * length of time whatever their connection is doing.
 */
export const PEEK_MS = 1_600;

/**
 * The deck's faces.
 *
 * Public on purpose. What makes this game a game is not *which* pictures are in the deck — that is
 * the same twenty cards every time — but **where** they are, and that is the server's secret. A
 * client holding this list learns nothing it could not learn by playing once.
 */
export const FACES = ['🍓', '🌸', '🐣', '🍋', '🫐', '🌙', '🍄', '🐙', '🌵', '🍯'] as const;

/** One card, as this reader is allowed to see it. */
export interface MemoryCard {
  /**
   * The picture, or **null** for a card that is still face down.
   *
   * Null is not decoration and not the renderer's job to enforce: the server never puts a face in
   * this field for a card the reader has not turned over or matched, so a player reading the frame
   * off the wire learns nothing a player looking at the screen does not.
   */
  face: string | null;
  /** Who claimed this pair, once somebody has. */
  matched: 'you' | 'them' | null;
  /** Turned over right now, as part of the move in progress. */
  faceUp: boolean;
}

export interface MemoryView {
  columns: number;
  rows: number;
  pairs: number;
  cards: MemoryCard[];
  /** The only thing that decides whether your taps do anything. */
  yourTurn: boolean;
  yourPairs: number;
  theirPairs: number;
  /**
   * Two cards are showing and they did not match — nobody may move until they turn back.
   *
   * Sent as a fact rather than left to the renderer to infer from two face-up cards, because a
   * matched pair is also two face-up cards for an instant and the two mean opposite things.
   */
  peeking: boolean;
  /** Epoch ms, server clock, when the peek ends. The renderer may animate to it; it decides nothing. */
  peekEndsAt: number | null;
  /** Whether the pair that just turned over matched, for the board to celebrate or commiserate. */
  lastFlipMatched: boolean | null;
  /** Who went first — a server coin-flip, flipped again for a rematch. */
  youStarted: boolean;
  /** Frozen while somebody is away, so the peek they never saw is still there when they get back. */
  paused: boolean;
  outcome: 'won' | 'lost' | 'drawn' | null;
  complete: boolean;
}

/**
 * The only thing a player can do: turn one card over.
 *
 * One card, not a pair. The gap between the first and the second is the entire game, and a client
 * that sent both at once would be asserting that it had already seen the first one's face.
 */
export interface FlipAction {
  type: 'flip';
  card: number;
}

export type MemoryAction = FlipAction;
