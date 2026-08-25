import type { Pool, PoolClient } from 'pg';
import { logger } from '../../logger';
import {
  applyToGameStats,
  applyToLifetime,
  durationSeconds,
  EMPTY_GAME_STATS_ROW,
  EMPTY_LIFETIME_ROW,
  type CompletedMatch,
  type GameStatsRow,
  type LifetimeRow,
  type Slot,
} from './matchStatistics';

/**
 * Match records and the aggregates they feed.
 *
 * Slice 5 built the read path and proved it correct at zero; this is the write half. Both live
 * against the tables `0004_dashboard.sql` created, and slice 8 adds no column and no index to them
 * — the formulas were fixed in that migration's comments precisely so this file would have nothing
 * left to invent.
 *
 * **A match row is written when a match starts, not when it ends.** Three reasons: `status`
 * distinguishes the three endings the product cares about (P-8 wants an abandoned match visible in
 * the seven-day history), the partial unique index on `(couple_id) where status = 'active'` makes
 * ADR-009 true in the database rather than only in memory, and a match nobody was around to finish
 * still leaves a trace of having happened.
 *
 * The cost of that choice is an `active` row that outlives the process that owned it. Live sessions
 * are memory-only and never survive a restart (`docs/13` section 6), so **every** `active` row at
 * boot is orphaned by definition — `abandonOrphanedMatches` closes them, and without it the index
 * above would refuse that couple every future match until somebody noticed.
 *
 * Every aggregate update reads its row `for update` and writes back a value computed in
 * `matchStatistics.ts`. Arithmetic in SQL would have been fewer lines and untestable.
 */

export type MatchMode = 'individual' | 'tournament';

export interface StartedMatch {
  matchId: string;
}

export interface StartMatchInput {
  coupleId: string;
  gameSlug: string;
  mode: MatchMode;
  startedAt: Date;
  /**
   * The tournament this match belongs to, written straight onto the row (`0008`).
   *
   * Kept on `matches` rather than only on `tournament_games` because it is the direction the reads
   * want: "which matches were part of this series" is a question about matches. The reverse link is
   * set when the series advances.
   */
  tournamentId?: string;
}

/** One seat's outcome, already resolved from a seat to a person by the session registry. */
export interface PlayerScore {
  userId: string;
  score: number;
}

export interface CompleteMatchInput {
  matchId: string;
  endedAt: Date;
  players: [PlayerScore, PlayerScore];
  /** Null on a draw and on every non-competitive game. Never sent by a client (`docs/02` §8). */
  winnerUserId: string | null;
  /** Awarded on the clock rather than played for. Counts as a win and nothing more. */
  byForfeit: boolean;
}

export interface StatisticsRepository {
  /** Opens the match row. Returns null when the game slug is unknown or the insert was refused. */
  startMatch(input: StartMatchInput): Promise<StartedMatch | null>;
  /** Completes the match and moves every aggregate it touches, in one transaction. */
  completeMatch(input: CompleteMatchInput): Promise<void>;
  /** P-8: recorded, visible for seven days, counted by nothing. */
  abandonMatch(matchId: string, endedAt: Date): Promise<void>;
  /** Closes `active` rows left behind by a restart. Returns how many. */
  abandonOrphanedMatches(): Promise<number>;
  /** ADR-008. Returns how many rows the retention job removed. */
  deleteExpiredMatches(): Promise<number>;
}

/**
 * Aliased for the reason the pairing repository carries a scar about: `matches`, `games` and
 * `couples` all have an `id`, and node-postgres lets a later column of the same name silently
 * overwrite an earlier one.
 */
interface ActiveMatchRow {
  couple_id: string;
  game_id: string;
  started_at: Date;
  scoring_kind: string;
  user_a_id: string;
  user_b_id: string;
}

interface LifetimeDbRow {
  total_games: number;
  competitive_games: number;
  user_a_wins: number;
  user_b_wins: number;
  draws: number;
  user_a_current_streak: number;
  user_b_current_streak: number;
  user_a_longest_streak: number;
  user_b_longest_streak: number;
  total_time_played_seconds: string | number;
  closest_match_margin: number | null;
  closest_match_game_id: string | null;
  closest_match_at: Date | null;
}

interface GameStatsDbRow {
  plays: number;
  user_a_wins: number;
  user_b_wins: number;
  draws: number;
  margin_total: string | number;
  margin_samples: number;
  user_a_best_score: number | null;
  user_b_best_score: number | null;
  total_time_played_seconds: string | number;
}

