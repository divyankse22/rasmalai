import { EVENTS } from '@rasmalai/shared';
import { logger } from '../../logger';
import type { RealtimeNotifier } from '../../ws/notifier';
import type { InvitationsRepository } from './invitationsRepository';

/** How often to look for invitations whose five minutes are up. */
const DEFAULT_INTERVAL_MS = 20_000;

export interface Sweeper {
  stop(): void;
  /** Runs one pass immediately. Exists so tests do not have to wait for a timer. */
  runOnce(): Promise<number>;
}

/**
 * Closes invitations that have run out, and tells both partners.
 *
 * This is only half of expiry, and the less important half: **every read already treats a past
 * `expires_at` as expired**, because an in-process timer dies with the process and a restarted
 * backend would otherwise serve invitations that expired while it was down. The sweeper exists so
 * the two of them see the invitation disappear on its own rather than the next time something
 * happens to refresh, and so the rows stop claiming to be pending.
 */
export function startInvitationSweeper(
  invitations: InvitationsRepository,
  realtime: RealtimeNotifier,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Sweeper {
  async function runOnce(): Promise<number> {
    const closed = await invitations.sweepExpired();

    for (const invitation of closed) {
      realtime.sendToUsers(invitation.userIds, EVENTS.invitation.expired, {
        invitationId: invitation.id,
      });
    }

    if (closed.length > 0) logger.debug({ count: closed.length }, 'expired invitations');
    return closed.length;
  }

  const timer = setInterval(() => {
    // A database blip must not take the process down, and the next pass will catch whatever this
    // one missed — the rows are still there and still overdue.
    void runOnce().catch((error: unknown) => {
      logger.warn({ err: error }, 'invitation sweep failed');
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
