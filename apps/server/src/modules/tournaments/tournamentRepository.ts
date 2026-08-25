import type { Pool } from 'pg';
import type {
  TournamentGameView,
  TournamentStatus,
  TournamentView,
} from '@rasmalai/shared';
import { TOURNAMENT_MAX_GAMES, TOURNAMENT_MIN_GAMES } from '@rasmalai/shared';
import { logger } from '../../logger';

/** Postgres' unique-violation code, which is how two simultaneous creations are decided. */
const UNIQUE_VIOLATION = '23505';

/**
 * Tournament persistence.
 *
 * A tournament is a locked sequence of games played for points: win 3, draw 1, lose 0. Only
 * competitive games score (P-4). Each game slug appears at most once (D-2). The creator names
 * the tournament (D-4).
 *
 * The one-active-per-couple partial unique index mirrors ADR-009: a couple cannot start a second
 * tournament until the first is terminal. A paused tournament expires after 48 hours (D-5) and is
 * cleaned up by the retention sweep.
 */

export class TournamentError extends Error {
  constructor(
    readonly code:
      | 'not_paired'
      | 'tournament_not_found'
      | 'tournament_not_active'
      | 'tournament_not_paused'
      | 'tournament_not_pending'
      | 'tournament_expired'
      | 'already_has_tournament'
      | 'invalid_game_count'
      | 'duplicate_game'
      | 'game_not_found'
      | 'game_not_playable'
      /** The creator tried to answer their own request — mirrors invitations' identical rule. */
      | 'cannot_answer_own',
    message: string,
  ) {
    super(message);
  }
}

export interface TournamentGame {
  id: string;
  gameId: string;
  gameSlug: string;
  gameName: string;
  position: number;
  matchId: string | null;
  scored: boolean;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  pointsA: number;
  pointsB: number;
}

export interface Tournament {
  id: string;
  coupleId: string;
  name: string;
  status: TournamentStatus;
  createdByUserId: string;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  pausedUntil: Date | null;
  /** Set while `status` is `pending`; null once the request has been answered, cancelled or expired. */
  requestExpiresAt: Date | null;
  totalPointsA: number;
  totalPointsB: number;
  winnerUserId: string | null;
  games: TournamentGame[];
}

/**
 * What the engine tells the repository about a finished game.
 *
 * No match id: the engine has none to give. Recording is fire and forget (`matchRecorder`), so the
 * row may still be in the queue when the series advances. The link is resolved here instead, from
 * `matches.tournament_id` — which the same match wrote on its way in — and it is best effort by
 * construction. `tournament_games.match_id` is a convenience for reading a series back; the
 * authoritative direction is the column on `matches`.
 */
export interface GameResultInput {
  tournamentGameId: string;
  winnerUserId: string | null;
  scored: boolean;
}

export interface TournamentRepository {
  /**
   * Creates a tournament **request** and its locked game list, `pending` and unanswered.
   *
   * Mirrors `invitations.create`: nothing is `active` yet, and `requestExpiresAt` is five minutes
   * out. `respondToTournamentRequest` is what actually opens the series.
   */
  createTournament(input: {
    coupleId: string;
    createdByUserId: string;
    name: string;
    gameSlugs: string[];
  }): Promise<Tournament>;

  /** The couple's one non-terminal tournament (including an unanswered request), if any. */
  getActiveTournament(coupleId: string): Promise<Tournament | null>;

  /** A specific tournament, scoped to the couple. */
  getTournament(tournamentId: string, coupleId: string): Promise<Tournament | null>;

  /**
   * The partner answers a request. Mirrors `invitations.respond`.
   *
   * On accept: opens the series — `status` becomes `active` and the first game `active`, exactly
   * what `createTournament` used to do immediately. On decline: `status` becomes `declined`. Either
   * way only the partner the request was not sent by may call this — the creator answering their
   * own request is `cannot_answer_own`, mirroring the invitation rule exactly.
   */
  respondToTournamentRequest(
    tournamentId: string,
    userId: string,
    accept: boolean,
  ): Promise<{ tournament: Tournament; otherUserId: string }>;

