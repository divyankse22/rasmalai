import { describe, expect, it } from 'vitest';

import { MANUAL_TEXT } from './bomb-defusal/server';
import { GAME_META } from './index';

const TAGLINE_MAX = 100;
const STEP_MAX = 140;
const STEPS_MIN = 3;
const STEPS_MAX = 6;

const games = Object.entries(GAME_META);

describe('every game explains itself', () => {
  it('has every registered game', () => {
    // Not an exact count: game ten should fail this file for having no copy, not for existing.
    expect(games.length).toBeGreaterThanOrEqual(9);
  });

  it.each(games)('%s has a tagline within budget', (_slug, meta) => {
    expect(meta.howToPlay.tagline.trim()).not.toBe('');
    expect(meta.howToPlay.tagline.length).toBeLessThanOrEqual(TAGLINE_MAX);
  });

  it.each(games)('%s has between three and six steps', (_slug, meta) => {
    expect(meta.howToPlay.steps.length).toBeGreaterThanOrEqual(STEPS_MIN);
    expect(meta.howToPlay.steps.length).toBeLessThanOrEqual(STEPS_MAX);
  });

  it.each(games)('%s has no empty or overlong step', (_slug, meta) => {
    for (const step of meta.howToPlay.steps) {
      expect(step.trim()).not.toBe('');
      expect(step.length).toBeLessThanOrEqual(STEP_MAX);
    }
  });

  it.each(games)('%s repeats no step', (_slug, meta) => {
    expect(new Set(meta.howToPlay.steps).size).toBe(meta.howToPlay.steps.length);
  });
});

/**
 * H-3, as a build failure rather than a habit.
 *
 * Bomb Defusal's manual reaches the expert's screen and nobody else's — a defuser who can read it
 * defuses the bomb alone, and then there is no cooperative game left. The rules are imported from
 * the rulebook rather than re-typed here, so a rule that is reworded stays guarded.
 *
 * Compared on distinctive fragments as well as whole sentences: the leak this is guarding against
 * is somebody paraphrasing a rule into the copy, which a whole-sentence match would sail past.
 */
describe('Bomb Defusal does not hand over the manual', () => {
  const bombDefusal = GAME_META['bomb-defusal'];

  const copy = [bombDefusal!.howToPlay.tagline, ...bombDefusal!.howToPlay.steps]
    .join(' ')
    .toUpperCase();

  it('is registered at all', () => {
    expect(bombDefusal).toBeDefined();
  });

  it('quotes no rule from the manual', () => {
    for (const rule of MANUAL_TEXT) {
      expect(copy).not.toContain(rule.toUpperCase());
    }
  });

  it.each(['SECOND WIRE', 'FIRST WIRE', 'LAST RED', 'THIRD WIRE', 'LAST WIRE'])(
    'does not name the wire a rule points at (%s)',
    (fragment) => {
      expect(copy).not.toContain(fragment);
    },
  );
});
