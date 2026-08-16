import { Router, type Request, type Response } from 'express';
import type { PartnerPresence } from '@rasmalai/shared';
import type { TokenVerifier } from '../../auth/tokenVerifier';
import type { PairingRepository } from '../../modules/pairing/pairingRepository';
import type { PresenceSource } from '../../modules/sessions/sessionRegistry';
import { requireUser } from '../requireUser';

/**
 * Whether your partner is here right now.
 *
 * The socket already announces this the moment it changes (`partner.online` / `partner.offline`),
 * and that remains the live feed — `docs/02_ARCHITECTURE.md` is explicit that presence is not
 * something to poll for. This endpoint exists for the two things a stream of transitions cannot do:
 * tell a page that has just loaded where things already stand, and answer "are they there *now*"
 * at the moment somebody presses Play.
 *
 * Couple-scoped like everything else: the partner is resolved from membership, and there is no way
 * to ask about anybody else. Presence is read straight from the socket registry, so this and the
 * socket can never disagree about who is online.
 */
export function createPresenceRouter(
  verifier: TokenVerifier,
  pairing: PairingRepository,
  presence: PresenceSource,
): Router {
  const router = Router();
  router.use(requireUser(verifier));

  router.get('/presence/partner', async (req: Request, res: Response) => {
    const partner = await pairing.findPartner(req.userId!);

    // 200 with `partner: null` rather than a 404: not being paired yet is an ordinary stage of
    // signing up, and the header asks this on every page whether or not there is anybody to ask
    // about. The same reasoning as the dashboard route.
    const payload: PartnerPresence = {
      partner,
      online: partner !== null && presence.isOnline(partner.id),
    };

    res.json(payload);
  });

  return router;
}
