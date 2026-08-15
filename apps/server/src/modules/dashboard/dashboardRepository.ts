import type { Pool } from 'pg';
import type { GameCategory, GameRenderer, RecentStats } from '@rasmalai/shared';
import type { GameCounters } from './summary';

/**
 * Every couple-scoped read the dashboard needs.
 *
 * The couple's a/b slots are resolved to **you** and **them** here and nowhere else. That mapping
 * is deliberately not spread across a games repository and a statistics repository: the pairing
 * repository already carries a scar from two tables sharing a column name, and silently reading
 * the wrong slot would attribute a partner's wins to the viewer with nothing failing loudly.
 */

/** A catalogue row plus this couple's counters, already resolved to the viewer's perspective. */
export interface CatalogueRow extends GameCounters {
  description: string;
  category: GameCategory;
  renderer: GameRenderer;
  enabled: boolean;
  yourWins: number;
  partnerWins: number;
  draws: number;
  yourBestScore: number | null;
  partnerBestScore: number | null;
}

export interface LifetimeTotals {
  totalGames: number;
  competitiveGames: number;
  draws: number;
  totalTimePlayedSeconds: number;
  you: PlayerTotals;
  partner: PlayerTotals;
  closestMatch: { gameSlug: string; gameName: string; margin: number; playedAt: string } | null;
}

export interface PlayerTotals {
  wins: number;
  currentStreak: number;
  longestStreak: number;
  tournamentWins: number;
}

export interface CoupleScope {
  coupleId: string;
  /** Which slot the viewer occupies. Everything below is flipped through this. */
  viewerIsUserA: boolean;
}

export interface DashboardRepository {
  /** Resolves the caller's couple from membership — never from anything the browser sent. */
  findCoupleScope(userId: string): Promise<CoupleScope | null>;
  catalogue(scope: CoupleScope): Promise<CatalogueRow[]>;
  lifetime(scope: CoupleScope): Promise<LifetimeTotals>;
  lastSevenDays(scope: CoupleScope): Promise<RecentStats>;
}

/** Lifetime aggregates start at zero for a couple who has not finished a match yet. */
const EMPTY_PLAYER: PlayerTotals = {
  wins: 0,
  currentStreak: 0,
  longestStreak: 0,
  tournamentWins: 0,
};

const EMPTY_LIFETIME: LifetimeTotals = {
  totalGames: 0,
  competitiveGames: 0,
  draws: 0,
  totalTimePlayedSeconds: 0,
  you: EMPTY_PLAYER,
  partner: EMPTY_PLAYER,
  closestMatch: null,
};

interface CatalogueDbRow {
  slug: string;
  name: string;
  description: string;
  category: GameCategory;
  scoring_kind: GameCategory;
  renderer: GameRenderer;
  enabled: boolean;
  plays: string | number;
  user_a_wins: string | number;
  user_b_wins: string | number;
  draws: string | number;
  margin_total: string | number;
  margin_samples: string | number;
  user_a_best_score: number | null;
  user_b_best_score: number | null;
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
  closest_match_at: Date | null;
  closest_game_slug: string | null;
  closest_game_name: string | null;
  tournament_wins_a: number;
  tournament_wins_b: number;
}

/** Counted by slot, because that is what the match rows record. Flipped to you/them on the way out. */
interface RecentDbRow {
  games_played: string | number;
  won_by_a: string | number;
  won_by_b: string | number;
  draws: string | number;
}

/**
 * node-postgres returns bigint and count() as strings, because a bigint does not always survive a
 * JS number. Our counters never approach that, so they are narrowed here rather than leaking a
 * string into a field the DTO types as a number.
 */
