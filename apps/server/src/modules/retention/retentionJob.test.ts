import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatisticsRepository } from '../statistics/statisticsRepository';
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
let deleted: number;
let failNext: boolean;
let statistics: StatisticsRepository;

beforeEach(() => {
  vi.useFakeTimers();
  sweeps = 0;
  deleted = 3;
  failNext = false;

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
    const job = startRetentionJob(statistics, 60_000);

    expect(sweeps).toBe(1);
    job.stop();
  });

  it('keeps sweeping on its interval', async () => {
    const job = startRetentionJob(statistics, 60_000);

    await vi.advanceTimersByTimeAsync(180_000);

    expect(sweeps).toBe(4);
    job.stop();
  });

  it('stops when it is told to', async () => {
    const job = startRetentionJob(statistics, 60_000);
    job.stop();

    await vi.advanceTimersByTimeAsync(300_000);

    expect(sweeps).toBe(1);
  });

  it('survives a failed sweep and collects the same rows next time', async () => {
    failNext = true;
    const job = startRetentionJob(statistics, 60_000);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(sweeps).toBe(2);
    job.stop();
  });

  it('reports what it removed when asked to run directly', async () => {
    const job = startRetentionJob(statistics, 60_000);

    await expect(job.runOnce()).resolves.toBe(3);
    job.stop();
  });
});
