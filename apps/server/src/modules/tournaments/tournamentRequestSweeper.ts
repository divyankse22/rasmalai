import { EVENTS } from '@rasmalai/shared';
import { logger } from '../../logger';
import type { RealtimeNotifier } from '../../ws/notifier';
import { tournamentViewForUser, type TournamentRepository } from './tournamentRepository';

/** How often to look for tournament requests whose five minutes are up. */
const DEFAULT_INTERVAL_MS = 20_000;

export interface Sweeper {
  stop(): void;
  /** Runs one pass immediately. Exists so tests do not have to wait for a timer. */
  runOnce(): Promise<number>;
}

/**
 * Closes tournament requests that have run out, and tells both partners.
 *
 * The same shape as `startInvitationSweeper`, and for the same reason: this is only half of expiry
 * — every read already treats a past `request_expires_at` as expired, because an in-process timer
 * dies with the process. The sweeper exists so the two of them see the request disappear on its own
 * rather than the next time something happens to refresh, and so the row stops claiming to be
 * pending.
 *
 * Sent as an ordinary `tournament.updated`, the same event a decline or a cancel produces — a client
 * that already knows how to clear a tournament off screen for those needs nothing new for this one.
 */
export function startTournamentRequestSweeper(
  tournaments: TournamentRepository,
  realtime: RealtimeNotifier,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Sweeper {
  async function runOnce(): Promise<number> {
    const closed = await tournaments.sweepExpiredTournamentRequests();

    for (const { tournament, userAId, userIds } of closed) {
      for (const userId of userIds) {
        realtime.sendToUser(userId, EVENTS.results.tournamentUpdated, {
          tournament: tournamentViewForUser(tournament, userId, userAId),
        });
      }
    }

    return closed.length;
  }

  const timer = setInterval(() => {
    // A database blip must not take the process down, and the next pass will catch whatever this
    // one missed — the row is still there and still overdue.
    void runOnce().catch((error: unknown) => {
      logger.warn({ err: error }, 'tournament request sweep failed');
    });
  }, intervalMs);

  // Never the reason the process stays alive.
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
    runOnce,
  };
}
