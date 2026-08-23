import { describe, expect, it } from 'vitest';
import { dictionaryInfo, normalize, validate } from './index';

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
