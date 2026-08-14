/**
 * Preset abstract avatars (T-6: no uploads in V1).
 *
 * Emoji rather than image assets on purpose: nothing to host, nothing to optimise, and they already
 * match the cute/cartoon direction. The keys are what the database stores, so the artwork can be
 * swapped for illustrations later without touching a single row.
 */
export const AVATARS = [
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
] as const;

export type AvatarKey = (typeof AVATARS)[number]['key'];

const BY_KEY = new Map(AVATARS.map((avatar) => [avatar.key as string, avatar]));

export function avatarGlyph(key: string): string {
  return BY_KEY.get(key)?.glyph ?? '🍡';
}

export const LOCATION_OPTIONS = [
  { value: 'same_city', label: 'Same city' },
  { value: 'different_city', label: 'Different cities' },
  { value: 'live_in', label: 'We live together' },
  { value: 'prefer_not_to_say', label: 'Rather not say' },
] as const;
