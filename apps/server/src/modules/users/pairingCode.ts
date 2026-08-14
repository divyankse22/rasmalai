import { randomInt } from 'node:crypto';

/**
 * Crockford base32 minus the letters that get misread when someone reads a code aloud or copies it
 * off a screen: I, L, O and U are gone, so there is no 1/I, 0/O or vowel confusion to explain.
 */
export const PAIRING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 8;

/**
 * Generates a pairing code.
 *
 * `docs/07_SECURITY_PRIVACY.md` requires these to be unguessable and never sequential: this is the
 * only string standing between a stranger and a pairing request. 32^8 is about 1.1e12
 * possibilities, drawn from the CSPRNG via `randomInt`, which is free of the modulo bias a naive
 * `randomBytes[i] % 32` would introduce.
 */
export function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** Accepts what someone typed - any case, with stray spaces or dashes - and normalises it. */
export function normalisePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}
