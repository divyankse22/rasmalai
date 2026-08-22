/**
 * Everything about games that is safe anywhere: the contract, and what each game says about itself.
 *
 * Authoritative rules are behind `@rasmalai/games/server` and renderers behind
 * `@rasmalai/games/client`, so importing this from the browser can never drag a rulebook into the
 * bundle. An ESLint rule in `apps/web` enforces the half that matters.
 */

export * from './contract';

// One flat namespace shared by every game's protocol. The comment that used to sit here said it
// held only while no two games named a constant the same way, and that the day two did, the fix was
// to prefix the newer one. Memory's board is `COLUMNS` × `ROWS` and so is Four in a Row's, so that
// day is this one — and it failed exactly as advertised, at the compiler rather than at runtime.
//
// Every game added from here re-exports **explicitly**, under its own prefix. `export *` is kept for
// the two that predate the collision because renaming their constants would touch working code for
// no benefit; a game's own folder still uses the short names internally, and only the barrel spells
// them out. Nothing outside `packages/games` imports these constants at all — the renderers live in
// the package with the rules — so this list is a courtesy rather than an interface.
export { meta as reactionSpeedMeta } from './reaction-speed/meta';
export * from './reaction-speed/protocol';
export { meta as fourInARowMeta } from './four-in-a-row/meta';
export * from './four-in-a-row/protocol';

export { meta as memoryMeta } from './memory/meta';
export {
  COLUMNS as MEMORY_COLUMNS,
  ROWS as MEMORY_ROWS,
  CARDS as MEMORY_CARDS,
  PAIRS as MEMORY_PAIRS,
  PEEK_MS as MEMORY_PEEK_MS,
  FACES as MEMORY_FACES,
} from './memory/protocol';
export type { MemoryAction, MemoryCard, MemoryView, FlipAction } from './memory/protocol';

export { meta as guessMyAnswerMeta } from './guess-my-answer/meta';
export {
  ROUNDS as GUESS_MY_ANSWER_ROUNDS,
  OPTIONS as GUESS_MY_ANSWER_OPTIONS,
  QUESTIONS as GUESS_MY_ANSWER_QUESTIONS,
} from './guess-my-answer/protocol';
export type {
  ChooseAction,
  GuessMyAnswerAction,
  GuessMyAnswerView,
  NextAction,
  Question,
  Role,
  RoundRecap,
} from './guess-my-answer/protocol';

export { meta as bombDefusalMeta } from './bomb-defusal/meta';
export {
  WIRES as BOMB_WIRES,
  STAGES as BOMB_STAGES,
  MAX_STRIKES as BOMB_MAX_STRIKES,
  FUSE_MS as BOMB_FUSE_MS,
  COLOURS as BOMB_COLOURS,
} from './bomb-defusal/protocol';
export type {
  BombDefusalAction,
  BombDefusalView,
  Colour,
  CutAction,
  PointAction,
  ReportAction,
  WireView,
} from './bomb-defusal/protocol';

export { meta as reflexMeta } from './reflex/meta';
export {
  LANES as REFLEX_LANES,
  WAVES as REFLEX_WAVES,
  START_LANE as REFLEX_START_LANE,
  LEAD_IN_MS as REFLEX_LEAD_IN_MS,
  MOVE_COOLDOWN_MS as REFLEX_MOVE_COOLDOWN_MS,
  GRACE_MS as REFLEX_GRACE_MS,
} from './reflex/protocol';
export type { MoveAction, ReflexAction, ReflexView, Runner, Wave } from './reflex/protocol';

export { meta as basketballMeta } from './basketball/meta';
export {
  LEVELS as BASKETBALL_LEVELS,
  ROUNDS_PER_LEVEL as BASKETBALL_ROUNDS_PER_LEVEL,
  TOTAL_ROUNDS as BASKETBALL_TOTAL_ROUNDS,
  TOTAL_SHOTS as BASKETBALL_TOTAL_SHOTS,
  SHOT_CLOCK_MS as BASKETBALL_SHOT_CLOCK_MS,
  SETTLE_MS as BASKETBALL_SETTLE_MS,
  THREE_POINT_DISTANCE as BASKETBALL_THREE_POINT_DISTANCE,
  MIN_ANGLE_DEG as BASKETBALL_MIN_ANGLE_DEG,
  MAX_ANGLE_DEG as BASKETBALL_MAX_ANGLE_DEG,
} from './basketball/protocol';
export type {
  BasketballAction,
  BasketballView,
  HoopMotion,
  ShootAction,
  ShotOutcome,
  ShotView,
} from './basketball/protocol';

export { meta as wouldYouRatherMeta } from './would-you-rather/meta';
export {
  ROUNDS as WOULD_YOU_RATHER_ROUNDS,
  CANDIDATES as WOULD_YOU_RATHER_CANDIDATES,
  OPTIONS as WOULD_YOU_RATHER_OPTIONS,
  ASKS_EACH as WOULD_YOU_RATHER_ASKS_EACH,
} from './would-you-rather/protocol';
export type {
  AnswerAction as WouldYouRatherAnswerAction,
  AnswererView,
  AskerView,
  Dilemma as WouldYouRatherDilemma,
  Option as WouldYouRatherOption,
  PredictAction,
  SelectAction,
  WouldYouRatherAction,
  WouldYouRatherNextAction,
  WouldYouRatherPhase,
  WouldYouRatherRecap,
  WouldYouRatherRole,
  WouldYouRatherView,
} from './would-you-rather/protocol';

import type { GameMeta } from './contract';
import { meta as basketball } from './basketball/meta';
import { meta as bombDefusal } from './bomb-defusal/meta';
import { meta as fourInARow } from './four-in-a-row/meta';
import { meta as guessMyAnswer } from './guess-my-answer/meta';
import { meta as memory } from './memory/meta';
import { meta as reflex } from './reflex/meta';
import { meta as reactionSpeed } from './reaction-speed/meta';
import { meta as wouldYouRather } from './would-you-rather/meta';

/** Every game that has a module behind it, keyed by the slug in `public.games`. */
export const GAME_META: Readonly<Record<string, GameMeta>> = {
  [reactionSpeed.slug]: reactionSpeed,
  [fourInARow.slug]: fourInARow,
  [memory.slug]: memory,
  [guessMyAnswer.slug]: guessMyAnswer,
  [bombDefusal.slug]: bombDefusal,
  [reflex.slug]: reflex,
  [basketball.slug]: basketball,
  [wouldYouRather.slug]: wouldYouRather,
};

export function findGameMeta(slug: string): GameMeta | null {
  return GAME_META[slug] ?? null;
}

/**
 * One of a game's scores, spelled the way that game spells it — or null when it should not be shown.
 *
 * The platform holds `matches.score_a` and `couple_game_stats.user_a_best_score` as bare integers
 * and has no way to know whether a 14200 is points, milliseconds or cards. Rather than guess, it
 * asks; a game with nothing to say gets the plain number back, and a game that says the number is
 * meaningless gets to have it left off the screen entirely.
 */
export function formatGameScore(slug: string, score: number): string | null {
  const game = GAME_META[slug];
  if (!game) return String(score);
  return game.formatScore ? game.formatScore(score) : String(score);
}
