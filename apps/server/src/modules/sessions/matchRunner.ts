import { randomInt } from 'node:crypto';
import type {
  ActionTiming,
  AnyGameRules,
  GameContext,
  GameResult,
  PlayerIndex,
  Transition,
} from '@rasmalai/games';
import { SessionError } from './sessionError';

/**
 * One match, running.
 *
 * This is the whole of the platform's relationship with a game: it holds the authoritative state,
 * owns the single timer the rules ask for, and translates seats back into events for the session to
 * deliver. It knows nothing about reaction speed, four in a row, or anything that comes after — the
 * point of `docs/05_GAME_SDK.md` is that adding the tenth game does not touch this file.
 *
 * The rules are pure, so everything impure lives here: the clock, the timer, and the randomness.
 */

export interface MatchEmitter {
  /** Deliver a game event. `to` is a seat; omitted means both players. */
  emit(type: string, to?: PlayerIndex): void;
  /** The match reached its end, after its own final events have gone out. Fired once. */
  onComplete(result: GameResult): void;
}

export interface RunningMatch {
  readonly slug: string;
  readonly complete: boolean;
  /** The game's state as one seat is allowed to see it. */
  viewFor(player: PlayerIndex): unknown;
  /**
   * The seat the game is waiting on, or null when it is waiting on time instead.
   *
   * The session runs the move clock from this. It is read rather than pushed because the answer
   * changes for reasons the runner cannot see — a move, a tick, a game deciding it is over — and
   * asking is the only way that cannot go stale.
   */
  turnOf(): PlayerIndex | null;
  /** Throws `SessionError` if the game refuses the action. */
  submitAction(player: PlayerIndex, action: unknown, at: ActionTiming): void;
  /** A player is missing: stop the clock and throw away whatever was in flight. */
  pause(): void;
  resume(): void;
  result(): GameResult | null;
  /**
   * What `getResult` says about the board **right now**, whether or not the match is actually
   * complete. Every game's `getResult` is a pure read of its own state (`docs/05` — no clock, no
   * randomness), so asking early is always safe; it is the caller's job to decide whether an
   * unfinished scoreline means anything. Built for a deliberate concession — "give the points to
   * the other player" needs the real board, not `result()`'s `null` for a match still in progress.
   */
  currentResult(): GameResult;
  /** Drops the timer. The match is over, one way or another. */
  stop(): void;
}

/**
 * Server-held randomness (`docs/04` section 10, `docs/13` section 8).
 *
 * From `node:crypto` rather than `Math.random`, because the delay before a round goes live is the
 * only thing standing between this game and someone timing the interval. A predictable wait is not
 * a reaction test.
 */
const cryptoRandom: GameContext['random'] = () => randomInt(0, 2 ** 31) / 2 ** 31;

export interface MatchOptions {
  rules: AnyGameRules;
  emitter: MatchEmitter;
  /** Overridden in tests so a whole match can be played out with a known sequence. */
  random?: GameContext['random'];
  now?: () => number;
}

export function startMatch({
  rules,
  emitter,
  random = cryptoRandom,
  now = () => Date.now(),
}: MatchOptions): RunningMatch {
  const context: GameContext = { random };

  let state: unknown = rules.createMatch(now(), context);
  let timer: NodeJS.Timeout | undefined;
  let completed = false;

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  /**
   * Arms the one timer the rules asked for.
   *
   * One timer, not a poll: the rules say when they next need the clock, and nothing runs in between.
   * A game that wants nothing is a game with no timer at all.
   *
   * The floor of one millisecond is not decoration. Node may run a timer a hair *before* its
   * deadline, and a tick that arrives early finds nothing to do — so the delay has to be recomputed
   * and the timer re-armed rather than treated as "the game is waiting on a player now". Getting
   * this wrong stops the clock for good, which on screen is two people staring at a round that
   * never starts.
   */
  function schedule(): void {
    clearTimer();
    if (completed) return;

    const at = rules.nextTickAt(state);
    if (at === null || !Number.isFinite(at)) return;

    timer = setTimeout(runTick, Math.max(1, at - now()));
  }

  function runTick(): void {
    timer = undefined;

    // Scheduled in a `finally`, so a listener that throws on the way out cannot take the match's
    // clock down with it. Losing one frame is recoverable — every event carries the whole state, so
    // the next one puts the client right. Losing the clock is not.
    try {
      apply(rules.tick(state, now(), context));
    } finally {
      schedule();
    }
  }

  function apply(transition: Transition<unknown>): void {
    state = transition.state;

    for (const event of transition.events) emitter.emit(event.type, event.to);

    if (!completed && rules.isComplete(state)) {
      completed = true;
      clearTimer();
      emitter.onComplete(rules.getResult(state));
    }
  }

  schedule();

  return {
    slug: rules.meta.slug,

    get complete() {
      return completed;
    },

    viewFor(player) {
      return rules.getView(state, player);
    },

    turnOf() {
      // A finished match is waiting on nobody, whatever the rules still hold about whose turn it
      // technically was. Nothing should be under a clock while its result is on screen.
      return completed ? null : rules.turnOf(state);
    },

    submitAction(player, action, at) {
      if (completed) {
        throw new SessionError('invalid_game_state', 'That game is already over.');
      }

      // Nothing reaches the rules' state without passing their own validation first. The platform
      // deliberately does not inspect the action: it cannot know what a legal one looks like.
      const validation = rules.validateAction(state, player, action);
      if (!validation.ok) throw new SessionError(validation.code, validation.message);

      try {
        apply(rules.applyAction(state, player, validation.action, at, context));
      } finally {
        // Same reasoning as `runTick`: an action that moves the game on must leave a timer behind
        // it, whatever happened while telling the players about it.
        schedule();
      }
    },

    pause() {
      if (completed) return;
      clearTimer();
      state = rules.pause(state, now());
    },

    resume() {
      if (completed) return;
      apply(rules.resume(state, now(), context));
      schedule();
    },

    result() {
      return completed ? rules.getResult(state) : null;
    },

    currentResult() {
      return rules.getResult(state);
    },

    stop() {
      clearTimer();
    },
  };
}
