import type { GameMeta } from '../contract';
import { PAIRS } from './protocol';

/**
 * Memory — the third game, and the first one that keeps a secret on a board both players are
 * looking at.
 *
 * Reaction Speed hides a moment; Four in a Row hides nothing at all. This hides twenty facts in
 * plain sight, which is a shape neither of the first two exercised: the authoritative state and the
 * view are genuinely different objects, and `getView` earns its place in the contract by being the
 * thing that stops the answer travelling with the question.
 *
 * **`scoringKind` is `competitive` while `category` is `casual`,** and the contract says in as many
 * words that a game may sit in the casual aisle and still be scored competitively. Turning up more
 * pairs than your partner is beating them — there is a winner, a loser and a scoreline — so a
 * result that counted towards nothing would be a worse lie than filing it under the wrong heading.
 * `0009` moves `games.scoring_kind` to match, because P-3 is read from the catalogue rather than
 * from here and the two disagreeing is the one way this could go quietly wrong.
 *
 * `renderer: 'react'` per P-6. Twenty rectangles that turn over are twenty rectangles.
 */
export const meta: GameMeta = {
  slug: 'memory',
  name: 'Memory',
  category: 'casual',
  scoringKind: 'competitive',
  renderer: 'react',
  players: 2,
  // Four across and five up wants the tall way round, and stays perfectly playable turned.
  orientation: 'any',
  inputs: ['tap', 'keyboard', 'pointer'],
  howToPlay: {
    tagline: `${PAIRS} pairs face down. Turn over more of them than they do.`,
    steps: [
      'Tap a card to turn it over, then tap a second one.',
      'A matching pair stays face up, and you go again.',
      'No match and both turn back after a moment — then it is their turn.',
      'Most pairs once the board is clear wins.',
    ],
  },
  // Pairs, out of ten. The one game so far whose score is a real quantity of something.
  formatScore: (score) => `${score} ${score === 1 ? 'pair' : 'pairs'}`,
};
