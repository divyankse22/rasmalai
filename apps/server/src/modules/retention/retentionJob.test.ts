import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatisticsRepository } from '../statistics/statisticsRepository';
import type { TournamentRepository } from '../tournaments/tournamentRepository';
import { startRetentionJob } from './retentionJob';

/**
 * ADR-008's daily sweep. The deletion itself is one `delete` statement, so what is worth testing is
 * the scheduling around it: that it runs immediately rather than waiting a day, that it keeps
 * running afterwards, and that a database blip does not silently end it.
 *
 * That the deletion is lossless for statistics is a property of the *data*, not of this file — it is
 * proved against real Postgres, by expiring a match and reading the aggregates back afterwards.
 */

let sweeps: number;
let tournamentSweeps: number;
let deleted: number;
let failNext: boolean;
let statistics: StatisticsRepository;
let tournaments: TournamentRepository;

beforeEach(() => {
  vi.useFakeTimers();
  sweeps = 0;
  tournamentSweeps = 0;
  deleted = 3;
  failNext = false;

  // Only the sweep is reachable from here; the rest of the repository belongs to the engine's tests.
  tournaments = {
    abandonExpiredTournaments: () => {
      tournamentSweeps += 1;
      return Promise.resolve(2);
    },
  } as unknown as TournamentRepository;

  statistics = {
    startMatch: () => Promise.resolve(null),
    completeMatch: () => Promise.resolve(),
    abandonMatch: () => Promise.resolve(),
    abandonOrphanedMatches: () => Promise.resolve(0),
    deleteExpiredMatches: () => {
      sweeps += 1;
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error('connection reset'));
      }
      return Promise.resolve(deleted);
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the retention job', () => {
  it('sweeps once on startup, so a backend that was down catches up immediately', () => {
    const job = startRetentionJob(statistics, tournaments, 60_000);

    expect(sweeps).toBe(1);
    job.stop();
  });

  it('keeps sweeping on its interval', async () => {
    const job = startRetentionJob(statistics, tournaments, 60_000);

    await vi.advanceTimersByTimeAsync(180_000);

    expect(sweeps).toBe(4);
    job.stop();
  });

  it('stops when it is told to', async () => {
    const job = startRetentionJob(statistics, tournaments, 60_000);
    job.stop();

    await vi.advanceTimersByTimeAsync(300_000);

    expect(sweeps).toBe(1);
  });

  it('survives a failed sweep and collects the same rows next time', async () => {
    failNext = true;
    const job = startRetentionJob(statistics, tournaments, 60_000);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(sweeps).toBe(2);
    job.stop();
  });

  it('reports what it removed when asked to run directly', async () => {
    const job = startRetentionJob(statistics, tournaments, 60_000);

    await expect(job.runOnce()).resolves.toEqual({
      matchesDeleted: 3,
      tournamentsAbandoned: 2,
    });
    job.stop();
  });

  it('sweeps tournaments paused longer than their 48 hours (D-5) on the same pass', async () => {
    const job = startRetentionJob(statistics, tournaments, 60_000);

    await vi.advanceTimersByTimeAsync(120_000);

    // Once at startup and once per interval, in lockstep with the match sweep — a paused series is
    // exactly as overdue as an expired match row, and there is no reason for a second timer.
    expect(tournamentSweeps).toBe(3);
    expect(sweeps).toBe(3);
    job.stop();
  });

  it('runs the match sweep even with no tournaments wired up', async () => {
    const job = startRetentionJob(statistics, undefined, 60_000);

    await expect(job.runOnce()).resolves.toEqual({
      matchesDeleted: 3,
      tournamentsAbandoned: 0,
    });
    job.stop();
  });
});
