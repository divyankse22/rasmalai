import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';

/**
 * Logs one line per request once it has finished.
 *
 * Deliberately minimal: method, path, status, duration and - when the request got far enough to be
 * authenticated - the user it belonged to. No headers and no bodies, because those carry access
 * tokens and personal details, and this line exists to answer "what happened", not "what was said".
 */
export function requestLogger() {
  return function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
    // The health probe fires constantly and would bury everything else.
    if (req.path === '/healthz') {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const line = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(durationMs),
        ...(req.userId ? { userId: req.userId } : {}),
      };

      if (res.statusCode >= 500) logger.error(line, 'request failed');
      else if (res.statusCode >= 400) logger.warn(line, 'request rejected');
      else logger.info(line, 'request');
    });

    next();
  };
}
