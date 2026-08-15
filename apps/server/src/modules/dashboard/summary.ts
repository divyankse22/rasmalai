import type { CatalogueGame, NamedGame } from '@rasmalai/shared';

/**
 * The dashboard's arithmetic, kept away from SQL so it can be tested exhaustively.
 *
 * These are the formulas `docs/03_DATABASE_SCHEMA.md` asks to have validated before they are
 * relied on. They live here rather than in a query because "favourite game" and "most competitive
 * game" are questions about the counter rows we already fetch for the catalogue — asking the
 * database again would be a second, divergent definition of the same answer.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Days together, from the exact first-met date (`docs/01_PRODUCT_SPEC.md` section 16).
 *
 * Both sides are pinned to UTC midnight deliberately. The alternative — each partner's own
 * timezone — means a long-distance couple sees two different numbers for the same relationship,
 * which is worse than being up to a day out at the boundary. It is computed on the server for the
 * same reason: one clock, one answer.
 */
export function daysTogether(firstMetDate: string, now: Date = new Date()): number {
  const met = Date.parse(`${firstMetDate}T00:00:00Z`);
  if (Number.isNaN(met)) return 0;

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // A future date would otherwise read as a negative count; nobody has been together for -3 days.
  return Math.max(0, Math.round((today - met) / MS_PER_DAY));
}

/**
 * Share of completed competitive matches this person won, as a whole percent.
 *
 * Draws sit in the denominator, so the two win percentages plus the draw percentage account for
 * every match rather than quietly summing past 100.
 */
export function winPercentage(wins: number, competitiveGames: number): number {
  if (competitiveGames <= 0) return 0;
  return Math.round((wins / competitiveGames) * 100);
}

/** Counter fields the derivations below need, present on every catalogue row. */
export interface GameCounters extends Pick<CatalogueGame, 'slug' | 'name' | 'scoringKind'> {
  plays: number;
  marginTotal: number;
  marginSamples: number;
}

/**
 * The game these two play most, in any category.
 *
 * Ties break towards the earlier catalogue entry, which is stable ordering rather than a
 * meaningful preference — but a dashboard that reshuffles its own "favourite" between two equally
 * played games on every refresh looks broken.
 */
export function favouriteGame(
  games: readonly GameCounters[],
): (NamedGame & { plays: number }) | null {
  let best: GameCounters | null = null;
  for (const game of games) {
    if (game.plays > 0 && (best === null || game.plays > best.plays)) best = game;
  }
  return best ? { gameSlug: best.slug, gameName: best.name, plays: best.plays } : null;
}

/**
 * The competitive game whose matches finish closest together.
 *
 * Average margin, not most-played: "most competitive" should mean the nail-biter, and most-played
 * would only ever restate the favourite. Non-competitive games are excluded because they have no
 * margin to speak of, and a game with no completed matches has no average at all.
 */
export function mostCompetitiveGame(
  games: readonly GameCounters[],
): (NamedGame & { averageMargin: number }) | null {
  let best: { game: GameCounters; average: number } | null = null;

  for (const game of games) {
    if (game.scoringKind !== 'competitive' || game.marginSamples <= 0) continue;

    const average = game.marginTotal / game.marginSamples;
    if (best === null || average < best.average) best = { game, average };
  }

  return best
    ? {
        gameSlug: best.game.slug,
        gameName: best.game.name,
        // Two decimals: margins are small integers, so an average of 1.5 must not round to 2 and
        // claim the games are less close than they are.
        averageMargin: Math.round(best.average * 100) / 100,
      }
    : null;
}
