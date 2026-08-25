import type { GameMeta } from '../contract';
import { MAX_STRIKES, STAGES } from './protocol';

/**
 * Bomb Defusal — the fifth game, the first cooperative one, and the first where the two players are
 * not looking at the same thing.
 *
 * Every game so far renders one picture and hides parts of it. This renders **two** — a bomb and a
 * manual — and neither is playable on its own. `getView` stops being a filter and becomes a fork,
 * which is the last shape in the contract that had never been exercised.
 *
 * **The manual is server-only.** Not because it is secret from the couple — they will learn it, and
 * getting faster at it is the game — but because a defuser who can read it in their own bundle can
 * defuse the bomb alone, and then there is no cooperative game left. It lives in `server.ts` and
 * reaches exactly one of the two screens.
 *
 * **No chat, and none needed.** `docs/01` section 14 rules out voice and text for V1, so the
 * conversation is carried by the game: the defuser reports a wire's colour with a tap, the expert
 * points at a wire with a tap. Two verbs, and the whole of Keep Talking and Nobody Explodes reduced
 * to something two people can do on two phones in silence.
 *
 * `scoringKind: 'cooperative'` — P-3: it counts towards games played and time played, and towards
 * nothing else. Nobody beats anybody; the bomb either goes off or it does not.
 *
 * `renderer: 'react'` per P-6. Six rectangles and a numbered list.
 */
export const meta: GameMeta = {
  slug: 'bomb-defusal',
  name: 'Bomb Defusal',
  category: 'cooperative',
  scoringKind: 'cooperative',
  renderer: 'react',
  players: 2,
  // Six wires down a column and a manual under it: both halves are lists, and lists want portrait.
  orientation: 'any',
  inputs: ['tap', 'keyboard', 'pointer'],
  howToPlay: {
    tagline: 'One bomb, two of you, and a single fuse. Neither half is playable alone.',
    steps: [
      'One of you is holding the bomb. The other is holding the manual.',
      'You cannot see each other’s screen, and there is no chat — the taps are how you talk.',
      'The defuser taps a wire to report its colour. The expert taps a wire to point at one.',
      'Only the defuser can cut, and one cut ends the bomb, right or wrong.',
      `${STAGES} bombs, one fuse across all of them, ${MAX_STRIKES} wrong cuts and it is over. You swap jobs each time.`,
    ],
  },
  // Stages survived, shared. P-3 keeps this out of the best-score column, so nothing is likely to
  // ask — but it is the truthful answer if anything ever does.
  formatScore: (score) => `${score} of 3 defused`,
};
