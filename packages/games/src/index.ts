/**
 * Everything about games that is safe anywhere: the contract, and what each game says about itself.
 *
 * Authoritative rules are behind `@rasmalai/games/server` and renderers behind
 * `@rasmalai/games/client`, so importing this from the browser can never drag a rulebook into the
 * bundle. An ESLint rule in `apps/web` enforces the half that matters.
 */

export * from './contract';
export { meta as reactionSpeedMeta } from './reaction-speed/meta';
export * from './reaction-speed/protocol';

import type { GameMeta } from './contract';
import { meta as reactionSpeed } from './reaction-speed/meta';

/** Every game that has a module behind it, keyed by the slug in `public.games`. */
export const GAME_META: Readonly<Record<string, GameMeta>> = {
  [reactionSpeed.slug]: reactionSpeed,
};

export function findGameMeta(slug: string): GameMeta | null {
  return GAME_META[slug] ?? null;
}
