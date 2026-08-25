import { logger } from '../../logger';
import type { StatisticsRepository } from '../statistics/statisticsRepository';
import type { TournamentRepository } from '../tournaments/tournamentRepository';

/**
 * The seven-day retention job (ADR-008, T-7).
 *
 * Raw match rows exist for seven days and then go. The aggregates they fed were written at the
 * moment each match ended (P-5), so this deletes history without losing a single statistic — which
 * is the whole reason the snapshot rule exists.
 *
 * A daily in-process interval rather than `pg_cron` or a scheduler: one backend process, one
 * database, and a job whose entire body is a `delete`. Nothing here justifies infrastructure
 * (`skills/architecture-review.skill.md`).
 *
 * It also runs **once at startup**, which is what makes a backend that was down for a week catch up
 * the moment it comes back rather than at the next midnight it happens to be awake for.
 *
 * Slice 9 gives it a second errand on the same schedule: a tournament paused more than 48 hours ago
 * is over (D-5). Same shape of problem, same daily pass, and no reason for a second timer.
 */

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RetentionSweep {
  /** Expired `matches` rows removed (ADR-008). */
  matchesDeleted: number;
  /** Paused tournaments past their 48 hours, abandoned (D-5). */
  tournamentsAbandoned: number;
}

export interface RetentionJob {
  stop(): void;
  /** One pass, now. Returns what it collected. Exists so tests need not wait a day. */
  runOnce(): Promise<RetentionSweep>;
}

export function startRetentionJob(
  statistics: StatisticsRepository,
  /**
   * Absent for a deployment or a test with no tournaments — the match sweep is the older job and
   * has no business failing because the newer one is not wired up.
   */
  tournaments?: TournamentRepository,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): RetentionJob {
  async function runOnce(): Promise<RetentionSweep> {
    const matchesDeleted = await statistics.deleteExpiredMatches();
    if (matchesDeleted > 0) {
      logger.info({ deleted: matchesDeleted }, 'retention: removed expired match records');
    }

    const tournamentsAbandoned = (await tournaments?.abandonExpiredTournaments()) ?? 0;
    return { matchesDeleted, tournamentsAbandoned };
  }

  function runSafely(): void {
    // A database blip must not take the process down. The rows are still there and still overdue,
    // so the next pass collects them.
    void runOnce().catch((error: unknown) => {
      logger.warn({ err: error }, 'retention sweep failed');
    });
  }

  runSafely();

  const timer = setInterval(runSafely, intervalMs);
  // Never the reason the process stays alive.
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
    runOnce,
  };
}
