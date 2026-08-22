/**
 * The renderers, one per game, loaded on demand.
 *
 * Lazily, deliberately: seventeen games are coming, and a catalogue's worth of game code in the
 * bundle of a person who is only looking at their dashboard is the obvious way to make a phone-first
 * product slow. Each entry is a dynamic import, so a game's code arrives when its session does.
 *
 * The loader shape is plain — a promise of a module with a default export — so nothing here is tied
 * to Next.js. `apps/web` wraps these in `React.lazy`.
 */

import type { ComponentType } from 'react';
import type { GameRenderProps } from './contract';

/**
 * A renderer, with its view type forgotten.
 *
 * `never` rather than `unknown` on purpose: a component that wants a `ReactionSpeedView` is
 * assignable to one that promises nothing about its view, so every game registers below without a
 * cast. The cast is paid once, where the component is actually mounted, which is the only place the
 * platform genuinely cannot know what it is holding.
 */
export type GameComponent = ComponentType<GameRenderProps<never>>;

export type GameLoader = () => Promise<{ default: GameComponent }>;

const RENDERERS: Readonly<Record<string, GameLoader>> = {
  'reaction-speed': () => import('./reaction-speed/client'),
  'four-in-a-row': () => import('./four-in-a-row/client'),
  memory: () => import('./memory/client'),
  'guess-my-answer': () => import('./guess-my-answer/client'),
  'bomb-defusal': () => import('./bomb-defusal/client'),
  reflex: () => import('./reflex/client'),
  basketball: () => import('./basketball/client'),
  'would-you-rather': () => import('./would-you-rather/client'),
};

export function findGameRenderer(slug: string): GameLoader | null {
  return RENDERERS[slug] ?? null;
}
