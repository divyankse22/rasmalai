/**
 * What a finished match does to a couple's numbers.
 *
 * Pure arithmetic, deliberately kept out of SQL. The formulas were fixed in the comments of
 * `0004_dashboard.sql` and `docs/09_TESTING_STRATEGY.md` asks for streak calculation to be unit
 * tested — a `case when` buried in an `on conflict do update` cannot be tested without a database,
 * and streaks are the one aggregate where an off-by-one is invisible until somebody notices their
 * best week never happened. The repository reads the current row, calls these, and writes the
 * result back inside one transaction.
 *
 * Two product rules do most of the work:
 *
 *   P-3  Win statistics are competitive-only. A cooperative, social or casual match increments
 *        games-played and time-played and touches nothing else.
 *   P-8  An abandoned match never counts. It never reaches this file at all — the repository only
 *        calls these for `status = 'completed'`.
 *
 * And one decision taken in slice 8: a **forfeit** counts as a win and nothing more. The 1–0 a
 * walkover is awarded is a flag rather than a scoreline (`docs/13` section 6), so it feeds games
 * played, wins, win percentage, streaks and that game's play count, but never the margin
 * statistics or a best score. Otherwise "your closest ever match" could turn out to be the evening
 * one of them shut their laptop.
 */

/** Which half of the couple. The fixed a/b slots the `couples` row defines, never a seat. */
export type Slot = 'a' | 'b';

export interface CompletedMatch {
  gameId: string;
  /** From `games.scoring_kind` — the catalogue, which is also what the dashboard reads back. */
  competitive: boolean;
  /** Awarded because the other player ran the 120-second clock out, rather than played for. */
  byForfeit: boolean;
  scoreA: number;
  scoreB: number;
  /** Null on a draw, and on every match a non-competitive game produced. */
  winner: Slot | null;
  /** Wall clock, start to end. Includes any stretch spent waiting for somebody to come back. */
  durationSeconds: number;
  endedAt: Date;
}

/** The subset of `public.lifetime_statistics` a completed match can move. */
export interface LifetimeRow {
  totalGames: number;
  competitiveGames: number;
  userAWins: number;
  userBWins: number;
  draws: number;
  userACurrentStreak: number;
  userBCurrentStreak: number;
  userALongestStreak: number;
  userBLongestStreak: number;
  totalTimePlayedSeconds: number;
  closestMatchMargin: number | null;
  closestMatchGameId: string | null;
  closestMatchAt: Date | null;
}

/** The subset of `public.couple_game_stats` a completed match can move. */
export interface GameStatsRow {
  plays: number;
  userAWins: number;
  userBWins: number;
  draws: number;
  marginTotal: number;
  marginSamples: number;
  userABestScore: number | null;
  userBBestScore: number | null;
  totalTimePlayedSeconds: number;
}

export const EMPTY_LIFETIME_ROW: LifetimeRow = {
  totalGames: 0,
  competitiveGames: 0,
  userAWins: 0,
  userBWins: 0,
  draws: 0,
  userACurrentStreak: 0,
  userBCurrentStreak: 0,
  userALongestStreak: 0,
  userBLongestStreak: 0,
  totalTimePlayedSeconds: 0,
  closestMatchMargin: null,
  closestMatchGameId: null,
  closestMatchAt: null,
};

export const EMPTY_GAME_STATS_ROW: GameStatsRow = {
  plays: 0,
  userAWins: 0,
  userBWins: 0,
  draws: 0,
  marginTotal: 0,
  marginSamples: 0,
  userABestScore: null,
  userBBestScore: null,
  totalTimePlayedSeconds: 0,
};

/** A completed competitive match with no winner. Nothing else in the schema is a draw. */
function isDraw(match: CompletedMatch): boolean {
  return match.competitive && match.winner === null;
}

/** How far apart the two of them finished. Only ever asked about a competitive match. */
function margin(match: CompletedMatch): number {
  return Math.abs(match.scoreA - match.scoreB);
}

/**
 * Whether this match is allowed to say anything about how close it was.
 *
 * A forfeit is not: it was awarded, not played, and a scoreline of 1–0 that nobody contested would
 * make walkouts the most competitive thing this couple does.
 */
function hasRealScoreline(match: CompletedMatch): boolean {
  return match.competitive && !match.byForfeit;
}

/** The high-water mark, which can only ever be the streak that just moved. */
function highWaterMark(longest: number, current: number): number {
  return Math.max(longest, current);
}

export function applyToLifetime(current: LifetimeRow, match: CompletedMatch): LifetimeRow {
  const next: LifetimeRow = {
    ...current,
    totalGames: current.totalGames + 1,
    totalTimePlayedSeconds: current.totalTimePlayedSeconds + match.durationSeconds,
  };

  // P-3. A cooperative win is not a win over anybody, and must never look like one.
  if (!match.competitive) return next;

  next.competitiveGames += 1;

  if (match.winner === 'a') {
    next.userAWins += 1;
    next.userACurrentStreak += 1;
    // A loss ends a streak. Not zeroed on a win, which is why the two are set separately.
    next.userBCurrentStreak = 0;
    next.userALongestStreak = highWaterMark(next.userALongestStreak, next.userACurrentStreak);
  } else if (match.winner === 'b') {
    next.userBWins += 1;
    next.userBCurrentStreak += 1;
    next.userACurrentStreak = 0;
    next.userBLongestStreak = highWaterMark(next.userBLongestStreak, next.userBCurrentStreak);
  } else {
    // A draw is not a win, so it resets both streaks rather than extending either
    // (`0004_dashboard.sql`).
    next.draws += 1;
    next.userACurrentStreak = 0;
    next.userBCurrentStreak = 0;
  }

  if (hasRealScoreline(match)) {
    const played = margin(match);
    // Strictly closer, so the *first* match to reach a margin keeps it. A later match that merely
    // equals it would reshuffle the date and the game name on the dashboard for no reason.
    if (next.closestMatchMargin === null || played < next.closestMatchMargin) {
      next.closestMatchMargin = played;
      next.closestMatchGameId = match.gameId;
      next.closestMatchAt = match.endedAt;
    }
  }

  return next;
}

export function applyToGameStats(current: GameStatsRow, match: CompletedMatch): GameStatsRow {
  const next: GameStatsRow = {
    ...current,
    plays: current.plays + 1,
    totalTimePlayedSeconds: current.totalTimePlayedSeconds + match.durationSeconds,
  };

  // P-3 again, and the reason a cooperative game's high score has nowhere to go yet: "touch nothing
  // else" includes the best-score columns. The game module that first wants one should say so.
  if (!match.competitive) return next;

  if (match.winner === 'a') next.userAWins += 1;
  else if (match.winner === 'b') next.userBWins += 1;
  if (isDraw(match)) next.draws += 1;

  if (hasRealScoreline(match)) {
    // Sum and count rather than a stored average, so "most competitive game" stays exact after the
    // matches themselves have expired at seven days (ADR-008).
    next.marginTotal += margin(match);
    next.marginSamples += 1;

    next.userABestScore = Math.max(current.userABestScore ?? match.scoreA, match.scoreA);
    next.userBBestScore = Math.max(current.userBBestScore ?? match.scoreB, match.scoreB);
  }

  return next;
}

/** Wall clock, floored at zero so a clock adjustment can never subtract from time played. */
export function durationSeconds(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
}
