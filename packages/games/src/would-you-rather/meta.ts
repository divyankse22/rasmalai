import type { GameMeta } from '../contract';

/**
 * Would You Rather — the eighth game, and the first one where a player *chooses the question*.
 *
 * Every other game hands both seats the same problem. Here one of them picks which of three
 * dilemmas to inflict, and only then bets on how their partner will answer it. That is the whole
 * game: not "do you know them", but "do you know which impossible choice will break them, and can
 * you still call it".
 *
 * **This one names a winner, and Guess My Answer does not.** `guess-my-answer/meta.ts` says plainly
 * that "beating your partner at knowing them is not a thing this product wants to encourage", and
 * that stays true of *that* game, where both seats are handed the same question and neither chose
 * it. The Asker here made a decision before they made a guess — they picked the ground to fight on.
 * That is a skill, it is theirs, and a game of skill that refuses to say who won is a strange
 * object. So `scoringKind: 'competitive'` while `category: 'social'` stays where the catalogue
 * filed it: Memory already established that those two fields are allowed to disagree, and
 * `0012_would_you_rather.sql` moves the database to match.
 *
 * `renderer: 'react'` per P-6 — this is text and two buttons, and putting a canvas near it would be
 * showing off rather than helping.
 */
export const meta: GameMeta = {
  slug: 'would-you-rather',
  name: 'Would You Rather',
  category: 'social',
  scoringKind: 'competitive',
  renderer: 'react',
  players: 2,
  // Long prompts stacked in a column, which is the tall way round on every device.
  orientation: 'any',
  inputs: ['tap', 'keyboard', 'pointer'],
  // Out of three: you ask three of the six rounds, and each is one prediction.
  formatScore: (score) => `${score} of 3 read right`,
};
