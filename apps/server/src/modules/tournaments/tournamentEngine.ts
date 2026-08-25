import { EVENTS, type TournamentView } from '@rasmalai/shared';
import { logger } from '../../logger';
import type {
  SessionEmitter,
  SessionPlayerSeed,
  SessionRegistry,
  TournamentHooks,
  TournamentMatchEnded,
} from '../sessions/sessionRegistry';
import type { Tournament, TournamentRepository } from './tournamentRepository';
import { tournamentViewForUser } from './tournamentRepository';

/**
 * The tournament engine — the in-memory orchestrator that sits between live sessions and the
 * standings.
 *
 * A tournament is a run of games played one after another for points. The repository owns the
 * scoring and the durable state; this owns the *sequence*: which game is open right now, whose
 * session it is, and what happens when that session ends. It implements `TournamentHooks`, which is
 * the whole of what the session registry knows about tournaments.
 *
 * ## What ends a game, and what each ending means
 *
 * | ending                              | consequence                                    |
 * |-------------------------------------|------------------------------------------------|
 * | played to a result                  | scored, series advances on both players' say-so |
 * | reconnect window ran out            | the game restarts (`docs/04` section 6)         |
 * | ran out twice in a row              | the series pauses (`docs/13` section 6)         |
 * | they agreed to stop mid-match       | the series pauses (D-5)                         |
 * | walked away from the results screen | the series pauses (D-5)                         |
 *
 * Restarting rather than awarding is the point of the first two rows: one dropped connection must
 * never hand over points in a standings table. Pausing rather than abandoning is the point of the
 * rest — a series is an evening's worth of games, and stepping away from one for two days is not
 * the same as giving it up. A paused series is resumable for 48 hours (D-5) and swept after that.
 *
 * ## Why the standings are cached here
 *
 * `viewFor` is called while a session view is being built, which happens on every frame of every
 * live game. It has to be synchronous, so the engine keeps the last `Tournament` it read and
 * refreshes it whenever it changes. The database stays authoritative; this is a read-through copy
 * with exactly one writer.
 *
 * ## What a restart of the process does to a series
 *
 * Live sessions are memory-only (`docs/13` section 6), so a restart closes every one of them and
 * this map goes with them. The series itself survives in Postgres as `active` with no session
 * behind it. `sweepStranded` is what closes that gap on startup: an active series that nothing is
 * playing is paused, which puts it back on the dashboard with a Resume button instead of leaving it
 * stuck.
 */

/** Per-series in-memory state. */
interface LiveTournament {
  tournamentId: string;
  coupleId: string;
  /** `couples.user_a_id`, for turning fixed slots into "you" and "them". */
  userAId: string;
  players: [SessionPlayerSeed, SessionPlayerSeed];
  /** The last standings read from the repository, so `viewFor` can answer without waiting. */
  tournament: Tournament;
  /** The session currently open for this series, or null between games. */
  sessionId: string | null;
  /** Consecutive failed attempts at the *current* game. Reset the moment one is played. */
  failedRestarts: number;
  /** True on a results screen with more games to come — the state D-5's pause applies to. */
  awaitingNext: boolean;
  /**
   * One decision at a time, in the order they arrived.
   *
   * The session layer is synchronous and this is not: scoring a game is a database round trip, and
   * three or four events routinely land during one. They cannot run concurrently — two of them
   * would both read "the game we are up to" and open two sessions for it — and they must not be
   * *dropped* either, which is the trap. Both players readying while the previous result was still
   * settling is entirely ordinary, and refusing it would leave the series sitting on a results
   * screen with nothing able to move it on. So they queue, exactly like `matchRecorder`'s writes.
   */
  queue: Promise<void>;
}

export interface TournamentEngine extends TournamentHooks {
  /**
   * Begin running a series, opening the session for whichever game it is up to. Used both when a
   * tournament is created and when a paused one is resumed. Returns the new session's id.
   */
  start(input: {
    tournament: Tournament;
    userAId: string;
    players: [SessionPlayerSeed, SessionPlayerSeed];
  }): string;
  /** Stop running a series and drop its state. Called when one is abandoned. */
  forget(tournamentId: string): void;
  /** Whether this couple has a series being run right now. */
  isRunning(coupleId: string): boolean;
  /**
   * Pauses any series left `active` with nothing playing it, which after a restart is all of them.
   * Returns how many were paused.
   */
  sweepStranded(): Promise<number>;
  closeAll(): void;
}

