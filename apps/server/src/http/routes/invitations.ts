import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { EVENTS, type InvitationView } from '@rasmalai/shared';
import type { TokenVerifier } from '../../auth/tokenVerifier';
import { logger } from '../../logger';
import {
  InvitationError,
  type InvitationsRepository,
} from '../../modules/invitations/invitationsRepository';
import type { PairingRepository } from '../../modules/pairing/pairingRepository';
import {
  SessionError,
  type PresenceSource,
  type SessionRegistry,
} from '../../modules/sessions/sessionRegistry';
import type { UsersRepository } from '../../modules/users/usersRepository';
import type { RealtimeNotifier } from '../../ws/notifier';
import { rateLimit } from '../rateLimit';
import { requireUser } from '../requireUser';

const createBody = z.object({ gameSlug: z.string().min(1).max(40) });
const respondBody = z.object({
  accept: z.boolean(),
  // P-7: a decline may propose something else instead.
  counterGameSlug: z.string().min(1).max(40).optional(),
});

/** Which failures are the caller's fault, and what each deserves. */
const STATUS_BY_CODE: Record<string, number> = {
  not_paired: 409,
  game_not_found: 404,
  game_not_playable: 409,
  invitation_not_found: 404,
  invitation_not_pending: 409,
  // Gone, rather than a generic conflict: the invitation was real and its moment has passed.
  invitation_expired: 410,
  cannot_answer_own: 403,
  not_your_invitation: 403,
  already_in_game: 409,
  session_not_found: 404,
  not_authorized: 403,
  invalid_game_state: 409,
  partner_offline: 409,
};

function failed(error: unknown, res: Response): boolean {
  if (!(error instanceof InvitationError) && !(error instanceof SessionError)) return false;

  res.status(STATUS_BY_CODE[error.code] ?? 400).json({
    error: { code: 'invalid_action', reason: error.code, message: error.message },
  });
  return true;
}

