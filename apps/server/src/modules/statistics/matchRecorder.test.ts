import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatchRecorder, type MatchRecorder } from './matchRecorder';
import type {
  CompleteMatchInput,
  StartMatchInput,
  StatisticsRepository,
} from './statisticsRepository';

/**
 * The recorder's whole job is ordering: the registry hands it announcements synchronously, and the
 * database has to receive them in the order they happened however slowly it answers.
 *
 * Two orderings matter, and the second is the one a per-match queue would lose: a rematch's insert
 * must land *after* the previous match's completion, or the partial unique index enforcing ADR-009
 * refuses it and the rematch goes unrecorded.
 */

const COUPLE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

interface Call {
  op: 'start' | 'complete' | 'abandon';
  matchId?: string;
}

let calls: Call[];
let completions: CompleteMatchInput[];
/** Held promises, so a slow database can be simulated exactly rather than approximately. */
let releaseStart: (() => void)[];
let failNextStart: boolean;
let recorder: MatchRecorder;

const started = (overrides: Partial<StartMatchInput> = {}): StartMatchInput => ({
  coupleId: COUPLE,
  gameSlug: 'four-in-a-row',
  mode: 'individual',
  startedAt: new Date('2026-08-16T12:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  calls = [];
  completions = [];
  releaseStart = [];
  failNextStart = false;

  let nextId = 1;

  const statistics: StatisticsRepository = {
    async startMatch() {
      calls.push({ op: 'start' });
      // Deliberately slow: every assertion below is about what happens while this is in flight.
      await new Promise<void>((resolve) => releaseStart.push(resolve));
      if (failNextStart) return null;
      return { matchId: `match-${nextId++}` };
    },
    async completeMatch(input) {
      calls.push({ op: 'complete', matchId: input.matchId });
      completions.push(input);
    },
    async abandonMatch(matchId) {
      calls.push({ op: 'abandon', matchId });
    },
    abandonOrphanedMatches: () => Promise.resolve(0),
    deleteExpiredMatches: () => Promise.resolve(0),
  };

  recorder = createMatchRecorder(statistics);
});

/**
 * Lets every queued insert answer, then waits for the queue to empty.
 *
 * A held insert only appears once the queue reaches it, so this alternates between letting the
 * event loop run and releasing whatever is now waiting, until the drain resolves.
 */
async function settle(): Promise<void> {
  let idle = false;
  const drained = recorder.drain().finally(() => {
    idle = true;
  });

  while (!idle) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseStart.shift()?.();
  }

  await drained;
}

function endedAsWon(matchKey: string): void {
  recorder.matchEnded({
    matchKey,
    endedAt: new Date('2026-08-16T12:05:00Z'),
    outcome: {
      status: 'completed',
      players: [
        { userId: ALICE, score: 1 },
        { userId: BOB, score: 0 },
      ],
      winnerUserId: ALICE,
      byForfeit: false,
    },
  });
}

describe('recording a match', () => {
  it('completes the row the insert created, and not before it exists', async () => {
    recorder.matchStarted({ matchKey: 'k1', ...started() });
    endedAsWon('k1');

    // The insert is in flight and has not answered. Nothing may be completed against a row that
    // does not exist yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual([{ op: 'start' }]);

    await settle();

    expect(calls).toEqual([{ op: 'start' }, { op: 'complete', matchId: 'match-1' }]);
    expect(completions[0]?.winnerUserId).toBe(ALICE);
    expect(completions[0]?.players).toEqual([
      { userId: ALICE, score: 1 },
      { userId: BOB, score: 0 },
    ]);
  });

  it('records an abandoned match without touching a single aggregate', async () => {
    recorder.matchStarted({ matchKey: 'k1', ...started() });
    recorder.matchEnded({
      matchKey: 'k1',
      endedAt: new Date('2026-08-16T12:02:00Z'),
      outcome: { status: 'abandoned' },
    });
    await settle();

    expect(calls).toEqual([{ op: 'start' }, { op: 'abandon', matchId: 'match-1' }]);
    expect(completions).toHaveLength(0);
  });

  it('puts a rematch behind the completion of the match it follows', async () => {
    recorder.matchStarted({ matchKey: 'k1', ...started() });
    endedAsWon('k1');
    recorder.matchStarted({ matchKey: 'k2', ...started() });
    endedAsWon('k2');

    await settle();

    // The order ADR-009's partial unique index requires: the first match must stop being `active`
    // before the second one may be inserted.
    expect(calls).toEqual([
      { op: 'start' },
      { op: 'complete', matchId: 'match-1' },
      { op: 'start' },
      { op: 'complete', matchId: 'match-2' },
    ]);
  });

  it('says nothing about a match whose insert failed', async () => {
    failNextStart = true;
    recorder.matchStarted({ matchKey: 'k1', ...started() });
    endedAsWon('k1');
    await settle();

    expect(calls).toEqual([{ op: 'start' }]);
  });

  it('ignores an ending for a match it never heard start', async () => {
    endedAsWon('never-started');
    await settle();

    expect(calls).toEqual([]);
  });

  it('records the same ending only once', async () => {
    recorder.matchStarted({ matchKey: 'k1', ...started() });
    endedAsWon('k1');
    endedAsWon('k1');
    await settle();

    expect(calls.filter((call) => call.op === 'complete')).toHaveLength(1);
  });
});

describe('when the database misbehaves', () => {
  it('keeps the queue alive after a failed write', async () => {
    const failing: StatisticsRepository = {
      startMatch: () => Promise.resolve({ matchId: 'match-1' }),
      completeMatch: () => Promise.reject(new Error('connection reset')),
      abandonMatch: () => Promise.resolve(),
      abandonOrphanedMatches: () => Promise.resolve(0),
      deleteExpiredMatches: () => Promise.resolve(0),
    };
    const seen: string[] = [];
    const spy = vi.spyOn(failing, 'startMatch');

    const local = createMatchRecorder(failing);
    local.matchStarted({ matchKey: 'k1', ...started() });
    local.matchEnded({
      matchKey: 'k1',
      endedAt: new Date(),
      outcome: {
        status: 'completed',
        players: [
          { userId: ALICE, score: 1 },
          { userId: BOB, score: 0 },
        ],
        winnerUserId: ALICE,
        byForfeit: false,
      },
    });
    local.matchStarted({ matchKey: 'k2', ...started() });

    // A rejected write must not throw at the caller — the registry is mid-game and cannot care.
    await expect(local.drain()).resolves.toBeUndefined();
    seen.push(...spy.mock.calls.map(() => 'start'));
    expect(seen).toHaveLength(2);
  });
});

describe('draining', () => {
  it('waits for work queued right before shutdown', async () => {
    recorder.matchStarted({ matchKey: 'k1', ...started() });
    endedAsWon('k1');

    let finished = false;
    const drained = recorder.drain().then(() => {
      finished = true;
    });

    // Nothing has reached the database yet, and shutdown is waiting for it.
    expect(finished).toBe(false);
    await settle();
    await drained;

    expect(finished).toBe(true);
    expect(calls).toContainEqual({ op: 'complete', matchId: 'match-1' });
  });
});
