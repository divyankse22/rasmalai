import { createServer } from 'node:http';
import { createSupabaseTokenVerifier } from './auth/tokenVerifier';
import { loadEnv } from './config/env';
import { closePool, getPool } from './db/pool';
import { runMigrations } from './db/migrate';
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
import { createTournamentEngine } from './modules/tournaments/tournamentEngine';
import { createTournamentRepository } from './modules/tournaments/tournamentRepository';
import { startTournamentRequestSweeper } from './modules/tournaments/tournamentRequestSweeper';
import { createUsersRepository } from './modules/users/usersRepository';
import { createNotifier } from './ws/notifier';
import { attachWebSocketServer } from './ws/server';
import { SocketRegistry } from './ws/socketRegistry';

const env = loadEnv();
const verifier = createSupabaseTokenVerifier(env.NEXT_PUBLIC_SUPABASE_URL);
const pool = getPool(env.DATABASE_URL);

/**
 * Applied before anything else touches the database, so a fresh database (or one with a migration
 * nobody remembered to run by hand) fails loudly once at boot instead of every route that touches
 * Postgres failing individually the moment traffic arrives. `runMigrations` is transactional per
 * file and a no-op when nothing is pending, which is the common case on every boot after this one.
 *
 * A top-level `await` on the server's own entrypoint: everything below this — the sweepers, the
 * orphaned-match cleanup, `server.listen()` itself — only runs once this has resolved, because
 * module evaluation is sequential. On failure this exits rather than falling through to
 * `unhandledRejection`, so the failure is loud and structured rather than a bare stack trace.
 */
try {
  const applied = await runMigrations(pool);
  if (applied.length > 0) logger.info({ count: applied.length }, 'migrations applied at boot');
} catch (error) {
  logger.error({ err: error }, 'migrations failed at boot');
  process.exit(1);
}

// The registry is built first because the HTTP layer needs to reach sockets, and the app has to
// exist before the server those sockets attach to.
const registry = new SocketRegistry();
const notifier = createNotifier(registry);

const statistics = createStatisticsRepository(pool);
const recorder = createMatchRecorder(statistics);

const tournaments = createTournamentRepository(pool);

/**
 * Sessions and the tournament engine each need the other, so the knot is tied by forwarding through
 * closures rather than by a factory that takes itself as an argument.
 *
 * Every one of these is called long after both objects exist — the earliest is the first session
 * view of the first tournament game — so referring to `tournamentEngine` from above its own
 * declaration is safe. The direction of *knowledge* stays one-way, which is the part that matters:
 * the registry only ever sees `TournamentHooks`, four methods with no idea a database exists, while
 * the engine knows the whole registry.
 */
const sessions = createSessionRegistry(notifier, registry, {
  recorder,
  tournaments: {
    viewFor: (tournamentId, userId) => tournamentEngine.viewFor(tournamentId, userId),
    matchEnded: (input) => tournamentEngine.matchEnded(input),
    nextGameRequested: (tournamentId, sessionId) =>
      tournamentEngine.nextGameRequested(tournamentId, sessionId),
    sessionClosed: (tournamentId, sessionId) =>
      tournamentEngine.sessionClosed(tournamentId, sessionId),
  },
});

const tournamentEngine = createTournamentEngine(tournaments, sessions, notifier);

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
  tournaments,
  tournamentEngine,
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
  // What a socket is handed the moment it authenticates: its own partner, and whether they're online
  // right now. Read straight from the same registry the sockets themselves use, so this can never
  // disagree with what `partnerOf` above is about to announce.
  presenceSnapshotFor: async (userId) => {
    const partner = await pairing.findPartner(userId);
    return { partner, online: partner !== null && registry.isOnline(partner.id) };
  },
});
const sweeper = startInvitationSweeper(invitations, notifier);
const tournamentRequestSweeper = startTournamentRequestSweeper(tournaments, notifier);
const retention = startRetentionJob(statistics, tournaments);

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

/**
 * The same problem one level up: a tournament whose live session died with the last process is
 * still `active` in the database, and nothing is left that could advance it. Paused, it reappears
 * on the dashboard with a Resume button and its 48 hours rather than being stuck forever.
 */
void tournamentEngine.sweepStranded().catch((error: unknown) => {
  logger.error({ err: error }, 'failed to pause stranded tournaments');
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
  tournamentRequestSweeper.stop();
  retention.stop();
  // Before the sessions: closing them ends every tournament game mid-flight, and an engine still
  // listening would try to open the next one against a pool that is about to close.
  tournamentEngine.closeAll();
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
