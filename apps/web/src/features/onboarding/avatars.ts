import type { AvatarKey } from '@rasmalai/shared';

export type { AvatarKey };

/**
 * Preset abstract avatars (T-6: no uploads in V1).
 *
 * Emoji rather than image assets on purpose: nothing to host, nothing to optimise, and they already
 * match the cute/cartoon direction. The keys are what the database stores, so the artwork can be
 * swapped for illustrations later without touching a single row.
 *
 * The keys themselves come from `@rasmalai/shared`, which is also what the server validates
 * against; the annotation below is what makes a drift between the two a compile error rather than
 * a signup that fails on the last card.
 */
export const AVATARS: readonly { key: AvatarKey; glyph: string; label: string }[] = [
  { key: 'chick', glyph: '🐣', label: 'Chick' },
  { key: 'fox', glyph: '🦊', label: 'Fox' },
  { key: 'octopus', glyph: '🐙', label: 'Octopus' },
  { key: 'frog', glyph: '🐸', label: 'Frog' },
  { key: 'penguin', glyph: '🐧', label: 'Penguin' },
  { key: 'unicorn', glyph: '🦄', label: 'Unicorn' },
  { key: 'rasmalai', glyph: '🍡', label: 'Rasmalai' },
  { key: 'moon', glyph: '🌙', label: 'Moon' },
  { key: 'cactus', glyph: '🌵', label: 'Cactus' },
  { key: 'ghost', glyph: '👻', label: 'Ghost' },
];

const BY_KEY = new Map(AVATARS.map((avatar) => [avatar.key as string, avatar]));

export function avatarGlyph(key: string): string {
  return BY_KEY.get(key)?.glyph ?? '🍡';
}

// The gender and location option lists moved to `steps.ts`, next to the questions that ask them and
// the shared constants they have to agree with. This file is about faces.
