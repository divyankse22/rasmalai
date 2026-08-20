import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  EVENTS,
  TOURNAMENT_MAX_GAMES,
  TOURNAMENT_MIN_GAMES,
  type TournamentView,
} from '@rasmalai/shared';
import type { TokenVerifier } from '../../auth/tokenVerifier';
import { logger } from '../../logger';
import type { DashboardRepository } from '../../modules/dashboard/dashboardRepository';
import type { PairingRepository } from '../../modules/pairing/pairingRepository';
import {
  SessionError,
  type PresenceSource,
  type SessionRegistry,
} from '../../modules/sessions/sessionRegistry';
import type { TournamentEngine } from '../../modules/tournaments/tournamentEngine';
import {
  TournamentError,
  tournamentViewForUser,
  type TournamentRepository,
} from '../../modules/tournaments/tournamentRepository';
import type { UsersRepository } from '../../modules/users/usersRepository';
import type { RealtimeNotifier } from '../../ws/notifier';
import { rateLimit } from '../rateLimit';
import { requireUser } from '../requireUser';

/**
 * Requesting, answering, reading and resuming a tournament.
 *
 * Starting one works like a game invitation: the creator's request is `pending`, the partner
 * answers, and only an accept opens a live session and moves both of them into it. The partner sees
 * the whole line-up before answering — an accept is a real commitment to a locked, unskippable
 * sequence — and once running, the games are still revealed one at a time as the series goes (D-3),
 * so nobody plans their evening around what is coming fourth mid-series.
 */

const createBody = z.object({
  // D-4: the creator names it. Short, because it is a label on a card, not a paragraph.
  name: z.string().trim().min(1).max(40),
  gameSlugs: z
    .array(z.string().min(1).max(40))
    .min(TOURNAMENT_MIN_GAMES)
    .max(TOURNAMENT_MAX_GAMES),
});

const respondBody = z.object({ accept: z.boolean() });

/** Which failures are the caller's fault, and what each deserves. */
const STATUS_BY_CODE: Record<string, number> = {
  not_paired: 409,
  tournament_not_found: 404,
  tournament_not_active: 409,
  tournament_not_paused: 409,
  tournament_not_pending: 409,
  // Gone rather than a generic conflict: it was real, and its moment has passed (D-5, or a
  // request's five minutes).
  tournament_expired: 410,
  already_has_tournament: 409,
  invalid_game_count: 400,
  duplicate_game: 400,
  game_not_found: 404,
  game_not_playable: 409,
  already_in_game: 409,
  partner_offline: 409,
  cannot_answer_own: 403,
};

function failed(error: unknown, res: Response): boolean {
  if (!(error instanceof TournamentError) && !(error instanceof SessionError)) return false;

  res.status(STATUS_BY_CODE[error.code] ?? 400).json({
    error: { code: 'invalid_action', reason: error.code, message: error.message },
  });
  return true;
}

