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

/** Face-up letters available to whoever is on the move. */
export const POOL_SIZE = 12;

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
  | 'NO_SUCH_TARGET';

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

export type WordGameAction = ClaimAction | PassAction;

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
  complete: boolean;
}
