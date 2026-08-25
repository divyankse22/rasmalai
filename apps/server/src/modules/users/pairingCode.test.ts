import { describe, expect, it } from 'vitest';
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  generatePairingCode,
  normalisePairingCode,
} from './pairingCode';

describe('generatePairingCode', () => {
  it('produces a code of the expected length from the expected alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      expect(code).toMatch(new RegExp(`^[${PAIRING_CODE_ALPHABET}]+$`));
    }
  });

  it('never emits the characters people misread', () => {
    const codes = Array.from({ length: 500 }, generatePairingCode).join('');
    expect(codes).not.toMatch(/[ILOU]/);
  });

  it('is not sequential or repetitive across calls', () => {
    const codes = new Set(Array.from({ length: 500 }, generatePairingCode));
    // Collisions in 500 draws from 1.1e12 would indicate a broken source of randomness.
    expect(codes.size).toBe(500);
  });

  it('uses the whole alphabet rather than a biased slice', () => {
    const seen = new Set(Array.from({ length: 2000 }, generatePairingCode).join(''));
    expect(seen.size).toBe(PAIRING_CODE_ALPHABET.length);
  });
});

describe('normalisePairingCode', () => {
  it.each([
    ['abcd1234', 'ABCD1234'],
    ['ABCD-1234', 'ABCD1234'],
    ['  abcd 1234 ', 'ABCD1234'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalisePairingCode(input)).toBe(expected);
  });
});
