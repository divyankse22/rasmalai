/**
 * The authoritative rulebooks. **Never bundled into the browser.**
 *
 * `apps/web` is forbidden from importing this entrypoint by an ESLint rule, because a rulebook in
 * the browser is a rulebook a player can read — and for a game decided on timing, reading it is
 * most of the way to beating it (`docs/02` section 8).
 */

import type { AnyGameRules } from './contract';
import { rules as basketball } from './basketball/server';
import { rules as bombDefusal } from './bomb-defusal/server';
import { rules as fourInARow } from './four-in-a-row/server';
import { rules as guessMyAnswer } from './guess-my-answer/server';
import { rules as memory } from './memory/server';
import { rules as reactionSpeed } from './reaction-speed/server';
import { rules as reflex } from './reflex/server';

const REGISTRY: Readonly<Record<string, AnyGameRules>> = {
  [reactionSpeed.meta.slug]: reactionSpeed,
  [fourInARow.meta.slug]: fourInARow,
  [memory.meta.slug]: memory,
  [guessMyAnswer.meta.slug]: guessMyAnswer,
  [bombDefusal.meta.slug]: bombDefusal,
  [reflex.meta.slug]: reflex,
  [basketball.meta.slug]: basketball,
};

/**
 * The rules for a slug, or null when no module exists for it yet.
 *
 * `public.games.enabled` is the catalogue's mirror of this map — a game is offered because a module
 * exists, not the other way round. The platform checks both: the database stops an invitation being
 * sent, and this stops a session ever starting for a game nobody has written.
 */
export function findGameRules(slug: string): AnyGameRules | null {
  return REGISTRY[slug] ?? null;
}

/** Slugs with a working module, for tests and for keeping the seed honest. */
export function playableSlugs(): string[] {
  return Object.keys(REGISTRY);
}
