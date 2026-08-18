import type { GameMeta } from '../contract';

/**
 * Reflex — the sixth game, and the first one drawn with Phaser.
 *
 * P-6 says each game picks the cheapest renderer that works, and up to now that has been React
 * every time: a board, a grid, a list of options. This is the first thing in the product that
 * genuinely *moves* — hazards falling continuously for thirty seconds — and a React tree
 * re-rendering at 60fps to animate them would be the expensive way to draw a rectangle sliding
 * down a screen.
 *
 * **The rules did not change to accommodate it.** The whole point of P-6 is that the renderer is a
 * detail: this module's `server.ts` is the same pure, timer-free rulebook as every other game's,
 * and the platform cannot tell which of its games are canvases. `renderer: 'phaser'` reaches
 * exactly one place — the loader in `client.ts` — and Phaser itself is imported inside an effect so
 * it never touches a server render.
 *
 * **`orientation: 'landscape'`** is the first non-`any` answer in the catalogue. Five lanes with
 * room to see what is coming wants width; held upright the lanes get thin and the run-up gets
 * short. The renderer copes either way and says so on screen rather than refusing to draw.
 */
export const meta: GameMeta = {
  slug: 'reflex',
  name: 'Reflex',
  category: 'competitive',
  scoringKind: 'competitive',
  renderer: 'phaser',
  players: 2,
  orientation: 'landscape',
  // Tap a side, swipe across, or use the arrow keys — a moving game should not insist on one hand.
  inputs: ['tap', 'swipe', 'keyboard', 'pointer'],
  // Milliseconds survived. Exactly the case that made the platform stop guessing at score units:
  // "best 28640" is a worse thing to print on a card than no card at all.
  formatScore: (score) => `${(score / 1000).toFixed(1)}s`,
};
