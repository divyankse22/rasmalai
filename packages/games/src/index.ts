/**
 * Everything about games that is safe anywhere: the contract, and what each game says about itself.
 *
 * Authoritative rules are behind `@rasmalai/games/server` and renderers behind
 * `@rasmalai/games/client`, so importing this from the browser can never drag a rulebook into the
 * bundle. An ESLint rule in `apps/web` enforces the half that matters.
 */

export * from './contract';

// One flat namespace shared by every game's protocol. It holds while no two games name a constant
// the same way; the day two do, `export *` quietly drops the name and every consumer of it stops
// compiling — loud enough to be a warning rather than a bug, and the fix is to prefix the newer one.
export { meta as reactionSpeedMeta } from './reaction-speed/meta';
export * from './reaction-speed/protocol';
export { meta as fourInARowMeta } from './four-in-a-row/meta';
export * from './four-in-a-row/protocol';

import type { GameMeta } from './contract';
import { meta as fourInARow } from './four-in-a-row/meta';
import { meta as reactionSpeed } from './reaction-speed/meta';

/** Every game that has a module behind it, keyed by the slug in `public.games`. */
export const GAME_META: Readonly<Record<string, GameMeta>> = {
  [reactionSpeed.slug]: reactionSpeed,
  [fourInARow.slug]: fourInARow,
};

export function findGameMeta(slug: string): GameMeta | null {
  return GAME_META[slug] ?? null;
}
