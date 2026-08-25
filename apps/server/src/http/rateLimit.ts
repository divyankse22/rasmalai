import type { NextFunction, Request, Response } from 'express';

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Defaults to the authenticated user, which is the only identity we actually trust. */
  keyOf?: (req: Request) => string;
}

/**
 * A fixed-window limiter held in memory.
 *
 * `docs/07_SECURITY_PRIVACY.md` asks us to protect the obvious abuse paths without overengineering.
 * Pairing code submission is the one that matters: without a limit it is an oracle someone could
 * grind against. In-process state is fine while there is a single backend instance - and adding
 * Redis for two hundred users is exactly what the architecture review skill says to refuse.
 */
export function rateLimit({ limit, windowMs, keyOf }: RateLimitOptions) {
  const windows = new Map<string, Window>();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = keyOf ? keyOf(req) : (req.userId ?? req.ip ?? 'anonymous');
    const now = Date.now();
    const existing = windows.get(key);

    if (!existing || now >= existing.resetAt) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (existing.count >= limit) {
      const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader('retry-after', String(retryAfter));
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many tries. Give it a minute.' },
      });
      return;
    }

    existing.count += 1;
    next();

    // Opportunistic cleanup: without it a long-running process would hold every key it ever saw.
    if (windows.size > 1000) {
      for (const [candidate, window] of windows) {
        if (now >= window.resetAt) windows.delete(candidate);
      }
    }
  };
}