/** node-postgres hands back `bigint` as a string, because not every bigint survives a JS number. */
function toNumber(value: string | number | null | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Reads the couple's lifetime row, creating it if a couple somehow predates the table. */
async function readLifetime(client: PoolClient, coupleId: string): Promise<LifetimeRow> {
  await client.query(
    'insert into public.lifetime_statistics (couple_id) values ($1) on conflict do nothing',
    [coupleId],
  );

  const { rows } = await client.query<LifetimeDbRow>(
    `select total_games, competitive_games, user_a_wins, user_b_wins, draws,
            user_a_current_streak, user_b_current_streak,
            user_a_longest_streak, user_b_longest_streak,
            total_time_played_seconds, closest_match_margin, closest_match_game_id, closest_match_at
       from public.lifetime_statistics where couple_id = $1 for update`,
    [coupleId],
  );

  const row = rows[0];
  if (!row) return EMPTY_LIFETIME_ROW;

  return {
    totalGames: row.total_games,
    competitiveGames: row.competitive_games,
    userAWins: row.user_a_wins,
    userBWins: row.user_b_wins,
    draws: row.draws,
    userACurrentStreak: row.user_a_current_streak,
    userBCurrentStreak: row.user_b_current_streak,
    userALongestStreak: row.user_a_longest_streak,
    userBLongestStreak: row.user_b_longest_streak,
    totalTimePlayedSeconds: toNumber(row.total_time_played_seconds),
    closestMatchMargin: row.closest_match_margin,
    closestMatchGameId: row.closest_match_game_id,
    closestMatchAt: row.closest_match_at,
  };
}

async function readGameStats(
  client: PoolClient,
  coupleId: string,
  gameId: string,
): Promise<GameStatsRow> {
  await client.query(
    `insert into public.couple_game_stats (couple_id, game_id) values ($1, $2)
       on conflict (couple_id, game_id) do nothing`,
    [coupleId, gameId],
  );

  const { rows } = await client.query<GameStatsDbRow>(
    `select plays, user_a_wins, user_b_wins, draws, margin_total, margin_samples,
            user_a_best_score, user_b_best_score, total_time_played_seconds
       from public.couple_game_stats where couple_id = $1 and game_id = $2 for update`,
    [coupleId, gameId],
  );

  const row = rows[0];
  if (!row) return EMPTY_GAME_STATS_ROW;

  return {
    plays: row.plays,
    userAWins: row.user_a_wins,
    userBWins: row.user_b_wins,
    draws: row.draws,
    marginTotal: toNumber(row.margin_total),
    marginSamples: row.margin_samples,
    userABestScore: row.user_a_best_score,
    userBBestScore: row.user_b_best_score,
    totalTimePlayedSeconds: toNumber(row.total_time_played_seconds),
  };
}

export function createStatisticsRepository(pool: Pool): StatisticsRepository {
  async function markAbandoned(client: PoolClient, matchId: string, endedAt: Date): Promise<void> {
    await client.query(
      `update public.matches set status = 'abandoned', ended_at = $2
        where id = $1 and status = 'active'`,
      [matchId, endedAt],
    );
  }

  return {
    async startMatch({ coupleId, gameSlug, mode, startedAt, tournamentId }) {
      const game = await pool.query<{ id: string }>('select id from public.games where slug = $1', [
        gameSlug,
      ]);
      const gameId = game.rows[0]?.id;
      if (!gameId) {
        // Only an enabled catalogue row can be invited to, so this means the catalogue and the
        // modules have drifted. Worth a loud line; not worth interrupting a game in progress.
        logger.error({ gameSlug }, 'no catalogue row for a game being played');
        return null;
      }

      const { rows } = await pool.query<{ id: string }>(
        `insert into public.matches (couple_id, game_id, mode, status, started_at, tournament_id)
         values ($1, $2, $3, 'active', $4, $5)
         returning id`,
        [coupleId, gameId, mode, startedAt, tournamentId ?? null],
      );

      const matchId = rows[0]?.id;
      return matchId ? { matchId } : null;
    },

    async completeMatch({ matchId, endedAt, players, winnerUserId, byForfeit }) {
      await inTransaction(pool, async (client) => {
        // One read for everything the arithmetic needs, with the match row locked. `for update of m`
        // so the catalogue and the couple are read but not locked.
        const { rows } = await client.query<ActiveMatchRow>(
          `select m.couple_id, m.game_id, m.started_at, g.scoring_kind,
                  c.user_a_id, c.user_b_id
             from public.matches m
             join public.games g on g.id = m.game_id
             join public.couples c on c.id = m.couple_id
            where m.id = $1 and m.status = 'active'
              for update of m`,
          [matchId],
        );

        const row = rows[0];
        // Already ended — a duplicate frame, or a race with the session being torn down. Nothing
        // to do, and nothing to count twice.
        if (!row) return;

        const slotOf = (userId: string): Slot | null =>
          userId === row.user_a_id ? 'a' : userId === row.user_b_id ? 'b' : null;

        const scores = new Map<Slot, number>();
        for (const player of players) {
          const slot = slotOf(player.userId);
          if (slot) scores.set(slot, player.score);
        }

        // Unreachable: a session's two players are the couple, by construction. If it ever happens,
        // recording nothing is right — but leaving the row `active` would hold the couple's one
        // slot until a restart (ADR-009), so it is closed as abandoned instead.
        if (scores.size !== 2) {
          logger.error({ matchId }, 'match players are not this couple; recording no statistics');
          await markAbandoned(client, matchId, endedAt);
          return;
        }

        const scoreA = scores.get('a')!;
        const scoreB = scores.get('b')!;
        const winner = winnerUserId === null ? null : slotOf(winnerUserId);

        await client.query(
          `update public.matches
              set status = 'completed', winner_user_id = $2, score_a = $3, score_b = $4,
                  ended_at = $5
            where id = $1`,
          [matchId, winnerUserId, scoreA, scoreB, endedAt],
        );

        const match: CompletedMatch = {
          gameId: row.game_id,
          // From the catalogue rather than from the game module: `games.scoring_kind` is the column
          // the dashboard filters on when it reads these numbers back, so recording against
          // anything else could write margins no screen would ever show.
          competitive: row.scoring_kind === 'competitive',
          byForfeit,
          scoreA,
          scoreB,
          winner,
          durationSeconds: durationSeconds(row.started_at, endedAt),
          endedAt,
        };

        const lifetime = applyToLifetime(await readLifetime(client, row.couple_id), match);
        await client.query(
          `update public.lifetime_statistics
              set total_games = $2, competitive_games = $3,
                  user_a_wins = $4, user_b_wins = $5, draws = $6,
                  user_a_current_streak = $7, user_b_current_streak = $8,
                  user_a_longest_streak = $9, user_b_longest_streak = $10,
                  total_time_played_seconds = $11,
                  closest_match_margin = $12, closest_match_game_id = $13, closest_match_at = $14
            where couple_id = $1`,
          [
            row.couple_id,
            lifetime.totalGames,
            lifetime.competitiveGames,
            lifetime.userAWins,
            lifetime.userBWins,
            lifetime.draws,
            lifetime.userACurrentStreak,
            lifetime.userBCurrentStreak,
            lifetime.userALongestStreak,
            lifetime.userBLongestStreak,
            lifetime.totalTimePlayedSeconds,
            lifetime.closestMatchMargin,
            lifetime.closestMatchGameId,
            lifetime.closestMatchAt,
          ],
        );

        const perGame = applyToGameStats(
          await readGameStats(client, row.couple_id, row.game_id),
          match,
        );
        await client.query(
          `update public.couple_game_stats
              set plays = $3, user_a_wins = $4, user_b_wins = $5, draws = $6,
                  margin_total = $7, margin_samples = $8,
                  user_a_best_score = $9, user_b_best_score = $10,
                  total_time_played_seconds = $11
            where couple_id = $1 and game_id = $2`,
          [
            row.couple_id,
            row.game_id,
            perGame.plays,
            perGame.userAWins,
            perGame.userBWins,
            perGame.draws,
            perGame.marginTotal,
            perGame.marginSamples,
            perGame.userABestScore,
            perGame.userBBestScore,
            perGame.totalTimePlayedSeconds,
          ],
        );
      });
    },

    async abandonMatch(matchId, endedAt) {
      const client = await pool.connect();
      try {
        await markAbandoned(client, matchId, endedAt);
      } finally {
        client.release();
      }
    },

    async abandonOrphanedMatches() {
      // No `couple_id` filter and no age check on purpose: a live session cannot survive a restart,
      // so at the moment this runs every `active` row belongs to a process that is already gone.
      const { rowCount } = await pool.query(
        `update public.matches set status = 'abandoned', ended_at = coalesce(ended_at, now())
          where status = 'active'`,
      );
      return rowCount ?? 0;
    },

    async deleteExpiredMatches() {
      // Lossless, because every completed match was snapshotted into the aggregates when it ended
      // (P-5). This is the only thing in the product that deletes anything.
      const { rowCount } = await pool.query('delete from public.matches where expires_at < now()');
      return rowCount ?? 0;
    },
  };
}
