import { readdirSync, readFileSync } from 'node:fs';
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
  '--color-sky-deep',
  '--color-blueberry',
  '--color-blueberry-deep',
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

/**
 * WCAG relative luminance, then the 4.5:1 ratio, computed from the hex in theme.css itself.
 *
 * Worth doing here rather than trusting a component test: a pressed fill is only on screen while a
 * finger is down, so a contrast regression in an `:active` colour is invisible to every screenshot
 * and every review, and shows up only for the person who cannot read the label they are pressing.
 */
function channel(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function colour(token: string): string {
  const declaration = colourDeclarations().find((d) => d.name === token);
  expect(declaration, `${token} is missing from theme.css`).toBeDefined();
  return declaration!.value;
}

describe('theme colour contrast', () => {
  /*
   * `Button`'s soft variant keeps ink-coloured text through its press. Both fills it can be
   * wearing at the time therefore have to carry that text, and the pressed one is the easy half to
   * forget — it used to be `--color-blueberry-deep`, a saturated mid blue that put ink at 2.66:1.
   */
  it.each([
    ['--color-ink', '--color-sky', 'soft button, resting'],
    ['--color-ink', '--color-sky-deep', 'soft button, pressed'],
    ['--color-shell', '--color-berry', 'primary button, resting'],
    ['--color-shell', '--color-berry-deep', 'primary button, pressed'],
  ])('carries %s on %s (%s)', (text, fill) => {
    expect(contrast(colour(text), colour(fill))).toBeGreaterThanOrEqual(4.5);
  });

  /*
   * The other direction. `--color-berry` is a fill under light text *and* the colour of every
   * error message and every focus ring, so it has to clear the bar read both ways — it was
   * originally a bright #f2678f, which sat at 2.81:1 on cream and failed all three jobs at once.
   * The focus ring only owes 3:1 as a non-text indicator, but it rides on the same token, so
   * satisfying the text threshold settles it.
   */
  it.each([
    ['--color-ink', 'body and headings'],
    ['--color-muted', 'stat labels, blurbs, ghost buttons'],
    ['--color-berry', 'error text, focus ring, wordmark'],
    ['--color-name-male', 'his name and his numbers'],
    ['--color-name-female', 'her name and her numbers'],
  ])('reads as text on cream: %s (%s)', (token) => {
    expect(contrast(colour(token), colour('--color-cream'))).toBeGreaterThanOrEqual(4.5);
  });

  /*
   * A press has to be visible as well as readable. Keeping the pressed fill in the same pastel
   * family is what stops the fix from being "make it the same colour", so the step is asserted
   * rather than left to whoever next opens the file with a colour picker.
   */
  it.each([
    ['--color-sky', '--color-sky-deep'],
    ['--color-berry', '--color-berry-deep'],
  ])('darkens perceptibly from %s to %s when pressed', (rest, pressed) => {
    expect(luminance(colour(pressed))).toBeLessThan(luminance(colour(rest)) * 0.85);
  });

  /*
   * Her name colour and the action colour are both deep pinks and they are not allowed to become
   * the same one. Both were pushed darker to reach 4.5:1, which walked them toward each other:
   * name-female sits at a magenta 350.6 degrees against berry's 7.5, and losing that separation
   * would mean a name reading as a button.
   */
  it('keeps her name colour distinct from the action colour', () => {
    const [her, action] = [colour('--color-name-female'), colour('--color-berry')];
    const channels = [1, 3, 5].map(
      (i) => parseInt(her.slice(i, i + 2), 16) - parseInt(action.slice(i, i + 2), 16),
    );
    expect(Math.hypot(...channels)).toBeGreaterThan(24);
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
   * The app column, as a token rather than as a literal repeated across the shell and every route
   * that opens outside it. `--container-app` sits in Tailwind v4's `--container-*` namespace, so it
   * is `max-w-app` at the call site; the point of the token is that widening the column is one edit
   * here instead of a grep that misses a file.
   */
  it('declares the app column as a container token', () => {
    expect(themeCss).toMatch(/--container-app:\s*28rem;/);
  });

  /*
   * ...and that the token is actually the one in use. `max-w-md` is 28rem too, so a stray literal
   * is invisible until the day the column changes width and one surface silently does not follow.
   */
  it('uses the container token rather than a literal max-w-md', () => {
    const src = fileURLToPath(new URL('..', import.meta.url));
    const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
      .filter((file) => readFileSync(`${src}${file}`, 'utf8').includes('max-w-md'));

    expect(offenders, 'use max-w-app so the column stays one edit wide').toEqual([]);
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
