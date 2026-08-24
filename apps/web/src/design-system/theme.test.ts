import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Guards on the theme file itself, read as text.
 *
 * These are worth more than any component test for a restyle, and they cost almost nothing. Each
 * one encodes a failure that is silent — no error, no crash, just something quietly wrong that
 * only shows up when you happen to look at the right screen.
 */

const themeCss = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');

/**
 * Every colour token, in the order the file declares them.
 *
 * Frozen deliberately: `basketball` and `reflex` look tokens up by name at runtime, so renaming
 * `--color-berry-deep` would leave basketball's hoop drawing itself in a fallback colour with
 * nothing to indicate why.
 */
const COLOUR_TOKENS = [
  '--color-cream',
  '--color-shell',
  '--color-blush',
  '--color-berry',
  '--color-berry-deep',
  '--color-mint',
  '--color-sky',
  '--color-butter',
  '--color-lilac',
  '--color-ink',
  '--color-name-male',
  '--color-name-female',
  '--color-muted',
  '--color-line',
  '--color-status-online',
  '--color-status-offline',
] as const;

function colourDeclarations(): { name: string; value: string }[] {
  return [...themeCss.matchAll(/^\s*(--color-[a-z-]+):\s*([^;]+);/gm)].map((m) => ({
    name: m[1]!,
    value: m[2]!.trim(),
  }));
}

describe('theme colour tokens', () => {
  /*
   * The one that matters most.
   *
   * `packages/games/src/{reflex,basketball}/client.tsx` read the palette out of the DOM with
   * getComputedStyle and parse it with /^#([0-9a-f]{6})$/i. That regex rejects oklch(), rgb(),
   * 3-digit hex and 8-digit hex — and on rejection the games fall back to hardcoded constants
   * without logging anything. Tailwind v4's own idiom is oklch(), so this is a genuinely easy
   * mistake for a future restyle to make.
   */
  it.each(COLOUR_TOKENS)('%s is a six-digit hex value', (token) => {
    const declaration = colourDeclarations().find((d) => d.name === token);
    expect(declaration, `${token} is missing from theme.css`).toBeDefined();
    expect(declaration!.value).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('declares exactly the frozen set of colour tokens, and no others', () => {
    expect(colourDeclarations().map((d) => d.name)).toEqual([...COLOUR_TOKENS]);
  });

  it('uses no colour notation the games cannot parse', () => {
    for (const { name, value } of colourDeclarations()) {
      expect(value, `${name} must not use a function notation`).not.toMatch(
        /(oklch|oklab|rgba?|hsla?|color-mix|lab|lch)\(/i,
      );
    }
  });
});

describe('theme motion tokens', () => {
  /*
   * The namespace regression this file's own comment documents: under `--duration-*` every
   * animation silently fell back to Tailwind's 150ms default while theme.css looked authoritative.
   */
  it('namespaces durations as --transition-duration-*', () => {
    expect(themeCss).toMatch(/--transition-duration-quick:/);
    expect(themeCss).toMatch(/--transition-duration-soft:/);
  });

  it('declares no --duration-* token', () => {
    expect(themeCss).not.toMatch(/^\s*--duration-/m);
  });
});

describe('theme structural tokens', () => {
  // PlayScreen animates reactions with `animate-[float_1.6s_ease-out_forwards]`, and the games
  // package references the same name. Renaming the keyframe breaks both with no type error.
  it('keeps the float keyframe', () => {
    expect(themeCss).toMatch(/@keyframes\s+float\s*\{/);
  });

  // Buttons, avatars, status dots and chips are pills by decision, not by accident.
  it('keeps the pill radius', () => {
    expect(themeCss).toMatch(/--radius-pill:\s*999px;/);
  });

  /*
   * Tailwind v4's bare `--spacing` is the multiplier behind the whole numeric scale. Setting it
   * would move `min-h-11` off the 44px tap-target minimum that docs/06 requires, and resize every
   * glyph inside packages/games — which this restyle is not allowed to edit to compensate.
   */
  it('never sets the bare --spacing multiplier', () => {
    expect(themeCss).not.toMatch(/^\s*--spacing:/m);
  });
});
