import type { GameMeta } from '../contract';
import { OPTIONS, ROUNDS } from './protocol';

/**
 * Guess My Answer — the fourth game, and the first social one.
 *
 * It exercises a shape none of the first three did: **both seats act at once, in secret, and the
 * round opens only when both are in.** Reaction Speed is simultaneous but races a stimulus rather
 * than each other; Four in a Row and Memory strictly alternate. Here neither player waits for the
 * other to finish before starting, and neither learns anything until they both have — which means
 * `turnOf` names whoever is *last* rather than whoever is next, and names nobody at all while they
 * are both still deciding.
 *
 * **Nothing here is a win.** `scoringKind: 'social'`, so P-3 keeps it out of every competitive
 * counter and P-4 runs it as an unscored round inside a tournament. The scoreline it does produce —
 * how many times each of you read the other right — is for the screen and the seven-day history,
 * and beating your partner at knowing them is not a thing this product wants to encourage.
 *
 * `renderer: 'react'` per P-6. Four buttons and a sentence.
 */
export const meta: GameMeta = {
  slug: 'guess-my-answer',
  name: 'Guess My Answer',
  category: 'social',
  scoringKind: 'social',
  renderer: 'react',
  players: 2,
  // A question and four answers is a column of text, which wants the tall way round.
  orientation: 'any',
  inputs: ['tap', 'keyboard', 'pointer'],
  howToPlay: {
    tagline: `${ROUNDS} questions about the two of you. Nobody wins this one — it just tells you something.`,
    steps: [
      'Each round, one of you answers about yourself while the other guesses that answer.',
      'You both choose at the same time, in secret. Neither of you sees the other’s screen.',
      'The round opens only when you are both in, so you find out together.',
      `${ROUNDS} rounds, ${ROUNDS / 2} each way, ${OPTIONS} options every time.`,
    ],
  },
  // Out of three: each of you answers three questions and guesses three.
  formatScore: (score) => `${score} of 3 read right`,
};
