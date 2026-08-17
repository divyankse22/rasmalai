import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { INTERNAL_ERROR } from '@rasmalai/shared';
import type { TokenVerifier } from '../auth/tokenVerifier';
import type { DashboardRepository } from '../modules/dashboard/dashboardRepository';
import type { InvitationsRepository } from '../modules/invitations/invitationsRepository';
import type { PairingRepository } from '../modules/pairing/pairingRepository';
import type { PresenceSource, SessionRegistry } from '../modules/sessions/sessionRegistry';
import type { TournamentEngine } from '../modules/tournaments/tournamentEngine';
import type { TournamentRepository } from '../modules/tournaments/tournamentRepository';
import type { UsersRepository } from '../modules/users/usersRepository';
import type { RealtimeNotifier } from '../ws/notifier';
import { logger } from '../logger';
import { rateLimit } from './rateLimit';
import { requestLogger } from './requestLogger';
import { createDashboardRouter } from './routes/dashboard';
import { createInvitationsRouter } from './routes/invitations';
import { createPairingRouter } from './routes/pairing';
import { createTournamentsRouter } from './routes/tournaments';
import { createUsersRouter } from './routes/users';

export interface AppOptions {
  /** Origin of the Next.js app. Only this origin may call the API from a browser. */
  appOrigin: string;
  verifier: TokenVerifier;
  users: UsersRepository;
  pairing: PairingRepository;
  dashboard: DashboardRepository;
  invitations: InvitationsRepository;
  sessions: SessionRegistry;
  /** Durable tournament state, and the in-memory thing that runs a live one. */
  tournaments: TournamentRepository;
  tournamentEngine: TournamentEngine;
  realtime: RealtimeNotifier;
  /**
   * Who is online, read from the same socket registry the sessions and the WebSocket layer's
   * presence snapshot read.
   *
   * One source, so the invitation gate and a live game can never disagree about whether somebody is
   * here — used here only by the invitation gate; the header gets presence over the socket.
   */
  presence: PresenceSource;
}

const startedAt = Date.now();

export function createApp({
  appOrigin,
  verifier,
  users,
  pairing,
  dashboard,
  invitations,
  sessions,
  tournaments,
  tournamentEngine,
  realtime,
  presence,
}: AppOptions) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: appOrigin, credentials: true }));
  app.use(express.json({ limit: '64kb' }));
  app.use(requestLogger());

  /**
   * Liveness/readiness probe for Render and for `docker run`.
   * Deliberately exposes nothing about the environment, the database or the build.
   */
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'rasmalai-server',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  /**
   * One budget for every route that spends a pairing code: onboarding, the wizard's lookup, and
   * sending a request. A code is 8 characters from a 32-character alphabet, and this is what makes
   * grinding it pointless — so the three of them share a limiter rather than each getting ten
   * tries of their own.
   */
  const pairingCodeLimit = rateLimit({ limit: 10, windowMs: 10 * 60 * 1000 });

  app.use('/api', createUsersRouter(verifier, users, realtime, pairingCodeLimit));
  app.use('/api', createPairingRouter(verifier, pairing, realtime, pairingCodeLimit));
  app.use('/api', createDashboardRouter(verifier, users, pairing, dashboard));
  app.use(
    '/api',
    createInvitationsRouter(verifier, invitations, sessions, users, realtime, pairing, presence),
  );
  app.use(
    '/api',
    createTournamentsRouter(
      verifier,
      tournaments,
      tournamentEngine,
      sessions,
      users,
      pairing,
      dashboard,
      realtime,
      presence,
    ),
  );

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown endpoint.' } });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // The detail goes to the log; the client only ever sees a safe, structured error.
    logger.error({ err: error }, 'unhandled request error');
    res.status(500).json({ error: INTERNAL_ERROR });
  });

  return app;
}
