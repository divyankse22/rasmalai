import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyGameRules, GameResult } from '@rasmalai/games';
import { startMatch, type MatchEmitter } from './matchRunner';
import { SessionError } from './sessionError';

/**
 * The platform's half of a match: the clock, the timer, and the refusals.
 *
 * Played against a deliberately minimal game rather than a real one, so a failure here is a failure
 * of the runner and never of a rulebook. Reaction Speed exercises the same code with real rules in
 * `sessionRegistry.test.ts`.
 */

interface TinyState {
  liveAt: number;
  live: boolean;
  moves: number;
  done: boolean;
}

const RESULT: GameResult = { winner: 0, draw: false, scores: [1, 0] };

function tinyRules(overrides: Partial<AnyGameRules> = {}): AnyGameRules {
  const rules: AnyGameRules = {
    meta: {
      slug: 'tiny',
      name: 'Tiny',
      category: 'competitive',
      scoringKind: 'competitive',
      renderer: 'react',
      players: 2,
      orientation: 'any',
      inputs: ['tap'],
      // Required on every game, so a stand-in rulebook needs one too. The runner never reads it.
      howToPlay: { tagline: 'A tiny game.', steps: ['Tap.', 'Tap again.', 'Stop.'] },
    },
    reconnectPolicy: { windowMs: 120_000, pauseOnDisconnect: true, onExpire: 'forfeit' },

    createMatch: (now) => ({ liveAt: now + 1_000, live: false, moves: 0, done: false }) as TinyState,

    nextTickAt: (state) => {
      const tiny = state as TinyState;
      return tiny.done || tiny.live ? null : tiny.liveAt;
    },

    tick: (state, now) => {
      const tiny = state as TinyState;
      // The shape every real rulebook uses: nothing to do yet means the *same* state back.
      if (tiny.done || tiny.live || now < tiny.liveAt) return { state: tiny, events: [] };
      return { state: { ...tiny, live: true }, events: [{ type: 'game.round.started' }] };
    },

    validateAction: (_state, _player, action) =>
      action === 'go'
        ? { ok: true, action }
        : { ok: false, code: 'invalid_action', message: 'No.' },

    applyAction: (state) => {
      const tiny = state as TinyState;
      const moves = tiny.moves + 1;
      return {
        state: { ...tiny, moves, done: moves >= 2 },
        events: [{ type: 'game.state.updated' }],
      };
    },

    // Waiting on the clock, never on a person, so nobody is ever on a move clock here.
    turnOf: () => null,
    pause: (state) => state,
    resume: (state) => ({ state, events: [] }),
    getView: (state) => state,
    isComplete: (state) => (state as TinyState).done,
    getResult: () => RESULT,
    ...overrides,
  };

  return rules;
}

let events: { type: string; to?: number }[];
let completed: GameResult | null;

const emitter: MatchEmitter = {
  emit(type, to) {
    events.push(to === undefined ? { type } : { type, to });
  },
  onComplete(result) {
    completed = result;
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  completed = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the match clock', () => {
  it('fires the tick the rules asked for', () => {
    startMatch({ rules: tinyRules(), emitter });

    vi.advanceTimersByTime(999);
    expect(events).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(events).toEqual([{ type: 'game.round.started' }]);
  });

  it('survives a tick that arrives before its own moment', () => {
    // Node does not promise a timer runs *after* its deadline; it can be a hair early. A tick that
    // arrives early finds nothing to do and hands back the state unchanged — and treating that as
    // "the game is waiting on a player now" is what once stopped a live match dead, with both
    // players watching a round that never started.
    //
    // Reproduced here without lying about the clock: a uniform offset would cancel itself out. This
    // rulebook simply is not ready at the moment it asked to be woken, which is the same thing from
    // the runner's side.
    const late = tinyRules({
      tick: (state, now) => {
        const tiny = state as TinyState;
        if (tiny.done || tiny.live || now < tiny.liveAt + 2) return { state: tiny, events: [] };
        return { state: { ...tiny, live: true }, events: [{ type: 'game.round.started' }] };
      },
    });

    startMatch({ rules: late, emitter });

    vi.advanceTimersByTime(1_000);
    expect(events).toEqual([]);

    // The runner must have re-armed rather than given up.
    vi.advanceTimersByTime(5);
    expect(events).toEqual([{ type: 'game.round.started' }]);
  });

  it('keeps the clock when telling a player goes wrong', () => {
    const angry: MatchEmitter = {
      emit() {
        throw new Error('socket exploded');
      },
      onComplete(result) {
        completed = result;
      },
    };

    const match = startMatch({ rules: tinyRules(), emitter: angry });

    // The throw escapes this tick, but the timer behind it must still be armed.
    expect(() => vi.advanceTimersByTime(1_000)).toThrow();
    expect(match.complete).toBe(false);
    expect(() => match.submitAction(0, 'go', { receivedAt: Date.now(), compensationMs: 0 })).toThrow(
      'socket exploded',
    );
    // Still usable: the state advanced even though the announcement did not.
    expect((match.viewFor(0) as TinyState).moves).toBe(1);
  });

  it('stops the clock once the game is over', () => {
    const match = startMatch({ rules: tinyRules(), emitter });
    const at = { receivedAt: Date.now(), compensationMs: 0 };

    match.submitAction(0, 'go', at);
    match.submitAction(1, 'go', at);

    expect(match.complete).toBe(true);
    expect(completed).toEqual(RESULT);
    expect(match.result()).toEqual(RESULT);

    // Nothing left running, and nothing further accepted.
    vi.advanceTimersByTime(60_000);
    expect(events.filter((event) => event.type === 'game.round.started')).toHaveLength(0);
    expect(() => match.submitAction(0, 'go', at)).toThrow(
      expect.objectContaining({ code: 'invalid_game_state' }),
    );
  });
});

