import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { EVENTS } from '@rasmalai/shared';
import type { TokenVerifier } from '../../auth/tokenVerifier';
import { logger } from '../../logger';
import {
  PairingError,
  type PairingRepository,
} from '../../modules/pairing/pairingRepository';
import { normalisePairingCode } from '../../modules/users/pairingCode';
import type { RealtimeNotifier } from '../../ws/notifier';
import { rateLimit } from '../rateLimit';
import { requireUser } from '../requireUser';

const requestBody = z.object({ code: z.string().min(1).max(32) });
const respondBody = z.object({ accept: z.boolean() });

/** Which pairing failures are the caller's fault, and what status each deserves. */
const STATUS_BY_CODE: Record<string, number> = {
  code_not_found: 404,
  cannot_pair_with_self: 400,
  already_paired: 409,
  partner_already_paired: 409,
  request_already_pending: 409,
  request_incoming_pending: 409,
  request_not_found: 404,
  request_not_pending: 409,
};

export function createPairingRouter(
  verifier: TokenVerifier,
  pairing: PairingRepository,
  realtime: RealtimeNotifier,
): Router {
  const router = Router();
  router.use(requireUser(verifier));

  router.get('/pairing', async (req: Request, res: Response) => {
    res.json(await pairing.getState(req.userId!));
  });

  router.post(
    '/pairing/requests',
    // A code is 8 characters from a 32-character alphabet; this makes grinding it pointless.
    rateLimit({ limit: 10, windowMs: 10 * 60 * 1000 }),
    async (req: Request, res: Response) => {
      const parsed = requestBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'invalid_payload', message: 'Enter the code they shared with you.' },
        });
        return;
      }

      const userId = req.userId!;
      try {
        const request = await pairing.requestByCode(userId, normalisePairingCode(parsed.data.code));

        // Both parties, so a second device belonging to either one stays in step.
        realtime.sendToUsers([request.otherUser.id, userId], EVENTS.pairing.requestCreated, {
          requestId: request.id,
        });
        logger.info({ userId }, 'pairing request created');

        res.status(201).json({ request });
      } catch (error) {
        if (error instanceof PairingError) {
          res.status(STATUS_BY_CODE[error.code] ?? 400).json({
            error: { code: 'invalid_action', reason: error.code, message: error.message },
          });
          return;
        }
        throw error;
      }
    },
  );

  router.post('/pairing/requests/:id/cancel', async (req: Request, res: Response) => {
    const userId = req.userId!;
    const requestId = req.params.id;
    if (typeof requestId !== 'string') {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Unknown request.' } });
      return;
    }

    try {
      const { state, otherUserId } = await pairing.cancel(userId, requestId);

      // Clear it off their screen at once, rather than leaving them holding a request that has
      // already been withdrawn.
      realtime.sendToUsers([otherUserId, userId], EVENTS.pairing.requestCancelled, { requestId });
      logger.info({ userId }, 'pairing request cancelled');

      res.json(state);
    } catch (error) {
      if (error instanceof PairingError) {
        res.status(STATUS_BY_CODE[error.code] ?? 400).json({
          error: { code: 'invalid_action', reason: error.code, message: error.message },
        });
        return;
      }
      throw error;
    }
  });

  router.post('/pairing/requests/:id/respond', async (req: Request, res: Response) => {
    const parsed = respondBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Accept or reject?' } });
      return;
    }

    const userId = req.userId!;
    // Express types a route param as possibly repeated. Coercing would turn ['a','b'] into "a,b"
    // and quietly look up nonsense, so an unexpected shape is rejected outright.
    const requestId = req.params.id;
    if (typeof requestId !== 'string') {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Unknown request.' } });
      return;
    }

    try {
      const { state, otherUserId, accepted } = await pairing.respond(
        userId,
        requestId,
        parsed.data.accept,
      );

      // Tell the requester either way, so nobody sits watching a stale screen.
      // Sent to both, so the answer lands on every screen either of them has open - not just on
      // the other person's.
      if (accepted) {
        realtime.sendToUsers([otherUserId, userId], EVENTS.pairing.requestAccepted, {
          coupleId: state.couple?.id,
        });
        logger.info({ userId }, 'pairing accepted');
      } else {
        realtime.sendToUsers([otherUserId, userId], EVENTS.pairing.requestRejected, { requestId });
      }

      res.json(state);
    } catch (error) {
      if (error instanceof PairingError) {
        res.status(STATUS_BY_CODE[error.code] ?? 400).json({
          error: { code: 'invalid_action', reason: error.code, message: error.message },
        });
        return;
      }
      throw error;
    }
  });

  return router;
}
