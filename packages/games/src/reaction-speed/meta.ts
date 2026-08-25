import type { GameMeta } from '../contract';
import { ROUNDS } from './protocol';

/**
 * Reaction Speed — the first game, chosen in T-3 because it proves the platform rather than the
 * artwork: synchronized start, server-owned timing, per-action validation, rounds, authoritative
 * scoring, results, reactions, rematch and reconnect, all in about forty seconds of play.
 *
 * `renderer: 'react'` per P-6. There is nothing to animate that a div cannot do, and pulling Phaser
 * in for a coloured rectangle you tap would be the most expensive way to draw one.
 */
export const meta: GameMeta = {
  slug: 'reaction-speed',
  name: 'Reaction Speed',
  category: 'competitive',
  scoringKind: 'competitive',
  renderer: 'react',
  players: 2,
  // The whole game is one big target. It works the same held either way up.
  orientation: 'any',
  inputs: ['tap', 'keyboard', 'pointer'],
  howToPlay: {
    tagline:
      'Five rounds. Tap the moment the screen tells you to — the quicker thumb takes the round.',
    steps: [
      'The screen holds on Wait… for a stretch you cannot predict.',
      'The instant it turns and says TAP!, tap it. Space or Enter works too.',
      'Whoever is quicker takes the round. Tapping early loses it outright.',
      `${ROUNDS} rounds, every one of them played. Most rounds wins.`,
    ],
  },
  // The score is rounds won out of five, not a reaction time — the fastest thumb is the lowest
  // number, and `GameResult.scores` only ever counts upwards.
  formatScore: (score) => `${score} ${score === 1 ? 'round' : 'rounds'}`,
};