export function createTournamentsRouter(
  verifier: TokenVerifier,
  tournaments: TournamentRepository,
  engine: TournamentEngine,
  sessions: SessionRegistry,
  users: UsersRepository,
  pairing: PairingRepository,
  dashboard: DashboardRepository,
  realtime: RealtimeNotifier,
  presence: PresenceSource,
): Router {
  const router = Router();
  router.use(requireUser(verifier));

  /**
   * Who the two of them are and which of the couple's fixed slots each occupies.
   *
   * Resolved from membership, never from anything the browser sent — a tournament is couple-scoped
   * data like everything else (`docs/03`, important data rules). `userAId` is what turns the stored
   * a/b standings into "you" and "them" for whoever is reading.
   */
  async function resolveCouple(userId: string) {
    const [scope, partner] = await Promise.all([
      dashboard.findCoupleScope(userId),
      pairing.findPartner(userId),
    ]);
    if (!scope || !partner) return null;

    return {
      coupleId: scope.coupleId,
      partnerId: partner.id,
      userAId: scope.viewerIsUserA ? userId : partner.id,
      viewerIsUserA: scope.viewerIsUserA,
    };
  }

  /**
   * The same, plus everything that has to be true before a series can actually be opened: nothing
   * else running, and a partner who is here to play it.
   */
  async function requireReadyCouple(userId: string) {
    const couple = await resolveCouple(userId);
    if (!couple) {
      throw new TournamentError('not_paired', 'You need a partner before you can play a series.');
    }

    // ADR-009 again: the couple gets one live session, and a tournament opens one immediately.
    if (sessions.sessionIdForUser(userId)) {
      throw new SessionError('already_in_game', 'You two already have a game going.');
    }

    // A series opens a session both of them are expected to walk into. Starting one at somebody who
    // is not signed in would hold the couple's slot on a game nobody is going to play.
    if (!presence.isOnline(couple.partnerId)) {
      throw new SessionError(
        'partner_offline',
        'They are offline. Try when they are online next time.',
      );
    }

    const [me, them] = await Promise.all([
      users.findById(userId),
      users.findById(couple.partnerId),
    ]);
    if (!me || !them) {
      throw new TournamentError('not_paired', 'You need a partner before you can play a series.');
    }

    const seed = (user: NonNullable<Awaited<ReturnType<UsersRepository['findById']>>>) => ({
      userId: user.id,
      nickname: user.nickname,
      avatarKey: user.avatarKey,
      gender: user.gender,
    });

    // Seat order is the couple's fixed a/b slots rather than who happened to press the button, so
    // the standings mean the same thing to both of them however the series was started.
    const players: [ReturnType<typeof seed>, ReturnType<typeof seed>] = couple.viewerIsUserA
      ? [seed(me), seed(them)]
      : [seed(them), seed(me)];

    return { ...couple, players };
  }

  /** Moves both of them into the session the series just opened. */
  function announceStart(
    userIds: readonly string[],
    sessionId: string,
    viewOf: (userId: string) => TournamentView,
  ): void {
    for (const userId of new Set(userIds)) {
      realtime.sendToUser(userId, EVENTS.results.tournamentNextGame, {
        sessionId,
        tournament: viewOf(userId),
      });
    }
  }

  /** Tells both of them a tournament changed state (declined, cancelled, expired, abandoned…). */
  function announceUpdate(
    userIds: readonly string[],
    viewOf: (userId: string) => TournamentView,
  ): void {
    for (const userId of new Set(userIds)) {
      realtime.sendToUser(userId, EVENTS.results.tournamentUpdated, {
        tournament: viewOf(userId),
      });
    }
  }

  router.get('/tournaments/active', async (req: Request, res: Response) => {
    const userId = req.userId!;
    const couple = await resolveCouple(userId);
    if (!couple) {
      res.json({ tournament: null, activeSessionId: null });
      return;
    }

    const tournament = await tournaments.getActiveTournament(couple.coupleId);
    res.json({
      tournament:
        tournament === null ? null : tournamentViewForUser(tournament, userId, couple.userAId),
      // A reload while the series is running lands back in the game rather than on the dashboard.
      activeSessionId: sessions.sessionIdForUser(userId),
    });
  });

  router.post(
    '/tournaments',
    // A series is a whole evening, so nobody needs to start many. Enough to recover from a
    // mis-click, not enough to churn through the couple's one slot.
    rateLimit({ limit: 10, windowMs: 5 * 60 * 1000 }),
    async (req: Request, res: Response) => {
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'invalid_payload',
            message: `Name it and pick ${TOURNAMENT_MIN_GAMES}–${TOURNAMENT_MAX_GAMES} games.`,
          },
        });
        return;
      }

      const userId = req.userId!;
      try {
        // `engine.start` never runs here — nothing opens until an accept — but the rest of
        // `requireReadyCouple` still applies: nothing else running (ADR-009), and a partner who is
        // actually here, because a request to somebody not signed in is five minutes of waiting for
        // a sheet nobody will ever see (the same reasoning `invitations.ts` gives).
        const { coupleId, userAId, partnerId } = await requireReadyCouple(userId);

        const tournament = await tournaments.createTournament({
          coupleId,
          createdByUserId: userId,
          name: parsed.data.name,
          gameSlugs: parsed.data.gameSlugs,
        });

        for (const reader of new Set([userId, partnerId])) {
          realtime.sendToUser(reader, EVENTS.tournamentRequest.created, {
            tournament: tournamentViewForUser(tournament, reader, userAId),
          });
        }
        logger.info(
          { userId, tournamentId: tournament.id, games: parsed.data.gameSlugs.length },
          'tournament requested',
        );

        res.status(201).json({ tournament: tournamentViewForUser(tournament, userId, userAId) });
      } catch (error) {
        if (failed(error, res)) return;
        throw error;
      }
    },
  );

  router.post('/tournaments/:id/respond', async (req: Request, res: Response) => {
    const parsed = respondBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Play, or not now?' } });
      return;
    }

    const tournamentId = req.params.id;
    if (typeof tournamentId !== 'string') {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Unknown tournament.' } });
      return;
    }

    const userId = req.userId!;
    try {
      if (parsed.data.accept) {
        // Accepting is exactly what an instant-start create used to do: open the session and move
        // both of them into it. `requireReadyCouple` re-checks nothing has started elsewhere and the
        // partner (the person accepting) is here, which they trivially are — the check that matters
        // is the creator's partner slot, resolved the same way regardless of who is answering.
        const { userAId, partnerId, players } = await requireReadyCouple(userId);

        const { tournament } = await tournaments.respondToTournamentRequest(
          tournamentId,
          userId,
          true,
        );

        let sessionId: string;
        try {
          sessionId = engine.start({ tournament, userAId, players });
        } catch (error) {
          // The row exists but nothing can play it — a game module that went missing between the
          // catalogue check and here. Abandoned rather than left behind, because the partial unique
          // index would otherwise refuse this couple every future series.
          await tournaments.abandonTournament(tournament.id);
          throw error;
        }

        announceStart([userId, partnerId], sessionId, (reader) =>
          tournamentViewForUser(tournament, reader, userAId),
        );
        logger.info({ userId, tournamentId, sessionId }, 'tournament request accepted');

        res.json({ accepted: true, sessionId });
        return;
      }

      const couple = await resolveCouple(userId);
      if (!couple) {
        throw new TournamentError('not_paired', 'You need a partner before you can play a series.');
      }

      const { tournament, otherUserId } = await tournaments.respondToTournamentRequest(
        tournamentId,
        userId,
        false,
      );

      announceUpdate([userId, otherUserId], (reader) =>
        tournamentViewForUser(tournament, reader, couple.userAId),
      );
      logger.info({ userId, tournamentId }, 'tournament request declined');

      res.json({ accepted: false });
    } catch (error) {
      if (failed(error, res)) return;
      throw error;
    }
  });

  router.post('/tournaments/:id/cancel', async (req: Request, res: Response) => {
    const tournamentId = req.params.id;
    if (typeof tournamentId !== 'string') {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Unknown tournament.' } });
      return;
    }

    const userId = req.userId!;
    try {
      const couple = await resolveCouple(userId);
      if (!couple) {
        throw new TournamentError('not_paired', 'You need a partner before you can play a series.');
      }

      const { tournament, otherUserId } = await tournaments.cancelTournamentRequest(
        tournamentId,
        userId,
      );

      announceUpdate([userId, otherUserId], (reader) =>
        tournamentViewForUser(tournament, reader, couple.userAId),
      );
      logger.info({ userId, tournamentId }, 'tournament request cancelled');

      res.json({ cancelled: true });
    } catch (error) {
      if (failed(error, res)) return;
      throw error;
    }
  });

  router.post('/tournaments/:id/resume', async (req: Request, res: Response) => {
    const tournamentId = req.params.id;
    if (typeof tournamentId !== 'string') {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Unknown tournament.' } });
      return;
    }

    const userId = req.userId!;
    try {
      const { coupleId, userAId, partnerId, players } = await requireReadyCouple(userId);

      // Couple-scoped before anything else: knowing an id is not permission to resume somebody
      // else's evening.
      const existing = await tournaments.getTournament(tournamentId, coupleId);
      if (!existing) {
        throw new TournamentError('tournament_not_found', 'That tournament does not exist.');
      }

      const resumed = await tournaments.resumeTournament(tournamentId);
      const sessionId = engine.start({ tournament: resumed, userAId, players });

      announceStart([userId, partnerId], sessionId, (reader) =>
        tournamentViewForUser(resumed, reader, userAId),
      );
      logger.info({ userId, tournamentId, sessionId }, 'tournament resumed');

      res.json({ tournament: tournamentViewForUser(resumed, userId, userAId), sessionId });
    } catch (error) {
      if (failed(error, res)) return;
      throw error;
    }
  });

  router.post('/tournaments/:id/abandon', async (req: Request, res: Response) => {
    const tournamentId = req.params.id;
    if (typeof tournamentId !== 'string') {
      res.status(400).json({ error: { code: 'invalid_payload', message: 'Unknown tournament.' } });
      return;
    }

    const userId = req.userId!;
    try {
      const couple = await resolveCouple(userId);
      if (!couple) {
        throw new TournamentError('not_paired', 'You need a partner before you can play a series.');
      }

      const existing = await tournaments.getTournament(tournamentId, couple.coupleId);
      if (!existing) {
        throw new TournamentError('tournament_not_found', 'That tournament does not exist.');
      }

      await tournaments.abandonTournament(tournamentId);
      engine.forget(tournamentId);

      const abandoned = { ...existing, status: 'abandoned' as const };
      // Both, because either of them may be looking at a card for a series that no longer exists.
      announceUpdate([userId, couple.partnerId], (reader) =>
        tournamentViewForUser(abandoned, reader, couple.userAId),
      );
      logger.info({ userId, tournamentId }, 'tournament abandoned');

      res.json({ abandoned: true });
    } catch (error) {
      if (failed(error, res)) return;
      throw error;
    }
  });

  return router;
}
