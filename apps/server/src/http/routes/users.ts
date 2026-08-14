import { Router, type Request, type Response } from 'express';
import type { TokenVerifier } from '../../auth/tokenVerifier';
import { logger } from '../../logger';
import { generatePairingCode } from '../../modules/users/pairingCode';
import { onboardingSchema } from '../../modules/users/user.schema';
import {
  PairingCodeTakenError,
  ProfileExistsError,
  type UsersRepository,
} from '../../modules/users/usersRepository';
import { requireUser } from '../requireUser';

/** How many times to retry when a freshly generated pairing code is already taken. */
const CODE_ATTEMPTS = 5;

export function createUsersRouter(verifier: TokenVerifier, users: UsersRepository): Router {
  const router = Router();
  router.use(requireUser(verifier));

  /** The profile of whoever is asking. Used to route between onboarding and the dashboard. */
  router.get('/me', async (req: Request, res: Response) => {
    const profile = await users.findById(req.userId!);
    res.json({ profile });
  });

  router.post('/onboarding', async (req: Request, res: Response) => {
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

    // A collision is astronomically unlikely, but the unique index is the real guarantee and
    // retrying is cheaper than explaining a failure to someone mid-signup.
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        const profile = await users.create(userId, parsed.data, generatePairingCode());
        logger.info({ userId }, 'profile created');
        res.status(201).json({ profile });
        return;
      } catch (error) {
        if (error instanceof PairingCodeTakenError) continue;
        if (error instanceof ProfileExistsError) {
          res.status(409).json({
            error: { code: 'invalid_action', message: 'You have already set up your profile.' },
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