export function createInvitationsRouter(
  verifier: TokenVerifier,
  invitations: InvitationsRepository,
  sessions: SessionRegistry,
  users: UsersRepository,
  realtime: RealtimeNotifier,
  pairing: PairingRepository,
  presence: PresenceSource,
): Router {
  const router = Router();
  router.use(requireUser(verifier));

  /**
   * Sends the same invitation to both partners, each rendered from their own side.
   *
   * Both, not just the recipient: either of them may be signed in on two devices, and a screen
   * showing an invitation that has already been answered elsewhere is the bug pairing had.
   */
  async function announce(
    type: string,
    invitationId: string,
    userIds: readonly string[],
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    for (const userId of new Set(userIds)) {
      const view = await invitations.viewFor(invitationId, userId);
      realtime.sendToUser(userId, type, { invitation: view, ...extra });
    }
  }

  router.get('/invitations', async (req: Request, res: Response) => {
    const userId = req.userId!;
    res.json({
      active: await invitations.activeFor(userId),
      // A reload while a game is running lands back in the game rather than on the dashboard.
      activeSessionId: sessions.sessionIdForUser(userId),
    });
  });

  router.post(
    '/invitations',
    // Enough to play, not enough to pester. One invitation replaces the last anyway.
    rateLimit({ limit: 20, windowMs: 5 * 60 * 1000 }),
    async (req: Request, res: Response) => {
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'invalid_payload', message: 'Pick a game first.' },
        });
        return;
      }

      const userId = req.userId!;
      try {
        // ADR-009. The registry is in memory, so the database cannot know about a live session;
        // this is the only place the two facts meet.
        if (sessions.sessionIdForUser(userId)) {
          throw new SessionError('already_in_game', 'You two already have a game going.');
        }

        // An invitation to somebody who is not signed in is five minutes of waiting for a sheet
        // nobody will ever see. Refused here rather than only in the browser, because a check the
        // client makes for itself is a check that can be skipped — and the invitation it creates is
        // real, holds the couple's one slot (ADR-010), and has to expire on its own.
        const partner = await pairing.findPartner(userId);
        if (partner !== null && !presence.isOnline(partner.id)) {
          throw new SessionError(
            'partner_offline',
            'They are offline. Try when they are online next time.',
          );
        }

        const { invitation, otherUserId, invalidatedId } = await invitations.create(
          userId,
          parsed.data.gameSlug,
        );

        // The displaced invitation is closed first, so nobody sees two live at once.
        if (invalidatedId) {
          realtime.sendToUsers([userId, otherUserId], EVENTS.invitation.invalidated, {
            invitationId: invalidatedId,
          });
        }
        await announce(EVENTS.invitation.created, invitation.id, [userId, otherUserId]);
        logger.info({ userId, gameSlug: parsed.data.gameSlug }, 'invitation created');

        res.status(201).json({ invitation });
      } catch (error) {
        if (failed(error, res)) return;
        throw error;
      }
    },
  );

  router.post('/invitations/:id/respond', async (req: Request, res: Response) => {
    const parsed = respondBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Play, or not now?' } });
      return;
    }

    // Express types a route param as possibly repeated; coercing would look up nonsense.
    const invitationId = req.params.id;
    if (typeof invitationId !== 'string') {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Unknown invitation.' } });
      return;
    }

    const userId = req.userId!;
    try {
      const result = await invitations.respond(
        userId,
        invitationId,
        parsed.data.accept,
        parsed.data.counterGameSlug,
      );

      if (!result.accepted) {
        const counter: InvitationView | null = result.counterInvitation;

        realtime.sendToUsers([userId, result.otherUserId], EVENTS.invitation.rejected, {
          invitationId,
          counterInvitation: null,
        });

        if (counter) {
          // The counter is a real invitation in its own right, so it is announced as one — each
          // side sees it pointing the correct way. Separate from the rejection, so a client that
          // only understands one of the two events still behaves correctly.
          await announce(EVENTS.invitation.created, counter.id, [userId, result.otherUserId]);
        }

        // Already rendered for this reader by the repository; re-reading it would be a second
        // query for a view we are holding.
        res.json({ accepted: false, counterInvitation: counter });
        return;
      }

      // Both profiles, so the lobby can show two real people rather than two ids.
      const [me, partner] = await Promise.all([
        users.findById(userId),
        users.findById(result.otherUserId),
      ]);
      if (!me || !partner) {
        throw new InvitationError('invitation_not_found', 'That invitation is gone.');
      }

      const session = sessions.create({
        coupleId: result.coupleId,
        gameSlug: result.gameSlug,
        gameName: result.gameName,
        players: [
          { userId: me.id, nickname: me.nickname, avatarKey: me.avatarKey, gender: me.gender },
          {
            userId: partner.id,
            nickname: partner.nickname,
            avatarKey: partner.avatarKey,
            gender: partner.gender,
          },
        ],
      });

      // Both navigate to the same place off the back of this.
      realtime.sendToUsers([userId, result.otherUserId], EVENTS.invitation.accepted, {
        invitationId,
        sessionId: session.id,
      });
      logger.info({ userId, sessionId: session.id }, 'invitation accepted, session opened');

      res.json({ accepted: true, sessionId: session.id });
    } catch (error) {
      if (failed(error, res)) return;
      throw error;
    }
  });

  router.post('/invitations/:id/cancel', async (req: Request, res: Response) => {
    const invitationId = req.params.id;
    if (typeof invitationId !== 'string') {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Unknown invitation.' } });
      return;
    }

    const userId = req.userId!;
    try {
      const { otherUserId } = await invitations.cancel(userId, invitationId);
      realtime.sendToUsers([userId, otherUserId], EVENTS.invitation.cancelled, { invitationId });
      res.json({ cancelled: true });
    } catch (error) {
      if (failed(error, res)) return;
      throw error;
    }
  });

  return router;
}
