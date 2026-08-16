import { logger } from '../../logger';
import type { StatisticsRepository } from '../statistics/statisticsRepository';

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
 */

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RetentionJob {
  stop(): void;
  /** One pass, now. Returns how many rows went. Exists so tests need not wait a day. */
  runOnce(): Promise<number>;
}

export function startRetentionJob(
  statistics: StatisticsRepository,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): RetentionJob {
  async function runOnce(): Promise<number> {
    const deleted = await statistics.deleteExpiredMatches();
    if (deleted > 0) logger.info({ deleted }, 'retention: removed expired match records');
    return deleted;
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