export function createTournamentEngine(
  repo: TournamentRepository,
  sessions: SessionRegistry,
  emitter: SessionEmitter,
): TournamentEngine {
  const live = new Map<string, LiveTournament>();
  const byCouple = new Map<string, string>();

  /** The game the series is up to, which the repository keeps as the one marked `active`. */
  function currentGame(tournament: Tournament) {
    return tournament.games.find((game) => game.status === 'active') ?? null;
  }

  function emit(state: LiveTournament, type: string, extra: Record<string, unknown> = {}): void {
    for (const player of state.players) {
      emitter.sendToUser(player.userId, type, {
        // Resolved per reader, so neither player ever sees the other's side of the scoreboard.
        tournament: tournamentViewForUser(state.tournament, player.userId, state.userAId),
        ...extra,
      });
    }
  }

  function drop(state: LiveTournament): void {
    live.delete(state.tournamentId);
    if (byCouple.get(state.coupleId) === state.tournamentId) byCouple.delete(state.coupleId);
  }

  /** Opens the session for whatever game the series is up to, and remembers which one it is. */
  function openCurrent(state: LiveTournament): string | null {
    const game = currentGame(state.tournament);
    if (!game) {
      logger.error({ tournamentId: state.tournamentId }, 'tournament has no game to open');
      return null;
    }

    const session = sessions.create({
      coupleId: state.coupleId,
      gameSlug: game.gameSlug,
      gameName: game.gameName,
      players: state.players,
      mode: 'tournament',
      tournamentId: state.tournamentId,
    });

    state.sessionId = session.id;
    state.awaitingNext = false;
    return session.id;
  }

  /** Pauses the series and tells both of them, with the reason for the log rather than the screen. */
  async function pause(state: LiveTournament, why: string): Promise<void> {
    state.tournament = await repo.pauseTournament(state.tournamentId);
    emit(state, EVENTS.results.tournamentUpdated);
    drop(state);
    logger.info({ tournamentId: state.tournamentId, why }, 'tournament paused');
  }

  /**
   * A game failed to happen. Restart it, or give up on the evening after the second time.
   *
   * Two is the number `docs/13` section 6 settled on, and the reason is that one dropped connection
   * is an accident while two in a row is a message. Restarting forever would leave two people
   * bouncing off a game neither of them can currently play.
   */
  async function handleFailure(state: LiveTournament, end: TournamentMatchEnded): Promise<void> {
    // D-5: agreeing to stop is not a failed connection, and does not spend a restart. They chose to
    // put the evening down, so it is put down where it stands.
    if (end.byLeave) {
      await pause(state, 'agreed to stop mid-match');
      return;
    }

    state.failedRestarts += 1;
    if (state.failedRestarts >= 2) {
      await pause(state, 'two consecutive failed restarts');
      return;
    }

    const sessionId = openCurrent(state);
    if (sessionId === null) return;

    logger.info(
      { tournamentId: state.tournamentId, attempt: state.failedRestarts, sessionId },
      'restarting tournament game',
    );
    emit(state, EVENTS.results.tournamentNextGame, { sessionId });
  }

  /** A game was played. Score it, and either finish the series or wait on the results screen. */
  async function handleResult(state: LiveTournament, end: TournamentMatchEnded): Promise<void> {
    const game = currentGame(state.tournament);
    if (!game) {
      logger.error({ tournamentId: state.tournamentId }, 'a tournament game ended with none open');
      drop(state);
      return;
    }

    state.tournament = await repo.advanceGame(
      state.tournamentId,
      {
        tournamentGameId: game.id,
        winnerUserId: end.winnerUserId,
        scored: game.scored,
      },
      state.userAId,
    );
    state.failedRestarts = 0;

    emit(state, EVENTS.results.tournamentGameResult, { finishedPosition: game.position });

    if (state.tournament.status === 'completed') {
      emit(state, EVENTS.results.tournamentUpdated);
      logger.info(
        { tournamentId: state.tournamentId, winnerUserId: state.tournament.winnerUserId },
        'tournament completed',
      );
      // Kept in the map rather than dropped: the celebration is rendered from the session view, and
      // dropping the standings now would blank the scoreboard at the exact moment it matters most.
      // `sessionClosed` clears it when they leave the screen.
      state.awaitingNext = false;
      return;
    }

    // More to play. Nothing opens until both of them ask for it from the results screen, so neither
    // is dragged off a scoreline they have not read yet.
    state.awaitingNext = true;
  }

  /**
   * Queues one decision behind whatever is already running for this series.
   *
   * The guard runs *inside* the queued work rather than at call time, because what a decision is
   * allowed to do depends on where the series is when its turn comes, not on where it was when the
   * event arrived. A restart that has already re-opened the game is exactly what makes a late frame
   * from the old session stale.
   */
  function decide(
    state: LiveTournament,
    sessionId: string,
    work: () => Promise<void>,
  ): void {
    state.queue = state.queue
      .then(async () => {
        // Dropped, not deferred: this belongs to a session the series has moved past, or to one it
        // has already stopped running.
        if (!live.has(state.tournamentId) || state.sessionId !== sessionId) return;
        await work();
      })
      .catch((error: unknown) => {
        // Never thrown into the session layer: the caller is holding a match clock, and a database
        // blip must not become a crashed game. The series stays where it is and stays resumable.
        logger.error({ err: error, tournamentId: state.tournamentId }, 'tournament engine failed');
      });
  }

  /**
   * The series has no session behind it any more.
   *
   * Completed, so the couple is simply done and the state is dropped — or left sitting between
   * games, which is the walk-away D-5 pauses for. A series mid-decision never reaches here; the
   * busy latch defers it.
   */
  async function afterSessionClosed(state: LiveTournament): Promise<void> {
    state.sessionId = null;

    if (state.tournament.status !== 'active') {
      drop(state);
      return;
    }

    await pause(state, 'session closed between games');
  }

  const engine: TournamentEngine = {
    start({ tournament, userAId, players }) {
      const state: LiveTournament = {
        tournamentId: tournament.id,
        coupleId: tournament.coupleId,
        userAId,
        players,
        tournament,
        sessionId: null,
        failedRestarts: 0,
        awaitingNext: false,
        queue: Promise.resolve(),
      };

      live.set(tournament.id, state);
      byCouple.set(tournament.coupleId, tournament.id);

      const sessionId = openCurrent(state);
      if (sessionId === null) {
        drop(state);
        throw new Error('tournament has no game to play');
      }

      logger.info({ tournamentId: tournament.id, sessionId }, 'tournament session opened');
      return sessionId;
    },

    viewFor(tournamentId, userId): TournamentView | null {
      const state = live.get(tournamentId);
      if (!state) return null;
      return tournamentViewForUser(state.tournament, userId, state.userAId);
    },

    matchEnded(end) {
      const state = live.get(end.tournamentId);
      if (!state) return;

      decide(state, end.sessionId, () =>
        end.played ? handleResult(state, end) : handleFailure(state, end),
      );
    },

    nextGameRequested(tournamentId, sessionId) {
      const state = live.get(tournamentId);
      if (!state) return;

      decide(state, sessionId, async () => {
        // Only from a results screen with something left to play. Both of them readying in a lobby
        // is an ordinary countdown and has nothing to do with the series.
        if (!state.awaitingNext) return;

        // The old session goes first: the couple gets one live session (ADR-009), and the next game
        // cannot be created while the finished one still holds it. This also stops `sessionClosed`
        // from reading the teardown as a walk-away — `awaitingNext` is cleared by `openCurrent`.
        state.awaitingNext = false;
        sessions.closeTournamentSession(sessionId);
        state.sessionId = null;

        const nextId = openCurrent(state);
        if (nextId === null) {
          await pause(state, 'no next game to open');
          return;
        }

        const game = currentGame(state.tournament);
        logger.info(
          { tournamentId, sessionId: nextId, position: game?.position },
          'tournament advanced to the next game',
        );
        emit(state, EVENTS.results.tournamentNextGame, { sessionId: nextId });
      });
    },

    sessionClosed(tournamentId, sessionId) {
      const state = live.get(tournamentId);
      if (!state) return;

      // Queued behind whatever is already running, which is what tells a walk-away apart from an
      // ordinary handover: a session the engine is itself replacing has had `sessionId` moved off it
      // by the time this runs, and the guard drops it.
      decide(state, sessionId, () => afterSessionClosed(state));
    },

    forget(tournamentId) {
      const state = live.get(tournamentId);
      if (state) drop(state);
    },

    isRunning(coupleId) {
      const tournamentId = byCouple.get(coupleId);
      return tournamentId !== undefined && live.has(tournamentId);
    },

    async sweepStranded() {
      const stranded = await repo.pauseStrandedTournaments(
        [...live.keys()].filter((id) => live.get(id)?.sessionId !== null),
      );
      if (stranded > 0) logger.warn({ stranded }, 'paused tournaments left running by a restart');
      return stranded;
    },

    closeAll() {
      live.clear();
      byCouple.clear();
    },
  };

  return engine;
}
