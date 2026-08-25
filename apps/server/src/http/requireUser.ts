import type { NextFunction, Request, Response } from 'express';
import type { TokenVerifier } from '../auth/tokenVerifier';
import { logger } from '../logger';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set only by requireUser; every route behind it can rely on this being present. */
    userId?: string;
  }
}

/**
 * Rejects any request that does not carry a valid Supabase access token.
 *
 * The user id comes from the verified token and nowhere else - never from a header, a body field or
 * a query parameter - so a client cannot act as anyone but itself
 * (`docs/02_ARCHITECTURE.md` section 8).
 */
export function requireUser(verifier: TokenVerifier) {
  return async function requireUserMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!token) {
      res.status(401).json({
        error: { code: 'not_authenticated', message: 'Sign in to continue.' },
      });
      return;
    }

    try {
      const user = await verifier.verify(token);
      req.userId = user.userId;
      next();
    } catch (error) {
      logger.debug({ err: error }, 'rejected an http request with an unusable token');
      res.status(401).json({
        error: { code: 'not_authenticated', message: 'That session is not valid.' },
      });
    }
  };
}