describe('currentResult', () => {
  it('reads getResult early, before the match is actually complete', () => {
    const match = startMatch({ rules: tinyRules(), emitter });

    // `result()` is null this early — nothing to see, the match is not over. `currentResult()`
    // answers anyway: `getResult` is a pure read of state, so asking early is always safe.
    expect(match.result()).toBeNull();
    expect(match.currentResult()).toEqual(RESULT);
  });

  it('still answers once the match actually is complete, and agrees with result()', () => {
    const match = startMatch({ rules: tinyRules(), emitter });
    const at = { receivedAt: Date.now(), compensationMs: 0 };
    match.submitAction(0, 'go', at);
    match.submitAction(1, 'go', at);

    expect(match.currentResult()).toEqual(match.result());
  });
});

describe('actions', () => {
  it('passes the game’s refusal through as a session error', () => {
    const match = startMatch({ rules: tinyRules(), emitter });

    expect(() => match.submitAction(0, 'nope', { receivedAt: Date.now(), compensationMs: 0 })).toThrow(
      SessionError,
    );
    expect((match.viewFor(0) as TinyState).moves).toBe(0);
  });

  it('sends a seat-addressed event to that seat only', () => {
    const match = startMatch({
      rules: tinyRules({
        applyAction: (state) => ({
          state,
          events: [{ type: 'game.state.updated', to: 1 }],
        }),
      }),
      emitter,
    });

    match.submitAction(1, 'go', { receivedAt: Date.now(), compensationMs: 0 });
    expect(events).toEqual([{ type: 'game.state.updated', to: 1 }]);
  });
});

describe('pausing', () => {
  it('drops the timer while a player is missing, and picks it up again', () => {
    const match = startMatch({ rules: tinyRules(), emitter });

    match.pause();
    vi.advanceTimersByTime(10_000);
    expect(events).toEqual([]);

    match.resume();
    // `liveAt` is in the past by now, so the re-armed timer fires almost immediately.
    vi.advanceTimersByTime(5);
    expect(events).toEqual([{ type: 'game.round.started' }]);
  });

  it('does nothing to a finished match', () => {
    const match = startMatch({ rules: tinyRules(), emitter });
    const at = { receivedAt: Date.now(), compensationMs: 0 };
    match.submitAction(0, 'go', at);
    match.submitAction(1, 'go', at);

    match.pause();
    match.resume();
    expect(match.complete).toBe(true);
  });
});

describe('the default clock', () => {
  /**
   * Slice-11 amendment (fix 1): `now` used to default to `Date.now` itself — a *reference*,
   * resolved once, the moment `startMatch` is called. `createIntegrationContext()` builds the
   * session registry that calls `startMatch` before `vi.useFakeTimers()` runs in every integration
   * test, so that reference stayed pinned to the real clock forever, while `vi.advanceTimersByTime`
   * moved a *different* clock this code never looked at again — and a game's timer never fired.
   *
   * Reproduced here without a whole integration harness: `Date.now` is stood in for only across the
   * `startMatch` call, then restored before anything is exercised. `setTimeout` is the fake one for
   * the whole test either way (this file's `beforeEach` installs it before every test), so swapping
   * only `Date.now` isolates its identity as the one variable under test. A lazy `() => Date.now()`
   * default picks the restored clock straight back up; a captured `Date.now` reference does not,
   * and the round the tick is meant to start never starts.
   */
  it('tracks a clock installed after the match was constructed, not the one live when it was built', () => {
    const fakeClock = Date.now;
    const frozenAt = fakeClock();
    Date.now = () => frozenAt;

    const localEvents: { type: string }[] = [];
    startMatch({
      rules: tinyRules(),
      emitter: {
        emit(type) {
          localEvents.push({ type });
        },
        onComplete() {},
      },
    });

    // The clock a real caller sees from here on.
    Date.now = fakeClock;

    // `tinyRules()` goes live one second after it was built (`liveAt: now + 1_000`) — a lazy default
    // measures that second on whichever clock is live when it comes due, not the one that was live
    // when the match was constructed.
    vi.advanceTimersByTime(1_000);

    expect(localEvents).toEqual([{ type: 'game.round.started' }]);
  });
});
