import { EVENTS } from '@rasmalai/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingNotifier, OTHER_USER_ID, TEST_USER_ID } from '../../http/testing';
import type { InvitationsRepository } from './invitationsRepository';
import { startInvitationSweeper } from './expirySweeper';

type Closed = Awaited<ReturnType<InvitationsRepository['sweepExpired']>>;

/**
 * Captured before any test installs fake timers, which replace the global. Node emits
 * `unhandledRejection` on a real turn of the event loop, so waiting for one needs a real timer.
 */
const realSetImmediate = setImmediate;
const flushEventLoop = () => new Promise((resolve) => realSetImmediate(resolve));

/**
 * A repository that only knows how to be swept. Every other method throws, so a test that
 * accidentally exercises one fails loudly instead of quietly passing against a stub.
 */
function sweepOnlyRepository() {
  let next: Closed = [];
  let failure: Error | null = null;
  let calls = 0;

  const repository = new Proxy(
    {
      async sweepExpired(): Promise<Closed> {
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
  ) as unknown as InvitationsRepository;

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

const INVITATION: Closed[number] = {
  id: '44444444-4444-4444-4444-444444444444',
  coupleId: '33333333-3333-3333-3333-333333333333',
  userIds: [TEST_USER_ID, OTHER_USER_ID],
};

let invitations: ReturnType<typeof sweepOnlyRepository>;
let realtime: ReturnType<typeof createRecordingNotifier>;
let sweeper: ReturnType<typeof startInvitationSweeper> | null;

beforeEach(() => {
  invitations = sweepOnlyRepository();
  realtime = createRecordingNotifier();
  sweeper = null;
  vi.useFakeTimers();
});

afterEach(() => {
  sweeper?.stop();
  vi.useRealTimers();
});

describe('sweeping invitations whose five minutes are up', () => {
  it('tells both partners about each invitation it closed', async () => {
    invitations.closes([INVITATION]);
    sweeper = startInvitationSweeper(invitations.repository, realtime);

    expect(await sweeper.runOnce()).toBe(1);
    expect(realtime.recipientsOf(EVENTS.invitation.expired).sort()).toEqual(
      [TEST_USER_ID, OTHER_USER_ID].sort(),
    );
    // The id is what lets a client clear the right thing off screen.
    expect(realtime.sent[0]?.payload).toEqual({ invitationId: INVITATION.id });
  });

  it('says nothing at all when there was nothing overdue', async () => {
    sweeper = startInvitationSweeper(invitations.repository, realtime);

    expect(await sweeper.runOnce()).toBe(0);
    expect(realtime.sent).toEqual([]);
  });

  it('tells both partners separately about each of several invitations', async () => {
    const second = { ...INVITATION, id: 'second-invitation' };
    invitations.closes([INVITATION, second]);
    sweeper = startInvitationSweeper(invitations.repository, realtime);

    expect(await sweeper.runOnce()).toBe(2);
    expect(realtime.recipientsOf(EVENTS.invitation.expired)).toHaveLength(4);
    expect(
      realtime.sent.map((event) => (event.payload as { invitationId: string }).invitationId),
    ).toEqual([INVITATION.id, INVITATION.id, second.id, second.id]);
  });

  it('sweeps again on its own, without anybody asking', async () => {
    sweeper = startInvitationSweeper(invitations.repository, realtime, 1_000);

    expect(invitations.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invitations.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(invitations.calls).toBe(3);
  });

  it('stops sweeping once it is stopped', async () => {
    sweeper = startInvitationSweeper(invitations.repository, realtime, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(invitations.calls).toBe(1);

    sweeper.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(invitations.calls).toBe(1);
  });

  /**
   * The one that matters. The sweep runs on a bare `setInterval` with nobody awaiting it, so a
   * rejected query with no `.catch` is an unhandled rejection — and Node kills the process for
   * those by default. A backend that dies because Postgres hiccuped mid-sweep would take the
   * couple's live game down with it.
   */
  it('survives a database failure instead of taking the process down', async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);

    try {
      invitations.failsWith(new Error('connection reset'));
      sweeper = startInvitationSweeper(invitations.repository, realtime, 1_000);

      await vi.advanceTimersByTimeAsync(1_000);
      // Let any rejection that escaped the sweeper reach the process.
      await flushEventLoop();

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  it('keeps sweeping after a failed pass, and reports the next one honestly', async () => {
    invitations.failsWith(new Error('connection reset'));
    sweeper = startInvitationSweeper(invitations.repository, realtime, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(invitations.calls).toBe(1);
    expect(realtime.sent).toEqual([]);

    // The rows are still there and still overdue, so the next pass catches what this one missed.
    invitations.failsWith(null);
    invitations.closes([INVITATION]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(invitations.calls).toBe(2);
    expect(realtime.recipientsOf(EVENTS.invitation.expired)).toHaveLength(2);
  });

  it('lets a caller await one pass and see the error, unlike the timer', async () => {
    invitations.failsWith(new Error('connection reset'));
    sweeper = startInvitationSweeper(invitations.repository, realtime);

    // `runOnce` is the tested entry point and does not swallow — only the timer's wrapper does.
    await expect(sweeper.runOnce()).rejects.toThrow('connection reset');
  });

  it('is never the reason the process stays alive', () => {
    const unref = vi.spyOn(globalThis, 'setInterval');
    sweeper = startInvitationSweeper(invitations.repository, realtime, 1_000);

    const timer = unref.mock.results[0]?.value as { hasRef?: () => boolean };
    expect(timer.hasRef?.()).toBe(false);
    unref.mockRestore();
  });
});