  /** The creator withdraws a still-unanswered request. Mirrors `invitations.cancel`. */
  cancelTournamentRequest(
    tournamentId: string,
    userId: string,
  ): Promise<{ tournament: Tournament; otherUserId: string }>;

  /**
   * Closes every request whose five minutes are up. Mirrors `invitations.sweepExpired` — returns
   * enough to build a per-reader view for both partners, not just the ids, because unlike an
   * abandoned series (silent until the dashboard next asks) a live request is worth an instant push.
   */
  sweepExpiredTournamentRequests(): Promise<
    { tournament: Tournament; userAId: string; userIds: [string, string] }[]
  >;

  /**
   * Marks a game as completed, awards 3/1/0 if scored, updates totals, and checks whether
   * the tournament is done. If all games are complete, sets the winner and updates
   * lifetime_statistics.tournament_wins.
   */
  advanceGame(
    tournamentId: string,
    input: GameResultInput,
    /** The couple's user_a_id. */
    userAId: string,
  ): Promise<Tournament>;

  /** D-5: pause a tournament between games. Sets `paused_until = now() + 48h`. */
  pauseTournament(tournamentId: string): Promise<Tournament>;

  /** Resume a paused tournament. Validates within TTL. */
  resumeTournament(tournamentId: string): Promise<Tournament>;

  /** Abandon a tournament. Terminal. */
  abandonTournament(tournamentId: string): Promise<void>;

  /** Sweep paused tournaments past their TTL. Returns count abandoned. */
  abandonExpiredTournaments(): Promise<number>;

  /**
   * Pauses every `active` tournament that nothing is playing, naming the ones that are.
   *
   * Live sessions do not survive a restart (`docs/13` section 6), so at startup this is every
   * active row there is: a series whose session died with the process, left `active` in the
   * database with nothing able to advance it. Paused, it reappears on the dashboard with a Resume
   * button and its 48 hours (D-5) instead of being stuck.
   */
  pauseStrandedTournaments(runningIds: readonly string[]): Promise<number>;
}