function toNumber(value: string | number | null | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function createDashboardRepository(pool: Pool): DashboardRepository {
  return {
    async findCoupleScope(userId) {
      const { rows } = await pool.query<{ id: string; user_a_id: string }>(
        `select id, user_a_id from public.couples
          where user_a_id = $1 or user_b_id = $1`,
        [userId],
      );

      const row = rows[0];
      return row ? { coupleId: row.id, viewerIsUserA: row.user_a_id === userId } : null;
    },

    async catalogue({ coupleId, viewerIsUserA }) {
      // A left join, so the full catalogue comes back whether or not this couple has ever played.
      // The counters are the couple's; the games themselves are everyone's.
      const { rows } = await pool.query<CatalogueDbRow>(
        `select g.slug, g.name, g.description, g.category, g.scoring_kind, g.renderer, g.enabled,
                coalesce(s.plays, 0) as plays,
                coalesce(s.user_a_wins, 0) as user_a_wins,
                coalesce(s.user_b_wins, 0) as user_b_wins,
                coalesce(s.draws, 0) as draws,
                coalesce(s.margin_total, 0) as margin_total,
                coalesce(s.margin_samples, 0) as margin_samples,
                s.user_a_best_score, s.user_b_best_score
           from public.games g
           left join public.couple_game_stats s
             on s.game_id = g.id and s.couple_id = $1
          order by g.sort_order, g.name`,
        [coupleId],
      );

      return rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        description: row.description,
        category: row.category,
        scoringKind: row.scoring_kind,
        renderer: row.renderer,
        enabled: row.enabled,
        plays: toNumber(row.plays),
        yourWins: toNumber(viewerIsUserA ? row.user_a_wins : row.user_b_wins),
        partnerWins: toNumber(viewerIsUserA ? row.user_b_wins : row.user_a_wins),
        draws: toNumber(row.draws),
        yourBestScore: viewerIsUserA ? row.user_a_best_score : row.user_b_best_score,
        partnerBestScore: viewerIsUserA ? row.user_b_best_score : row.user_a_best_score,
        marginTotal: toNumber(row.margin_total),
        marginSamples: toNumber(row.margin_samples),
      }));
    },

    async lifetime({ coupleId, viewerIsUserA }) {
      const { rows } = await pool.query<LifetimeDbRow>(
        `select l.total_games, l.competitive_games, l.user_a_wins, l.user_b_wins, l.draws,
                l.user_a_current_streak, l.user_b_current_streak,
                l.user_a_longest_streak, l.user_b_longest_streak,
                l.total_time_played_seconds,
                l.closest_match_margin, l.closest_match_at,
                g.slug as closest_game_slug, g.name as closest_game_name,
                l.tournament_wins_a, l.tournament_wins_b
           from public.lifetime_statistics l
           left join public.games g on g.id = l.closest_match_game_id
          where l.couple_id = $1`,
        [coupleId],
      );

      const row = rows[0];
      // A couple paired before this table existed, or one whose row is somehow missing, reads as a
      // couple who has played nothing — which is true — rather than as an error.
      if (!row) return EMPTY_LIFETIME;

      const a: PlayerTotals = {
        wins: row.user_a_wins,
        currentStreak: row.user_a_current_streak,
        longestStreak: row.user_a_longest_streak,
        tournamentWins: row.tournament_wins_a,
      };
      const b: PlayerTotals = {
        wins: row.user_b_wins,
        currentStreak: row.user_b_current_streak,
        longestStreak: row.user_b_longest_streak,
        tournamentWins: row.tournament_wins_b,
      };

      return {
        totalGames: row.total_games,
        competitiveGames: row.competitive_games,
        draws: row.draws,
        totalTimePlayedSeconds: toNumber(row.total_time_played_seconds),
        you: viewerIsUserA ? a : b,
        partner: viewerIsUserA ? b : a,
        closestMatch:
          row.closest_match_margin !== null && row.closest_game_slug && row.closest_game_name
            ? {
                gameSlug: row.closest_game_slug,
                gameName: row.closest_game_name,
                margin: row.closest_match_margin,
                playedAt: (row.closest_match_at ?? new Date()).toISOString(),
              }
            : null,
      };
    },

    async lastSevenDays({ coupleId, viewerIsUserA }) {
      // Derived from raw matches rather than a rolling aggregate: they only exist for seven days
      // anyway (ADR-008), so the window and the retention period are the same thing, and
      // docs/03 asks for the simplest correct implementation at this scale.
      //
      // `status = 'completed'` is P-8 — an abandoned match is visible in history and counted by
      // nothing.
      const { rows } = await pool.query<RecentDbRow>(
        `select count(*) as games_played,
                count(*) filter (where m.winner_user_id = c.slot_a) as won_by_a,
                count(*) filter (where m.winner_user_id = c.slot_b) as won_by_b,
                count(*) filter (
                  where g.scoring_kind = 'competitive' and m.winner_user_id is null
                ) as draws
           from public.matches m
           join public.games g on g.id = m.game_id
           join (select id, user_a_id as slot_a, user_b_id as slot_b from public.couples) c
             on c.id = m.couple_id
          where m.couple_id = $1
            and m.status = 'completed'
            and m.started_at >= now() - interval '7 days'`,
        [coupleId],
      );

      const row = rows[0];
      if (!row) return { gamesPlayed: 0, youWon: 0, partnerWon: 0, draws: 0 };

      return {
        gamesPlayed: toNumber(row.games_played),
        youWon: toNumber(viewerIsUserA ? row.won_by_a : row.won_by_b),
        partnerWon: toNumber(viewerIsUserA ? row.won_by_b : row.won_by_a),
        draws: toNumber(row.draws),
      };
    },
  };
}
