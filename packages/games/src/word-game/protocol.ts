/**
 * What crosses the wire for Word Game. Safe for the browser: no rules, no dictionary, and no letter
 * the reader has not been dealt.
 *
 * **The dictionary is not here and must never be.** A browser holding 58,000 words could tell a
 * player whether their word was valid before the server did, which is the one thing the server
 * exists to decide. It lives in `dictionary/`, which the web app's eslint config forbids importing.
 *
 * There is nothing secret in this game beyond that — the pool is face-up for both of them by
 * definition, and both scores are public. What the protocol has to get right is not secrecy but
 * *identity*: every tile carries a server-assigned id, and a player claims tiles by id rather than
 * by letter. Two `E`s in the pool are different tiles, and a submission that named letters instead
 * of tiles could not say which one it meant.
 */

/**
 * Face-up letters at the start. The pool grows from here when somebody passes.
 *
 * Raised from 12 for an easier deal: more letters visible at once means more words are actually
 * makeable from any given pool, without touching the vowel-heavy bag ratio or any scoring number.
 */
export const POOL_SIZE = 14;

/**
 * The most letters that will ever be on the table.
 *
 * A pass tops the board up rather than doing nothing, so two people cannot both be stuck staring at
 * the same dead pool. It grows to here and then stops growing — a phone screen is more scanning than
 * game past a point, and the countdown is running while you scan. Raised alongside `POOL_SIZE` by
 * the same two letters, keeping the six-letter growth room the original 12→18 had.
 */
export const POOL_MAX = 20;

/** How many letters a pass adds, or swaps once the pool is already at `POOL_MAX`. */
export const PASS_LETTERS = 3;

/**
 * How long the first turn is.
 *
 * The game's own clock, not the platform's. `turnOf` still returns null, so the 120-second move
 * window stays off — running this one out costs a turn, never the match.
 */
export const TURN_START_MS = 30_000;

/** What each valid word adds to that player's allowance, for every turn they take after it. */
export const TURN_BONUS_MS = 5_000;

/** Hints per player, per match. */
export const HINTS_EACH = 3;

/** What a hint costs, off the final score. A three-letter word is worth nine, for comparison. */
export const HINT_COST = 5;

/** Shortest playable word. Matches the dictionary's own floor. */
export const MIN_WORD = 3;

/** How long a word has to be before it also breaks one of your partner's. */
export const RAID_LETTERS = 6;

/**
 * The same threshold for whoever is behind.
 *
 * The comeback mechanic, and deliberately the existing rule rather than a new one: being behind
 * makes you more dangerous, and the moment you take the lead you lose the discount. Nothing else in
 * the game changes, so there is one rule to learn rather than two.
 */
export const RAID_LETTERS_BEHIND = 5;

/** What a raid pays, on top of the word that earned it. */
export const RAID_BONUS = 15;

/** A word using the golden tile is worth this much more. */
export const GOLDEN_MULTIPLIER = 2;

/**
 * A hard ceiling on turns, each.
 *
 * The match normally ends when the bag is empty and both of them pass in a row. This exists because
 * `turnOf` returns null in this game — there is no move clock, deliberately, so that nobody is
 * forfeited for thinking — and without a clock something else has to make the match finite.
 */
export const MAX_TURNS_EACH = 40;

/** One face-up letter. `id` is what a claim names; two `E`s are two different tiles. */
export interface Tile {
  id: number;
  letter: string;
  /** Worth double, and there is exactly one of these in the pool at any time. */
  golden: boolean;
}

/** A word somebody owns, and what it is currently worth to them. */
export interface OwnedWord {
  word: string;
  /** Whether it was built with the golden tile, which is why the score may look surprising. */
  golden: boolean;
  score: number;
}

/** Why the server refused a word. Shown to the player as cute copy, not as an enum. */
export type WordRejection =
  | 'INVALID_CHARACTERS'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'NOT_FOUND'
  | 'ALREADY_USED'
  | 'NOT_YOUR_TURN'
  | 'INSUFFICIENT_LETTERS'
  | 'TOO_SHORT_TO_RAID'
  | 'NO_SUCH_TARGET'
  | 'NO_HINTS_LEFT'
  | 'NO_HINT_AVAILABLE';

/**
 * Claim a word, and optionally break one of your partner's with it.
 *
 * The word is **not** on the action. The server derives it from the tile ids, so a client cannot
 * submit letters it does not hold, and "do you actually possess these" stops being a check that
 * could be forgotten. `steal` names an index into the partner's word list, and is refused unless
 * the claimed word is long enough to have earned it.
 */
export interface ClaimAction {
  type: 'claim';
  tiles: readonly number[];
  steal: number | null;
}

/** Nothing worth having. Two of these in a row, with the bag empty, ends the match. */
export interface PassAction {
  type: 'pass';
}

/**
 * Spend a hint: highlight the first letter of a word that is genuinely on the table.
 *
 * Does not end the turn and does not stop the clock — it costs points, which is enough. If nothing
 * at all is makeable the hint is refused rather than spent, because charging five points for a hint
 * that cannot be given would be the worst possible moment to take them.
 */
export interface HintAction {
  type: 'hint';
}

export type WordGameAction = ClaimAction | PassAction | HintAction;

/**
 * One completed turn, oldest first.
 *
 * `word` is null for a pass, and `timedOut` separates a pass somebody chose from a clock that ran
 * out on them — which reads very differently when you are looking back at how the match went.
 */
export interface PlayLogEntry {
  by: 'you' | 'them';
  word: string | null;
  score: number;
  /** The partner's word this play broke, if it broke one. */
  raided: string | null;
  timedOut: boolean;
}

/** One reader's view of the match. Almost all of it is public by nature. */
export interface WordGameView {
  pool: readonly Tile[];
  /** How many letters are still to come, so the endgame is visible rather than a surprise. */
  bagLeft: number;
  /** Whether it is this reader's move. There is no clock on it. */
  yourTurn: boolean;
  yourWords: readonly OwnedWord[];
  theirWords: readonly OwnedWord[];
  yourScore: number;
  theirScore: number;
  /** How long a word this reader needs to raid — 5 while behind, 6 otherwise. */
  yourRaidLength: number;
  /** Consecutive passes. At two, with an empty bag, the match is over. */
  passes: number;
  /** The last thing the server refused from this reader, cleared as soon as they act again. */
  lastRejection: WordRejection | null;
  /** The last word either of them played, for a bit of theatre. */
  lastPlay: { word: string; byYou: boolean; score: number; raided: boolean } | null;

  /**
   * Server epoch ms this turn runs out, or null while the match is paused.
   *
   * Absolute rather than a remaining-ms number, like every clock in this codebase: the client
   * subtracts its own `Date.now()` on a short interval, so a slightly wrong clock draws a slightly
   * wrong countdown and decides nothing by it. Null means frozen — the renderer must stop counting
   * rather than extrapolate, because a countdown running while the clock is stopped would be lying.
   */
  turnEndsAt: number | null;

  /** How long this reader's turns are now, so the +5s for a word is visible as it is earned. */
  yourTurnLengthMs: number;

  yourHintsLeft: number;
  /** Visible because a hint costs points and the score is public. Where it points is not. */
  theirHintsLeft: number;

  /** The tile a hint is pointing at, for the reader who paid for it. Null for their partner. */
  hintTileId: number | null;

  /** Every completed turn, oldest first. */
  log: readonly PlayLogEntry[];

  complete: boolean;
}