export function createTournamentRepository(pool: Pool): TournamentRepository {
  async function loadTournament(
    tournamentId: string,
    coupleId?: string,
  ): Promise<Tournament | null> {
    const whereClause = coupleId
      ? 'where t.id = $1 and t.couple_id = $2'
      : 'where t.id = $1';
    const params = coupleId ? [tournamentId, coupleId] : [tournamentId];

    const tResult = await pool.query(
      `select
         t.id, t.couple_id, t.name, t.status, t.created_by_user_id,
         t.created_at, t.started_at, t.ended_at, t.paused_until, t.request_expires_at,
         t.total_points_a, t.total_points_b, t.winner_user_id
       from public.tournaments t
       ${whereClause}`,
      params,
    );

    if (tResult.rows.length === 0) return null;

    const row = tResult.rows[0];
    const gResult = await pool.query(
      `select
         tg.id, tg.game_id, g.slug as game_slug, g.name as game_name,
         tg.position, tg.match_id, tg.scored, tg.status, tg.points_a, tg.points_b
       from public.tournament_games tg
       join public.games g on g.id = tg.game_id
       where tg.tournament_id = $1
       order by tg.position`,
      [tournamentId],
    );

    return {
      id: row.id,
      coupleId: row.couple_id,
      name: row.name,
      status: row.status,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      pausedUntil: row.paused_until,
      requestExpiresAt: row.request_expires_at,
      totalPointsA: row.total_points_a,
      totalPointsB: row.total_points_b,
      winnerUserId: row.winner_user_id,
      games: gResult.rows.map((g: Record<string, unknown>) => ({
        id: g.id as string,
        gameId: g.game_id as string,
        gameSlug: g.game_slug as string,
        gameName: g.game_name as string,
        position: g.position as number,
        matchId: g.match_id as string | null,
        scored: g.scored as boolean,
        status: g.status as TournamentGame['status'],
        pointsA: g.points_a as number,
        pointsB: g.points_b as number,
      })),
    };
  }

  return {
    async createTournament({ coupleId, createdByUserId, name, gameSlugs }) {
      // D-1: three is the fewest that makes a series rather than a match, seven the most that fits
      // in an evening. Checked here as well as at the route, because this is the only door.
      if (gameSlugs.length < TOURNAMENT_MIN_GAMES || gameSlugs.length > TOURNAMENT_MAX_GAMES) {
        throw new TournamentError(
          'invalid_game_count',
          `Pick between ${TOURNAMENT_MIN_GAMES} and ${TOURNAMENT_MAX_GAMES} games.`,
        );
      }

      // D-2: each game is played once, which is also what makes the whole series a fair comparison.
      const uniqueSlugs = new Set(gameSlugs);
      if (uniqueSlugs.size !== gameSlugs.length) {
        throw new TournamentError('duplicate_game', 'Each game can only appear once in a tournament.');
      }

      const client = await pool.connect();
      try {
        await client.query('begin');

        // Look up game ids and scoring kinds
        const gamesResult = await client.query(
          `select id, slug, name, scoring_kind, enabled
           from public.games
           where slug = any($1)`,
          [gameSlugs],
        );

        const gamesBySlug = new Map<string, { id: string; name: string; scoringKind: string; enabled: boolean }>();
        for (const g of gamesResult.rows) {
          gamesBySlug.set(g.slug, {
            id: g.id,
            name: g.name,
            scoringKind: g.scoring_kind,
            enabled: g.enabled,
          });
        }

        // Validate all slugs exist and are enabled
        for (const slug of gameSlugs) {
          const game = gamesBySlug.get(slug);
          if (!game) throw new TournamentError('game_not_found', `Game "${slug}" does not exist.`);
          if (!game.enabled) throw new TournamentError('game_not_playable', `Game "${slug}" is not available yet.`);
        }

        // Insert the tournament as a request: pending, unstarted, five minutes to answer — the same
        // shape `invitations.create` inserts. `respondToTournamentRequest` is what opens it.
        const tResult = await client.query(
          `insert into public.tournaments
             (couple_id, name, status, created_by_user_id, request_expires_at)
           values ($1, $2, 'pending', $3, now() + interval '5 minutes')
           returning id`,
          [coupleId, name, createdByUserId],
        );
        const tournamentId = tResult.rows[0].id as string;

        // Insert tournament games in order. All `pending` — nothing opens until the request is
        // accepted, unlike the old instant-start insert which activated the first one here.
        for (let i = 0; i < gameSlugs.length; i++) {
          const slug = gameSlugs[i]!;
          const game = gamesBySlug.get(slug)!;
          await client.query(
            `insert into public.tournament_games (tournament_id, game_id, position, scored, status)
             values ($1, $2, $3, $4, 'pending')`,
            [tournamentId, game.id, i + 1, game.scoringKind === 'competitive'],
          );
        }

        await client.query('commit');

        const tournament = await loadTournament(tournamentId);
        if (!tournament) throw new Error('tournament just created but not found');
        return tournament;
      } catch (error) {
        await client.query('rollback');

        // The partial unique index is what actually enforces one series per couple, and it is the
        // only thing that can decide two creations racing from the couple's two devices. Reading
        // first and inserting second would leave a window where both reads say "none" — so the
        // check is the insert, and this is its answer.
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === UNIQUE_VIOLATION
        ) {
          throw new TournamentError(
            'already_has_tournament',
            'You two already have a tournament on the go.',
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async getActiveTournament(coupleId) {
      const result = await pool.query(
        `select id from public.tournaments
         where couple_id = $1 and status in ('pending', 'active', 'paused')
         limit 1`,
        [coupleId],
      );

      if (result.rows.length === 0) return null;
      return loadTournament(result.rows[0].id as string);
    },

    async getTournament(tournamentId, coupleId) {
      return loadTournament(tournamentId, coupleId);
    },

    async respondToTournamentRequest(tournamentId, userId, accept) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        const found = await client.query<{
          couple_id: string;
          created_by_user_id: string;
          status: string;
          expired: boolean;
          user_a_id: string;
          user_b_id: string;
        }>(
          `select t.couple_id, t.created_by_user_id, t.status,
                  (t.request_expires_at <= now()) as expired,
                  c.user_a_id, c.user_b_id
             from public.tournaments t
             join public.couples c on c.id = t.couple_id
            where t.id = $1 for update of t`,
          [tournamentId],
        );

        const row = found.rows[0];
        // A wrong couple reads as "not found", same reasoning as invitations: no confirming to a
        // stranger that a row exists.
        if (!row || (row.user_a_id !== userId && row.user_b_id !== userId)) {
          throw new TournamentError('tournament_not_found', 'That tournament does not exist.');
        }
        if (row.created_by_user_id === userId) {
          throw new TournamentError('cannot_answer_own', 'You sent this one — they answer it.');
        }
        if (row.status !== 'pending') {
          throw new TournamentError('tournament_not_pending', 'That was already answered.');
        }
        if (row.expired) {
          // Close it properly on the way past, so the row stops claiming to be pending — the same
          // lazy-expiry handling `invitations.respond` does.
          await client.query(
            `update public.tournaments set status = 'expired', ended_at = now() where id = $1`,
            [tournamentId],
          );
          await client.query('commit');
          throw new TournamentError('tournament_expired', 'That request ran out.');
        }

        const otherUserId = row.user_a_id === userId ? row.user_b_id : row.user_a_id;

        if (accept) {
          await client.query(
            `update public.tournaments
             set status = 'active', started_at = now(), request_expires_at = null
             where id = $1`,
            [tournamentId],
          );
          // The line `createTournament` used to run at insert time, now run here instead: nothing
          // opens until the request is actually accepted.
          await client.query(
            `update public.tournament_games
             set status = 'active'
             where tournament_id = $1 and position = 1`,
            [tournamentId],
          );
        } else {
          await client.query(
            `update public.tournaments set status = 'declined', ended_at = now() where id = $1`,
            [tournamentId],
          );
        }

        await client.query('commit');

        const tournament = await loadTournament(tournamentId);
        if (!tournament) throw new Error('tournament vanished immediately after response');
        return { tournament, otherUserId };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async cancelTournamentRequest(tournamentId, userId) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        const found = await client.query<{
          created_by_user_id: string;
          status: string;
          user_a_id: string;
          user_b_id: string;
        }>(
          `select t.created_by_user_id, t.status, c.user_a_id, c.user_b_id
             from public.tournaments t
             join public.couples c on c.id = t.couple_id
            where t.id = $1 for update of t`,
          [tournamentId],
        );

        const row = found.rows[0];
        if (!row || row.created_by_user_id !== userId) {
          // Not yours to withdraw reads the same as not existing, same as `invitations.cancel`.
          throw new TournamentError('tournament_not_found', 'That tournament does not exist.');
        }
        if (row.status !== 'pending') {
          throw new TournamentError('tournament_not_pending', 'That was already answered.');
        }

        await client.query(
          `update public.tournaments set status = 'cancelled', ended_at = now() where id = $1`,
          [tournamentId],
        );
        await client.query('commit');

        const tournament = await loadTournament(tournamentId);
        if (!tournament) throw new Error('tournament vanished immediately after cancel');
        const otherUserId = row.user_a_id === userId ? row.user_b_id : row.user_a_id;
        return { tournament, otherUserId };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async sweepExpiredTournamentRequests() {
      const { rows } = await pool.query<{ id: string; couple_id: string }>(
        `update public.tournaments
            set status = 'expired', ended_at = now()
          where status = 'pending' and request_expires_at <= now()
          returning id, couple_id`,
      );

      const closed: { tournament: Tournament; userAId: string; userIds: [string, string] }[] = [];
      for (const row of rows) {
        const tournament = await loadTournament(row.id);
        if (!tournament) continue;

        const couple = await pool.query<{ user_a_id: string; user_b_id: string }>(
          `select user_a_id, user_b_id from public.couples where id = $1`,
          [row.couple_id],
        );
        const c = couple.rows[0];
        if (!c) continue;

        closed.push({ tournament, userAId: c.user_a_id, userIds: [c.user_a_id, c.user_b_id] });
      }

      return closed;
    },

    async advanceGame(tournamentId, input, userAId) {
      const client = await pool.connect();
      try {
        await client.query('begin');

        // Lock the tournament row
        const tResult = await client.query(
          `select id, couple_id, total_points_a, total_points_b, status
           from public.tournaments where id = $1 for update`,
          [tournamentId],
        );
        if (tResult.rows.length === 0) {
          throw new TournamentError('tournament_not_found', 'That tournament does not exist.');
        }

        const tRow = tResult.rows[0];
        if (tRow.status !== 'active') {
          throw new TournamentError('tournament_not_active', 'That tournament is not running.');
        }

        // Award points: 3/1/0 for scored games
        let addA = 0;
        let addB = 0;
        if (input.scored) {
          if (input.winnerUserId === null) {
            // Draw: 1 each
            addA = 1;
            addB = 1;
          } else if (input.winnerUserId === userAId) {
            addA = 3;
          } else {
            addB = 3;
          }
        }

        // The match link is resolved rather than supplied: the recorder writes the row on its own
        // queue, so the latest match this couple played of this game *for this tournament* is the
        // one that just ended. Null when the write has not landed yet, which costs nothing — the
        // authoritative link is `matches.tournament_id`, already written at match start.
        await client.query(
          `update public.tournament_games tg
           set status = 'completed',
               points_a = $2,
               points_b = $3,
               match_id = (
                 select m.id from public.matches m
                 where m.tournament_id = tg.tournament_id
                   and m.game_id = tg.game_id
                 order by m.started_at desc
                 limit 1
               )
           where tg.id = $1`,
          [input.tournamentGameId, addA, addB],
        );

        const newTotalA = (tRow.total_points_a as number) + addA;
        const newTotalB = (tRow.total_points_b as number) + addB;

        // Check if all games are done
        const remaining = await client.query(
          `select count(*)::int as count from public.tournament_games
           where tournament_id = $1 and status in ('pending', 'active')`,
          [tournamentId],
        );
        const allDone = (remaining.rows[0].count as number) === 0;

        if (allDone) {
          // Determine winner
          let winnerUserId: string | null = null;
          if (newTotalA > newTotalB) {
            winnerUserId = userAId;
          } else if (newTotalB > newTotalA) {
            // Need to resolve user_b
            const coupleResult = await client.query(
              `select user_a_id, user_b_id from public.couples where id = $1`,
              [tRow.couple_id],
            );
            const couple = coupleResult.rows[0];
            winnerUserId = couple.user_a_id === userAId ? couple.user_b_id : couple.user_a_id;
          }
          // else: tied, no winner

          await client.query(
            `update public.tournaments
             set status = 'completed', total_points_a = $2, total_points_b = $3,
                 winner_user_id = $4, ended_at = now()
             where id = $1`,
            [tournamentId, newTotalA, newTotalB, winnerUserId],
          );

          // Update lifetime tournament wins
          if (winnerUserId !== null) {
            const winnerSlot = winnerUserId === userAId ? 'tournament_wins_a' : 'tournament_wins_b';
            await client.query(
              `update public.lifetime_statistics
               set ${winnerSlot} = ${winnerSlot} + 1
               where couple_id = $1`,
              [tRow.couple_id],
            );
          }
        } else {
          // Just update totals
          await client.query(
            `update public.tournaments
             set total_points_a = $2, total_points_b = $3
             where id = $1`,
            [tournamentId, newTotalA, newTotalB],
          );

          // Activate the next game
          await client.query(
            `update public.tournament_games
             set status = 'active'
             where tournament_id = $1
               and status = 'pending'
               and position = (
                 select min(position) from public.tournament_games
                 where tournament_id = $1 and status = 'pending'
               )`,
            [tournamentId],
          );
        }

        await client.query('commit');

        const tournament = await loadTournament(tournamentId);
        if (!tournament) throw new Error('tournament vanished mid-advance');
        return tournament;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async pauseTournament(tournamentId) {
      const result = await pool.query(
        `update public.tournaments
         set status = 'paused', paused_until = now() + interval '2 days'
         where id = $1 and status = 'active'
         returning id`,
        [tournamentId],
      );
      if (result.rows.length === 0) {
        throw new TournamentError('tournament_not_active', 'That tournament is not running.');
      }
      const tournament = await loadTournament(tournamentId);
      if (!tournament) throw new Error('tournament vanished after pause');
      return tournament;
    },

    async resumeTournament(tournamentId) {
      const result = await pool.query(
        `update public.tournaments
         set status = 'active', paused_until = null
         where id = $1 and status = 'paused' and (paused_until is null or paused_until > now())
         returning id`,
        [tournamentId],
      );
      if (result.rows.length === 0) {
        // Could be expired or not paused at all
        const check = await pool.query(
          `select status, paused_until from public.tournaments where id = $1`,
          [tournamentId],
        );
        if (check.rows.length === 0) {
          throw new TournamentError('tournament_not_found', 'That tournament does not exist.');
        }
        if (check.rows[0].status !== 'paused') {
          throw new TournamentError('tournament_not_paused', 'That tournament is not paused.');
        }
        throw new TournamentError('tournament_expired', 'That tournament has expired. Start a new one.');
      }
      const tournament = await loadTournament(tournamentId);
      if (!tournament) throw new Error('tournament vanished after resume');
      return tournament;
    },

    async abandonTournament(tournamentId) {
      // Not 'pending': an unanswered request is withdrawn through `cancelTournamentRequest`
      // instead, which is creator-only and leaves a distinct 'cancelled' status rather than
      // 'abandoned' — the two are different events even though both end a tournament early.
      await pool.query(
        `update public.tournaments
         set status = 'abandoned', ended_at = now(), paused_until = null
         where id = $1 and status in ('active', 'paused')`,
        [tournamentId],
      );
    },

    async abandonExpiredTournaments() {
      const result = await pool.query(
        `update public.tournaments
         set status = 'abandoned', ended_at = now(), paused_until = null
         where status = 'paused' and paused_until is not null and paused_until < now()`,
      );
      const count = result.rowCount ?? 0;
      if (count > 0) logger.info({ count }, 'abandoned expired paused tournaments');
      return count;
    },

    async pauseStrandedTournaments(runningIds) {
      const result = await pool.query(
        `update public.tournaments
         set status = 'paused', paused_until = now() + interval '2 days'
         where status = 'active' and not (id = any($1::uuid[]))`,
        [[...runningIds]],
      );
      return result.rowCount ?? 0;
    },
  };
}

/**
 * Resolve a tournament to a view from the reader's perspective.
 *
 * The a/b slot → you/partner mapping is the same one the dashboard uses, and it is done here
 * so neither the engine nor the play screen ever has to know which slot the viewer occupies.
 *
 * `userAId` is the couple's `user_a_id`, always available from the couple scope.
 */
export function tournamentViewForUser(
  tournament: Tournament,
  viewerId: string,
  userAId: string,
): TournamentView {
  const viewerIsA = viewerId === userAId;

  const currentGame = tournament.games.find((g) => g.status === 'active' || g.status === 'pending');
  const currentPosition = currentGame ? currentGame.position : tournament.games.length;

  let winner: 'you' | 'partner' | null = null;
  if (tournament.winnerUserId !== null) {
    winner = tournament.winnerUserId === viewerId ? 'you' : 'partner';
  }

  return {
    id: tournament.id,
    name: tournament.name,
    status: tournament.status,
    direction: tournament.createdByUserId === viewerId ? 'outgoing' : 'incoming',
    games: tournament.games.map((g): TournamentGameView => ({
      position: g.position,
      gameSlug: g.gameSlug,
      gameName: g.gameName,
      scored: g.scored,
      status: g.status,
      yourPoints: g.scored ? (viewerIsA ? g.pointsA : g.pointsB) : null,
      partnerPoints: g.scored ? (viewerIsA ? g.pointsB : g.pointsA) : null,
    })),
    currentPosition,
    yourTotalPoints: viewerIsA ? tournament.totalPointsA : tournament.totalPointsB,
    partnerTotalPoints: viewerIsA ? tournament.totalPointsB : tournament.totalPointsA,
    winner,
    pausedUntil: tournament.pausedUntil?.toISOString() ?? null,
    expiresAt: tournament.requestExpiresAt?.toISOString() ?? null,
  };
}
