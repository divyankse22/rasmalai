import { Router, type Request, type RequestHandler, type Response } from 'express';
import { EVENTS } from '@rasmalai/shared';
import type { TokenVerifier } from '../../auth/tokenVerifier';
import { logger } from '../../logger';
import { generatePairingCode, normalisePairingCode } from '../../modules/users/pairingCode';
import { onboardingSchema } from '../../modules/users/user.schema';
import {
  OnboardingPairingError,
  PairingCodeTakenError,
  ProfileExistsError,
  type UsersRepository,
} from '../../modules/users/usersRepository';
import type { RealtimeNotifier } from '../../ws/notifier';
import { requireUser } from '../requireUser';

/** How many times to retry when a freshly generated pairing code is already taken. */
const CODE_ATTEMPTS = 5;

/**
 * A failed sign-up leaves no profile behind, so somebody could retry it forever with a different
 * code each time. These are the messages, and the field each one belongs under so the wizard can
 * slide back to the card that asked.
 */
const PAIRING_FAILURES: Record<OnboardingPairingError['code'], { status: number; field: string }> =
  {
    code_not_found: { status: 400, field: 'pairingCode' },
    partner_already_paired: { status: 409, field: 'pairingCode' },
    needs_couple_details: { status: 400, field: 'firstMetDate' },
  };

export function createUsersRouter(
  verifier: TokenVerifier,
  users: UsersRepository,
  realtime: RealtimeNotifier,
  /**
   * Shared with `POST /pairing/requests`. Onboarding consumes a code too, so giving it a limiter of
   * its own would just hand out a second budget against the same secret.
   */
  pairingCodeLimit: RequestHandler,
): Router {
  const router = Router();
  router.use(requireUser(verifier));

  /** The profile of whoever is asking. Used to route between onboarding and the dashboard. */
  router.get('/me', async (req: Request, res: Response) => {
    const profile = await users.findById(req.userId!);
    res.json({ profile });
  });

  router.post('/onboarding', pairingCodeLimit, async (req: Request, res: Response) => {
    const parsed = onboardingSchema().safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'invalid_payload',
          message: 'Some answers need another look.',
          // Field-level messages so the form can point at the right input. These are our own
          // copy, written for people, not raw validator output.
          fields: Object.fromEntries(
            parsed.error.issues.map((issue) => [String(issue.path[0] ?? '_'), issue.message]),
          ),
        },
      });
      return;
    }

    const userId = req.userId!;
    if (await users.findById(userId)) {
      res.status(409).json({
        error: { code: 'invalid_action', message: 'You have already set up your profile.' },
      });
      return;
    }

    // People paste codes with the spacing they were sent in. Normalising here means the repository
    // only ever compares the canonical form, exactly as the pairing route does.
    const input = parsed.data.pairingCode
      ? { ...parsed.data, pairingCode: normalisePairingCode(parsed.data.pairingCode) }
      : parsed.data;

    // A collision is astronomically unlikely, but the unique index is the real guarantee and
    // retrying is cheaper than explaining a failure to someone mid-signup.
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        const { profile, request } = await users.create(userId, input, generatePairingCode());

        if (request) {
          // Both parties, so a second device belonging to either one stays in step.
          realtime.sendToUsers([request.targetUserId, userId], EVENTS.pairing.requestCreated, {
            requestId: request.requestId,
          });
        }
        logger.info({ userId, paired: request !== null }, 'profile created');

        res.status(201).json({ profile, request });
        return;
      } catch (error) {
        if (error instanceof PairingCodeTakenError) continue;
        if (error instanceof ProfileExistsError) {
          res.status(409).json({
            error: { code: 'invalid_action', message: 'You have already set up your profile.' },
          });
          return;
        }
        if (error instanceof OnboardingPairingError) {
          const { status, field } = PAIRING_FAILURES[error.code];
          res.status(status).json({
            error: {
              code: 'invalid_action',
              reason: error.code,
              message: error.message,
              fields: { [field]: error.message },
            },
          });
          return;
        }
        throw error;
      }
    }

    throw new Error(`could not allocate a unique pairing code in ${CODE_ATTEMPTS} attempts`);
  });

  return router;
}
