import { createServer } from 'node:http';
import { createSupabaseTokenVerifier } from './auth/tokenVerifier';
import { loadEnv } from './config/env';
import { closePool, getPool } from './db/pool';
import { createApp } from './http/app';
import { logger } from './logger';
import { createDashboardRepository } from './modules/dashboard/dashboardRepository';
import { startInvitationSweeper } from './modules/invitations/expirySweeper';
import { createInvitationsRepository } from './modules/invitations/invitationsRepository';
import { createPairingRepository } from './modules/pairing/pairingRepository';
import { startRetentionJob } from './modules/retention/retentionJob';
import { createSessionRegistry } from './modules/sessions/sessionRegistry';
import { createMatchRecorder } from './modules/statistics/matchRecorder';
import { createStatisticsRepository } from './modules/statistics/statisticsRepository';
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
const notifier = createNotifier(registry);

const statistics = createStatisticsRepository(pool);
const recorder = createMatchRecorder(statistics);

// Live sessions read presence straight from the socket registry rather than keeping their own
// copy, so the two can never disagree about who is here.
const sessions = createSessionRegistry(notifier, registry, { recorder });
const invitations = createInvitationsRepository(pool);
const pairing = createPairingRepository(pool);

const app = createApp({
  appOrigin: env.APP_ORIGIN,
  verifier,
  users: createUsersRepository(pool),
  pairing,
  dashboard: createDashboardRepository(pool),
  invitations,
  sessions,
  realtime: notifier,
  // The same registry the sockets and the sessions read, so nothing can disagree about who is here.
  presence: registry,
});
const server = createServer(app);

const realtime = attachWebSocketServer(server, {
  verifier,
  registry,
  sessions,
  // The one person allowed to know whether you are online.
  partnerOf: async (userId) => (await pairing.findPartner(userId))?.id ?? null,
});
const sweeper = startInvitationSweeper(invitations, notifier);
const retention = startRetentionJob(statistics);

/**
 * Live sessions are memory-only, so any match still marked `active` belongs to a process that is
 * already gone. Left alone, the partial unique index enforcing ADR-009 would refuse that couple
 * every future match for the life of this one.
 */
void statistics
  .abandonOrphanedMatches()
  .then((count) => {
    if (count > 0) logger.warn({ count }, 'closed matches orphaned by a restart');
  })
  .catch((error: unknown) => {
    logger.error({ err: error }, 'failed to close orphaned matches');
  });

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

  // Sessions are memory-only and do not survive this, so both players are told the game is over
  // rather than being left watching a lobby that will never move again.
  sweeper.stop();
  retention.stop();
  sessions.closeAll();

  void realtime
    .close()
    // Closing the sessions above ended every live match, and those writes are queued rather than
    // awaited. Draining before the pool closes is the difference between "abandoned" and a row
    // stuck at `active` until the next restart.
    .then(() => recorder.drain())
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
