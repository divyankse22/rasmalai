import { Router, type Request, type Response } from 'express';
import type { CatalogueGame, DashboardPayload } from '@rasmalai/shared';
import type { TokenVerifier } from '../../auth/tokenVerifier';
import type { DashboardRepository } from '../../modules/dashboard/dashboardRepository';
import {
  daysTogether,
  favouriteGame,
  mostCompetitiveGame,
  winPercentage,
} from '../../modules/dashboard/summary';
import type { PairingRepository } from '../../modules/pairing/pairingRepository';
import type { UsersRepository } from '../../modules/users/usersRepository';
import { requireUser } from '../requireUser';

/**
 * One request, everything the dashboard draws.
 *
 * It answers 200 in all three states — no profile, no partner, paired — because the page has to
 * route on the difference, and a 404 for "not paired yet" would make an ordinary stage of signing
 * up look like a failure. The couple is resolved from membership, never from anything the browser
 * sends (`docs/03_DATABASE_SCHEMA.md`, important data rules).
 */
export function createDashboardRouter(
  verifier: TokenVerifier,
  users: UsersRepository,
  pairing: PairingRepository,
  dashboard: DashboardRepository,
): Router {
  const router = Router();
  router.use(requireUser(verifier));

  router.get('/dashboard', async (req: Request, res: Response) => {
    const userId = req.userId!;

    const profile = await users.findById(userId);
    if (!profile) {
      res.json({ viewer: null, couple: null, partner: null, stats: null, games: [] });
      return;
    }

    const viewer = {
      id: profile.id,
      nickname: profile.nickname,
      avatarKey: profile.avatarKey,
      gender: profile.gender,
      partnerLabelNickname: profile.partnerLabelNickname,
    };

    const scope = await dashboard.findCoupleScope(userId);
    if (!scope) {
      res.json({ viewer, couple: null, partner: null, stats: null, games: [] });
      return;
    }

    const { couple } = await pairing.getState(userId);
    if (!couple) {
      // users.couple_id and the couples table disagreeing is not a state we can render honestly,
      // so it reads as unpaired rather than as a half-built dashboard.
      res.json({ viewer, couple: null, partner: null, stats: null, games: [] });
      return;
    }

    // Independent reads against the same couple; no reason to serialise them.
    const [catalogue, lifetime, lastSevenDays] = await Promise.all([
      dashboard.catalogue(scope),
      dashboard.lifetime(scope),
      dashboard.lastSevenDays(scope),
    ]);

    const games: CatalogueGame[] = catalogue.map((row) => ({
      slug: row.slug,
      name: row.name,
      description: row.description,
      category: row.category,
      scoringKind: row.scoringKind,
      renderer: row.renderer,
      enabled: row.enabled,
      plays: row.plays,
      yourWins: row.yourWins,
      partnerWins: row.partnerWins,
      draws: row.draws,
      yourBestScore: row.yourBestScore,
      partnerBestScore: row.partnerBestScore,
    }));

    const payload: DashboardPayload = {
      viewer,
      couple: {
        id: couple.id,
        firstMetDate: couple.firstMetDate,
        locationType: couple.locationType,
        daysTogether: daysTogether(couple.firstMetDate),
      },
      partner: {
        id: couple.partner.id,
        nickname: couple.partner.nickname,
        avatarKey: couple.partner.avatarKey,
        gender: couple.partner.gender,
      },
      stats: {
        competitive: {
          gamesPlayed: lifetime.competitiveGames,
          draws: lifetime.draws,
          you: {
            ...lifetime.you,
            winPercentage: winPercentage(lifetime.you.wins, lifetime.competitiveGames),
          },
          partner: {
            ...lifetime.partner,
            winPercentage: winPercentage(lifetime.partner.wins, lifetime.competitiveGames),
          },
          closestMatch: lifetime.closestMatch,
          // Derived from the counters already fetched for the catalogue, so there is exactly one
          // definition of each and no second query to drift from it.
          mostCompetitiveGame: mostCompetitiveGame(catalogue),
        },
        together: {
          gamesPlayed: lifetime.totalGames,
          totalTimePlayedSeconds: lifetime.totalTimePlayedSeconds,
          favouriteGame: favouriteGame(catalogue),
        },
        lastSevenDays,
      },
      games,
    };

    res.json(payload);
  });

  return router;
}
