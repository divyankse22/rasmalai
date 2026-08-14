import { createServer } from 'node:http';
import { createSupabaseTokenVerifier } from './auth/tokenVerifier';
import { loadEnv } from './config/env';
import { closePool, getPool } from './db/pool';
import { createApp } from './http/app';
import { logger } from './logger';
import { createPairingRepository } from './modules/pairing/pairingRepository';
import { createUsersRepository } from './modules/users/usersRepository';
import { createNotifier } from './ws/notifier';
import { attachWebSocketServer } from './ws/server';
import { SocketRegistry } from './ws/socketRegistry';

const env = loadEnv();
const verifier = createSupabaseTokenVerifier(env.NEXT_PUBLIC_SUPABASE_URL);
const pool = getPool(env.DATABASE_URL);

// The registry is built first because the HTTP layer needs to reach sockets, and the app has to
// exist before the server those sockets attach to.
const registry = new SocketRegistry();

const app = createApp({
  appOrigin: env.APP_ORIGIN,
  verifier,
  users: createUsersRepository(pool),
  pairing: createPairingRepository(pool),
  realtime: createNotifier(registry),
});
const server = createServer(app);

const realtime = attachWebSocketServer(server, { verifier, registry });

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'rasmalai server listening');
});

/**
 * Render sends SIGTERM on deploy. Closing cleanly matters more than usual here: once slice 6 lands,
 * open sockets belong to people mid-game, and they need the close frame to trigger reconnect rather
 * than hanging until a timeout.
 */
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.warn('forcing exit after grace period');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forceExit.unref();

  void realtime
    .close()
    .then(() => closePool())
    .then(() => {
      server.close((error) => {
        if (error) {
          logger.error({ err: error }, 'error while closing server');
          process.exit(1);
        }
        logger.info('shutdown complete');
        process.exit(0);
      });
    });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});
