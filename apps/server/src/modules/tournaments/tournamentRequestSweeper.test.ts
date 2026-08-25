import { EVENTS, type TournamentView } from '@rasmalai/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRecordingNotifier,
  OTHER_USER_ID,
  TEST_USER_ID,
  testTournamentRequest,
} from '../../http/testing';
import type { TournamentRepository } from './tournamentRepository';
import { startTournamentRequestSweeper } from './tournamentRequestSweeper';

type Closed = Awaited<ReturnType<TournamentRepository['sweepExpiredTournamentRequests']>>;

/** Captured before fake timers replace the global — see the crash test at the bottom. */
const realSetImmediate = setImmediate;
const flushEventLoop = () => new Promise((resolve) => realSetImmediate(resolve));

/** Only knows how to be swept; anything else the sweeper touches is a bug, so it throws. */
function sweepOnlyRepository() {
  let next: Closed = [];
  let failure: Error | null = null;
  let calls = 0;

  const repository = new Proxy(
    {
      async sweepExpiredTournamentRequests(): Promise<Closed> {
        calls += 1;
        if (failure) throw failure;
        return next;
      },
    },
    {
      get(target, property, receiver) {
        if (property in target) return Reflect.get(target, property, receiver);
        throw new Error(`the sweeper reached for ${String(property)}, which it should not need`);
      },
    },
  ) as unknown as TournamentRepository;

  return {
    repository,
    closes: (value: Closed) => {
      next = value;
    },
    failsWith: (error: Error | null) => {
      failure = error;
    },
    get calls() {
      return calls;
    },
  };
}

function expiredRequest(overrides = {}): Closed[number] {
  return {
    tournament: testTournamentRequest(overrides),
    userAId: TEST_USER_ID,
    userIds: [TEST_USER_ID, OTHER_USER_ID],
  };
}

let tournaments: ReturnType<typeof sweepOnlyRepository>;
let realtime: ReturnType<typeof createRecordingNotifier>;
let sweeper: ReturnType<typeof startTournamentRequestSweeper> | null;

beforeEach(() => {
  tournaments = sweepOnlyRepository();
  realtime = createRecordingNotifier();
  sweeper = null;
  vi.useFakeTimers();
});

afterEach(() => {
  sweeper?.stop();
  vi.useRealTimers();
});

describe('sweeping tournament requests whose five minutes are up', () => {
  it('tells both partners, as an ordinary tournament update', async () => {
    tournaments.closes([expiredRequest()]);
    sweeper = startTournamentRequestSweeper(tournaments.repository, realtime);

    expect(await sweeper.runOnce()).toBe(1);
    // Deliberately the same event a decline or a cancel produces: a client that can already clear
    // a tournament off screen needs nothing new for expiry.
    expect(realtime.recipientsOf(EVENTS.results.tournamentUpdated).sort()).toEqual(
      [TEST_USER_ID, OTHER_USER_ID].sort(),
    );
  });

  /**
   * The reason this sweeper sends per user rather than using `sendToUsers`: the payload is a
   * *view*, and a view is built from the reader's side of the couple. Sending one shared frame
   * would show one of them the other's half of the scoreboard.
   */
  it('builds each partner their own view rather than sharing one frame', async () => {
    tournaments.closes([
      expiredRequest({ totalPointsA: 6, totalPointsB: 1, winnerUserId: TEST_USER_ID }),
    ]);
    sweeper = startTournamentRequestSweeper(tournaments.repository, realtime);
    await sweeper.runOnce();

    const viewFor = (userId: string) =>
      (
        realtime.sent.find((event) => event.userId === userId)?.payload as {
          tournament: TournamentView;
        }
      ).tournament;

    expect(viewFor(TEST_USER_ID).winner).toBe('you');
    expect(viewFor(OTHER_USER_ID).winner).toBe('partner');
    // A is user A, so A's "yours" is B's "partner's" — the two frames are genuinely different.
    expect(viewFor(TEST_USER_ID).yourTotalPoints).toBe(6);
    expect(viewFor(OTHER_USER_ID).yourTotalPoints).toBe(1);
    expect(viewFor(TEST_USER_ID).partnerTotalPoints).toBe(1);
    expect(viewFor(OTHER_USER_ID).partnerTotalPoints).toBe(6);
    // And the request reads as sent by one of them and received by the other.
    expect(viewFor(TEST_USER_ID).direction).toBe('outgoing');
    expect(viewFor(OTHER_USER_ID).direction).toBe('incoming');
  });

  it('says nothing at all when nothing was overdue', async () => {
    sweeper = startTournamentRequestSweeper(tournaments.repository, realtime);

    expect(await sweeper.runOnce()).toBe(0);
    expect(realtime.sent).toEqual([]);
  });

  it('sweeps again on its own, and stops when told', async () => {
    sweeper = startTournamentRequestSweeper(tournaments.repository, realtime, 1_000);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(tournaments.calls).toBe(2);

    sweeper.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tournaments.calls).toBe(2);
  });

  it('survives a database failure instead of taking the process down', async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);

    try {
      tournaments.failsWith(new Error('connection reset'));
      sweeper = startTournamentRequestSweeper(tournaments.repository, realtime, 1_000);

      await vi.advanceTimersByTimeAsync(1_000);
      await flushEventLoop();

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  it('keeps sweeping after a failed pass', async () => {
    tournaments.failsWith(new Error('connection reset'));
    sweeper = startTournamentRequestSweeper(tournaments.repository, realtime, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(realtime.sent).toEqual([]);

    tournaments.failsWith(null);
    tournaments.closes([expiredRequest()]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(realtime.recipientsOf(EVENTS.results.tournamentUpdated)).toHaveLength(2);
  });

  it('is never the reason the process stays alive', () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    sweeper = startTournamentRequestSweeper(tournaments.repository, realtime, 1_000);

    const timer = intervals.mock.results[0]?.value as { hasRef?: () => boolean };
    expect(timer.hasRef?.()).toBe(false);
    intervals.mockRestore();
  });
});
