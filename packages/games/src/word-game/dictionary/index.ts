import { gunzipSync } from 'node:zlib';
import { DICTIONARY_VERSION, WORDS_GZ_BASE64, WORD_COUNT } from './words';

/**
 * The word validation service. **Server-only** — see the note in `words.ts`.
 *
 * Deliberately narrow. This module answers exactly one question: *is that a word?* It knows nothing
 * about pools, ownership, turns or scoring, so `ALREADY_USED` and `INSUFFICIENT_LETTERS` are not its
 * to give — those are facts about a match, and the rulebook decides them. Keeping the split here
 * means a second word game could take this whole directory unchanged.
 *
 * The rest of the codebase calls `dictionary.validate(word)` and never learns how the words are
 * stored, per the brief's section 26. Swapping the payload for a trie, a different SCOWL size or
 * another language is a change to this directory and nothing else.
 */

/** Shortest word the game accepts. Two-letter words are where the Scrabble exotica lives. */
export const MIN_WORD_LENGTH = 3;

/** Longest word the game accepts — the pool never holds more than this, so nothing longer fits. */
export const MAX_WORD_LENGTH = 12;

export type RejectionReason =
  | 'INVALID_CHARACTERS'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'NOT_FOUND';

export type WordValidation =
  | { valid: true; word: string }
  | { valid: false; word: string; reason: RejectionReason };

/**
 * Decoded once, on first use, and held for the life of the process.
 *
 * Lazy rather than at module load: `packages/games` is imported by tests that never touch this
 * game, and none of them should pay 30ms and 10MB for a dictionary they do not use.
 */
let words: ReadonlySet<string> | null = null;

function load(): ReadonlySet<string> {
  if (words) return words;

  const text = gunzipSync(Buffer.from(WORDS_GZ_BASE64, 'base64')).toString('utf8');
  const parsed = new Set(text.split('\n').filter((line) => line.length > 0));

  // A truncated or half-written payload would otherwise present as "that is not a word", which is
  // the single most confusing way this could fail: the game would work, and simply be wrong.
  if (parsed.size !== WORD_COUNT) {
    throw new Error(
      `dictionary is corrupt: expected ${WORD_COUNT} words, decoded ${parsed.size}. ` +
        'Re-run scripts/dictionary/build-dictionary.sh.',
    );
  }

  words = parsed;
  return words;
}

/**
 * Trim, lowercase, and strip the Unicode a player's keyboard may have helped with.
 *
 * `NFKD` then dropping combining marks turns `café` into `cafe`, which is the entry SCOWL holds.
 *
 * Apostrophes are deliberately **not** stripped. The pool deals a-z tiles and nothing else, so a
 * player cannot hold one — an apostrophe in a submission is a typo or a phone keyboard's smart
 * quotes, and `INVALID_CHARACTERS` tells them that. Silently turning `don't` into `dont` and then
 * saying "not a word" would be true and useless.
 */
export function normalize(input: string): string {
  return input
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Is that a word? Nothing about whether this player may play it. */
export function validate(input: string): WordValidation {
  const word = normalize(input);

  if (!/^[a-z]*$/.test(word)) return { valid: false, word, reason: 'INVALID_CHARACTERS' };
  if (word.length < MIN_WORD_LENGTH) return { valid: false, word, reason: 'TOO_SHORT' };
  if (word.length > MAX_WORD_LENGTH) return { valid: false, word, reason: 'TOO_LONG' };
  if (!load().has(word)) return { valid: false, word, reason: 'NOT_FOUND' };

  return { valid: true, word };
}

/** For tests and diagnostics. Forces the decode. */
export function dictionaryInfo(): { version: string; words: number } {
  return { version: DICTIONARY_VERSION, words: load().size };
}
