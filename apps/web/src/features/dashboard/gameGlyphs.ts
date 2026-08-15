/**
 * Artwork for the catalogue, keyed by slug.
 *
 * The catalogue itself is data (`docs/03_DATABASE_SCHEMA.md`: it must not be hardcoded in the UI) —
 * names, descriptions, categories and availability all come from the database. This is only the
 * picture, and it falls back gracefully, so seeding a game nobody has drawn yet still renders.
 * Same trade as the preset avatars: emoji cost nothing to host and already look the part.
 */
const GLYPHS: Record<string, string> = {
  'reaction-speed': '⚡',
  'four-in-a-row': '🔴',
  reflex: '🌀',
  basketball: '🏀',
  'bomb-defusal': '💣',
  'puzzle-solving': '🧩',
  'boat-escape': '⛵',
  survival: '🏕️',
  'whos-more-likely': '👉',
  'never-have-i-ever': '🙊',
  'would-you-rather': '🤔',
  'guess-my-answer': '💭',
  'couple-trivia': '💌',
  'truth-or-dare': '🎲',
  drawing: '🎨',
  'word-game': '🔤',
  memory: '🃏',
};

export function gameGlyph(slug: string): string {
  return GLYPHS[slug] ?? '🎮';
}

/** How each category is introduced on the dashboard. */
export const CATEGORY_LABEL: Record<string, { title: string; blurb: string }> = {
  competitive: { title: 'Competitive', blurb: 'One of you wins. Loudly.' },
  cooperative: { title: 'Cooperative', blurb: 'Both of you win, or neither does.' },
  social: { title: 'Social', blurb: 'Less winning, more finding each other out.' },
  casual: { title: 'Casual', blurb: 'Something gentle to do together.' },
};
