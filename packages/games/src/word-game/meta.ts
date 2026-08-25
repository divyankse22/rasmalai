import type { GameMeta } from '../contract';
import {
  HINTS_EACH,
  HINT_COST,
  MIN_WORD,
  RAID_LETTERS,
  RAID_LETTERS_BEHIND,
  TURN_BONUS_MS,
  TURN_START_MS,
} from './protocol';

/**
 * Word Game — the ninth game, and the first one that needs a dictionary.
 *
 * Every other rulebook is self-contained: the rules are the whole truth, and a test can replay a
 * match from first principles. This one has to ask something outside itself whether a word is a
 * word, which is why `dictionary/` exists as its own directory with its own tests and its own
 * licence file. The rulebook decides whether you may play a word; the dictionary decides only
 * whether it is one.
 *
 * **Scored competitively, filed casual.** The `0004` seed shelved this next to Memory and Drawing,
 * and that is the right aisle — it is a light game you can play in four minutes. But somebody wins
 * it, by a margin, on purpose, so `scoringKind` is `competitive` and `0013` moves
 * `games.scoring_kind` to match. Memory set this precedent and Would You Rather followed it.
 *
 * `renderer: 'react'` per P-6, and matching what `0004` already declared: this is letter tiles and
 * a submit button. A canvas would add nothing a thumb cannot already do.
 */
export const meta: GameMeta = {
  slug: 'word-game',
  name: 'Word Game',
  category: 'casual',
  scoringKind: 'competitive',
  renderer: 'react',
  players: 2,
  // A tile rack above a word being built: taller than it is wide, on every device.
  orientation: 'any',
  inputs: ['tap', 'keyboard', 'pointer'],
  howToPlay: {
    tagline:
      'Build words from the letters on the table. Long words are worth far more than they look.',
    steps: [
      `Tap letters from the pool to build a word, ${MIN_WORD} letters or more.`,
      'A word scores its length squared — one six-letter word beats four three-letter ones.',
      'There is always one golden tile on the table, and a word using it is worth double.',
      `${RAID_LETTERS} letters also breaks one of their words and pays a bonus; ${RAID_LETTERS_BEHIND} is enough while you are behind.`,
      `${TURN_START_MS / 1000} seconds a turn, plus ${TURN_BONUS_MS / 1000} more for every word you have already made.`,
      `Stuck? Pass to top the table up, or spend a hint — ${HINTS_EACH} each, ${HINT_COST} points apiece.`,
    ],
  },
  // Points, not word counts — the scoreline is what the length-squared arithmetic produced.
  formatScore: (score) => `${score} point${score === 1 ? '' : 's'}`,
};
