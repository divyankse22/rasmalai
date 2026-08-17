import { logger } from '../../logger';
import type { MatchMode, PlayerScore, StatisticsRepository } from './statisticsRepository';

/**
 * The one thing the session registry knows about Postgres, and it is not much: two announcements
 * and a promise that they will be written down in order.
 *
 * The registry is synchronous from end to end — a move, a tick and a disconnect all resolve inside
 * one turn of the event loop, and making them await a database round trip would put the slowest
 * thing in the system on the path of the fastest. So recording is fire and forget: these methods
 * return nothing, never throw, and a failure is a log line rather than something two people
 * mid-game find out about.
 *
 * **Every write goes through one FIFO queue.** Two orderings have to hold — a match's completion
 * after its own insert, and one match's completion before the next match's insert, or the partial
 * unique index enforcing ADR-009 would refuse the rematch. A per-match queue gets the first and
 * loses the second. At this scale (a couple finishing a match every few minutes) a single chain
 * costs nothing measurable and cannot get either wrong.
 */

export interface MatchStartedInput {
  /** The registry's handle on this match. Never leaves the process; the row id lives in here. */
  matchKey: string;
  coupleId: string;
  gameSlug: string;
  mode: MatchMode;
  startedAt: Date;
  /** The series this match is one game of. Absent for individual play. */
  tournamentId?: string;
}

export type MatchOutcome =
  | {
      status: 'completed';
      players: [PlayerScore, PlayerScore];
      winnerUserId: string | null;
      byForfeit: boolean;
    }
  /** P-8: written down, shown for seven days, counted by nothing. */
  | { status: 'abandoned' };

export interface MatchEndedInput {
  matchKey: string;
  endedAt: Date;
  outcome: MatchOutcome;
}

export interface MatchRecorder {
  matchStarted(input: MatchStartedInput): void;
  matchEnded(input: MatchEndedInput): void;
  /**
   * Resolves once every queued write has landed.
   *
   * Shutdown closes every live session, which ends every live match — those writes are queued at
   * that moment and would be lost if the pool closed underneath them.
   */
  drain(): Promise<void>;
}

/** Used by every test that is not about recording, and by any deployment without a database. */
export const NULL_MATCH_RECORDER: MatchRecorder = {
  matchStarted() {},
  matchEnded() {},
  drain: () => Promise.resolve(),
};

export function createMatchRecorder(statistics: StatisticsRepository): MatchRecorder {
  /** Match key → the row that was inserted for it. Emptied as each match ends. */
  const rows = new Map<string, string>();
  let queue: Promise<void> = Promise.resolve();

  function enqueue(what: string, work: () => Promise<void>): void {
    queue = queue.then(work).catch((error: unknown) => {
      // Swallowed deliberately: an unrecorded match is a wrong number on a dashboard, and a broken
      // queue would be every wrong number after it.
      logger.error({ err: error, what }, 'failed to record a match');
    });
  }

  return {
    matchStarted(input) {
      enqueue('start', async () => {
        const started = await statistics.startMatch(input);
        if (started) rows.set(input.matchKey, started.matchId);
      });
    },

    matchEnded({ matchKey, endedAt, outcome }) {
      enqueue('end', async () => {
        const matchId = rows.get(matchKey);
        rows.delete(matchKey);
        // The insert failed, or this match was recorded as ended already. Either way there is no
        // row to move on, and inventing one would be worse than the missing number.
        if (!matchId) return;

        if (outcome.status === 'abandoned') {
          await statistics.abandonMatch(matchId, endedAt);
          return;
        }

        await statistics.completeMatch({
          matchId,
          endedAt,
          players: outcome.players,
          winnerUserId: outcome.winnerUserId,
          byForfeit: outcome.byForfeit,
        });
      });
    },

    drain() {
      return queue;
    },
  };
}
