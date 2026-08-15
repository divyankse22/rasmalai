/**
 * The vocabulary of onboarding: which values are legal, and how long a name may be.
 *
 * These lived on the server, in `user.schema.ts`, while the web app kept its own hand-written copy
 * of the same option lists. That was survivable when the whole form submitted at once and the
 * server was the only thing that ever judged it. The wizard validates each card before it slides,
 * so both sides now enforce the same rules — and two hand-written copies of a rule are one drift
 * away from a card that refuses to advance over an answer the server would have accepted.
 *
 * Constants only. The zod schema stays on the server and stays the authority; this package cannot
 * depend on it, and the browser's copy of a rule is a courtesy, never a gate.
 */

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

export const LOCATION_TYPES = [
  'same_city',
  'different_city',
  'live_in',
  'prefer_not_to_say',
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/** Preset abstract avatars. V1 ships no uploads, per T-6. The glyphs are the web app's business. */
export const AVATAR_KEYS = [
  'chick',
  'fox',
  'octopus',
  'frog',
  'penguin',
  'unicorn',
  'rasmalai',
  'moon',
  'cactus',
  'ghost',
] as const;
export type AvatarKey = (typeof AVATAR_KEYS)[number];

/** Youngest age we will accept, matching Google's own minimum for an account. */
export const MINIMUM_AGE = 13;
export const EARLIEST_BIRTH_YEAR = 1900;

/** Mirrors the `char_length` checks in `0001_users.sql`; the database is the last word. */
export const NAME_MAX_LENGTH = 60;
export const NICKNAME_MAX_LENGTH = 30;

/** A pairing code is eight characters (`pairingCode.ts`), but people paste them with spaces. */
export const PAIRING_CODE_LENGTH = 8;
