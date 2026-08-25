import type { GameMeta } from '../contract';

/**
 * Four in a Row — the second game, and the one that proves the contract is additive (T-3).
 *
 * Reaction Speed exercised one half of the platform: server-owned timing, a clock the rules ask for,
 * and a round that resets when somebody drops. This exercises the other half — turn ownership,
 * illegal moves, a board that must survive a disconnect intact — and it does it with no change to
 * the platform at all. Two games with almost nothing in common behind one interface is the only
 * honest test of whether that interface was worth having.
 *
 * `renderer: 'react'` per P-6. A grid of circles that fall is a grid of circles; Phaser would be the
 * most expensive way to draw one.
 */
export const meta: GameMeta = {
  slug: 'four-in-a-row',
  name: 'Four in a Row',
  category: 'competitive',
  scoringKind: 'competitive',
  renderer: 'react',
  players: 2,
  // Seven across by six up is close enough to square to be happy either way up.
  orientation: 'any',
  inputs: ['tap', 'keyboard', 'pointer'],
  howToPlay: {
    tagline: 'Line up four of your discs — across, upwards or diagonally.',
    steps: [
      'Tap a column and your disc drops to the bottom of it.',
      'You take turns. Who goes first is a coin flip, every board.',
      'Four in a row in any direction wins it.',
      'A full board with nobody at four is a draw.',
    ],
  },
  // One board is one match, so a score here is 1 or 0 and a lifetime best of "1" says only that you
  // have won at least once. Nothing worth a line on the card.
  formatScore: () => null,
};
