import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * `layout.tsx` exports a `themeColor` for the browser chrome, and it has to be a literal — Next
 * serialises the viewport export at build time, so it cannot read a CSS custom property.
 *
 * That makes it the one colour in the app that lives outside theme.css and will not follow a
 * reskin. The failure is quiet and cosmetic: the phone's status bar keeps the old tint while every
 * pixel below it changes. This test turns that into a red suite instead.
 */

const here = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('viewport themeColor', () => {
  it('matches --color-cream, the page background', () => {
    const cream = /--color-cream:\s*(#[0-9a-fA-F]{6});/.exec(
      here('../design-system/theme.css'),
    )?.[1];
    const themeColor = /themeColor:\s*'(#[0-9a-fA-F]{6})'/.exec(here('./layout.tsx'))?.[1];

    expect(cream, '--color-cream not found in theme.css').toBeDefined();
    expect(themeColor, 'themeColor not found in layout.tsx').toBeDefined();
    expect(themeColor!.toLowerCase()).toBe(cream!.toLowerCase());
  });
});
