import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { INTERNAL_ERROR } from '@rasmalai/shared';
import type { TokenVerifier } from '../auth/tokenVerifier';
import type { UsersRepository } from '../modules/users/usersRepository';
import { logger } from '../logger';
import { createUsersRouter } from './routes/users';

export interface AppOptions {
  /** Origin of the Next.js app. Only this origin may call the API from a browser. */
  appOrigin: string;
  verifier: TokenVerifier;
  users: UsersRepository;
}

const startedAt = Date.now();

export function createApp({ appOrigin, verifier, users }: AppOptions) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: appOrigin, credentials: true }));
  app.use(express.json({ limit: '64kb' }));

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

  app.use('/api', createUsersRouter(verifier, users));

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
