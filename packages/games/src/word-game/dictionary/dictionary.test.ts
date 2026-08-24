import { describe, expect, it } from 'vitest';
import { anyMakeableFrom, dictionaryInfo, normalize, validate } from './index';

describe('the dictionary', () => {
  it('decodes the whole payload, and knows how many words it holds', () => {
    const info = dictionaryInfo();
    expect(info.words).toBeGreaterThan(50_000);
    expect(info.version).toContain('scowl');
  });

  it('accepts ordinary words, including plurals and conjugations', () => {
    for (const word of ['cat', 'coast', 'apple', 'friend', 'running', 'happier', 'quickly']) {
      expect(validate(word), word).toMatchObject({ valid: true, word });
    }
  });

  it('refuses the Scrabble exotica that makes a casual word game feel broken', () => {
    // The whole reason for SCOWL size 50 rather than 80. These are real Scrabble words.
    for (const word of ['qat', 'zax', 'cwm', 'phpht']) {
      expect(validate(word), word).toMatchObject({ valid: false, reason: 'NOT_FOUND' });
    }
  });

  it('refuses proper nouns and abbreviations, which SCOWL ships separately', () => {
    for (const word of ['london', 'nasa', 'etc']) {
      expect(validate(word), word).toMatchObject({ valid: false, reason: 'NOT_FOUND' });
    }
  });

  it('normalizes case, whitespace and accents before looking anything up', () => {
    expect(validate('  CoAsT  ')).toMatchObject({ valid: true, word: 'coast' });
    expect(normalize('  Café ')).toBe('cafe');
  });

  it('names why it said no', () => {
    expect(validate('at')).toMatchObject({ valid: false, reason: 'TOO_SHORT' });
    expect(validate('a'.repeat(13))).toMatchObject({ valid: false, reason: 'TOO_LONG' });
    expect(validate('ca7')).toMatchObject({ valid: false, reason: 'INVALID_CHARACTERS' });
    // A phone's smart quotes, or a typo. The pool deals no apostrophe, so this is the useful answer.
    expect(validate("don't")).toMatchObject({ valid: false, reason: 'INVALID_CHARACTERS' });
    expect(validate('don\u2019t')).toMatchObject({ valid: false, reason: 'INVALID_CHARACTERS' });
    expect(validate('zzzqqq')).toMatchObject({ valid: false, reason: 'NOT_FOUND' });
  });

  it('holds no slur from the blocklist', () => {
    // Spot-checked without naming the category in the assertion output.
    const blocked = ['retard', 'retarded', 'gyp', 'squaw'];
    for (const word of blocked) {
      expect(validate(word).valid, 'a blocklisted term is still in the dictionary').toBe(false);
    }
  });

  it('keeps mild profanity, which is a deliberate decision rather than an oversight', () => {
    for (const word of ['damn', 'hell', 'crap']) {
      expect(validate(word), word).toMatchObject({ valid: true });
    }
  });
});

describe('finding a word inside a handful of letters', () => {
  it('finds a word that really is makeable, and says which', () => {
    const letters = [...'coasterlmbp'];
    const found = anyMakeableFrom(letters, () => 0);
    expect(found).not.toBeNull();

    // Re-derived here rather than trusting the answer: every letter of the word must be available
    // in the pool, counting duplicates.
    const pool = [...letters];
    for (const letter of found!) {
      const at = pool.indexOf(letter);
      expect(at, `'${found}' needs a '${letter}' the pool does not have`).toBeGreaterThanOrEqual(0);
      pool.splice(at, 1);
    }
    expect(validate(found!).valid).toBe(true);
  });

  it('returns null when nothing at all can be built', () => {
    // Five letters that make no English word between them in any arrangement.
    expect(anyMakeableFrom([...'qxzjv'], () => 0)).toBeNull();
  });

  it('offers different words for different picks, and never runs off the end', () => {
    const letters = [...'coasterlmbp'];
    const first = anyMakeableFrom(letters, () => 0);
    const last = anyMakeableFrom(letters, (count) => count - 1);
    expect(first).not.toBe(last);
    // A pick past the end is clamped rather than returning undefined.
    expect(anyMakeableFrom(letters, (count) => count + 99)).toBe(last);
  });

  it('never offers a word longer than the letters available', () => {
    const letters = [...'cat'];
    const found = anyMakeableFrom(letters, () => 0);
    if (found) expect(found.length).toBeLessThanOrEqual(3);
  });
});
