import { describe, expect, it } from 'vitest';
import {
  applyToGameStats,
  applyToLifetime,
  durationSeconds,
  EMPTY_GAME_STATS_ROW,
  EMPTY_LIFETIME_ROW,
  type CompletedMatch,
  type GameStatsRow,
  type LifetimeRow,
} from './matchStatistics';

/**
 * The formulas `docs/03_DATABASE_SCHEMA.md` asks to have validated before anything relies on them,
 * and the streak calculation `docs/09_TESTING_STRATEGY.md` asks for by name.
 *
 * Everything here is a couple's whole history replayed match by match, because a streak is not a
 * property of one match — it is what the last few did to each other.
 */

const REACTION = 'game-reaction';
const CONNECT = 'game-connect';

const at = (iso: string) => new Date(iso);

function match(overrides: Partial<CompletedMatch> = {}): CompletedMatch {
  return {
    gameId: REACTION,
    competitive: true,
    byForfeit: false,
    scoreA: 3,
    scoreB: 2,
    winner: 'a',
    durationSeconds: 60,
    endedAt: at('2026-08-16T12:00:00Z'),
    ...overrides,
  };
}

/** Plays a whole history through, in order, which is the only way a streak means anything. */
const playLifetime = (history: readonly CompletedMatch[]): LifetimeRow =>
  history.reduce(applyToLifetime, EMPTY_LIFETIME_ROW);

const playGame = (history: readonly CompletedMatch[]): GameStatsRow =>
  history.reduce(applyToGameStats, EMPTY_GAME_STATS_ROW);

describe('lifetime totals', () => {
  it('counts a competitive win to the winner and nobody else', () => {
    const row = playLifetime([match({ winner: 'a' })]);

    expect(row.totalGames).toBe(1);
    expect(row.competitiveGames).toBe(1);
    expect(row.userAWins).toBe(1);
    expect(row.userBWins).toBe(0);
    expect(row.draws).toBe(0);
  });

  it('adds every match to time played, whatever it scored', () => {
    const row = playLifetime([
      match({ durationSeconds: 90 }),
      match({ competitive: false, winner: null, durationSeconds: 30 }),
    ]);

    expect(row.totalTimePlayedSeconds).toBe(120);
  });

  it('leaves the sane-counts constraint satisfiable: every competitive match is a win or a draw', () => {
    const row = playLifetime([
      match({ winner: 'a' }),
      match({ winner: 'b' }),
      match({ winner: null, scoreA: 2, scoreB: 2 }),
      match({ competitive: false, winner: null }),
    ]);

    expect(row.totalGames).toBe(4);
    expect(row.competitiveGames).toBe(3);
    expect(row.userAWins + row.userBWins + row.draws).toBe(row.competitiveGames);
  });
});

describe('P-3: only competitive games are won', () => {
  it('counts a cooperative match as played and as nothing else', () => {
    const row = playLifetime([match({ competitive: false, winner: null, durationSeconds: 45 })]);

    expect(row.totalGames).toBe(1);
    expect(row.totalTimePlayedSeconds).toBe(45);
    expect(row.competitiveGames).toBe(0);
    expect(row.draws).toBe(0);
    expect(row.userAWins).toBe(0);
    expect(row.closestMatchMargin).toBeNull();
  });

  it('never lets a cooperative result end a competitive streak', () => {
    const row = playLifetime([
      match({ winner: 'a' }),
      match({ winner: 'a' }),
      match({ competitive: false, winner: null }),
    ]);

    expect(row.userACurrentStreak).toBe(2);
  });

  it('records a cooperative game as played without touching its win counters or best scores', () => {
    const row = playGame([
      match({ competitive: false, winner: null, scoreA: 9, scoreB: 9, durationSeconds: 20 }),
    ]);

    expect(row.plays).toBe(1);
    expect(row.totalTimePlayedSeconds).toBe(20);
    expect(row.userAWins).toBe(0);
    expect(row.draws).toBe(0);
    expect(row.marginSamples).toBe(0);
    // A cooperative high score has nowhere to live yet — P-3 says "touch nothing else", and the
    // best-score columns are part of "nothing else".
    expect(row.userABestScore).toBeNull();
  });
});

describe('streaks', () => {
  it('extends with each win and ends the other side', () => {
    const row = playLifetime([
      match({ winner: 'a' }),
      match({ winner: 'a' }),
      match({ winner: 'a' }),
    ]);

    expect(row.userACurrentStreak).toBe(3);
    expect(row.userALongestStreak).toBe(3);
    expect(row.userBCurrentStreak).toBe(0);
  });

  it('resets the loser and keeps their high-water mark', () => {
    const row = playLifetime([
      match({ winner: 'a' }),
      match({ winner: 'a' }),
      match({ winner: 'b' }),
    ]);

    expect(row.userACurrentStreak).toBe(0);
    expect(row.userALongestStreak).toBe(2);
    expect(row.userBCurrentStreak).toBe(1);
    expect(row.userBLongestStreak).toBe(1);
  });

  it('resets both on a draw, because a draw is not a win', () => {
    const row = playLifetime([
      match({ winner: 'a' }),
      match({ winner: 'a' }),
      match({ winner: null, scoreA: 2, scoreB: 2 }),
    ]);

    expect(row.userACurrentStreak).toBe(0);
    expect(row.userBCurrentStreak).toBe(0);
    expect(row.userALongestStreak).toBe(2);
    expect(row.draws).toBe(1);
  });

  it('remembers the best run after several of them', () => {
    const row = playLifetime([
      match({ winner: 'a' }),
      match({ winner: 'a' }),
      match({ winner: 'a' }),
      match({ winner: 'a' }),
      match({ winner: 'b' }),
      match({ winner: 'a' }),
      match({ winner: 'a' }),
    ]);

    expect(row.userACurrentStreak).toBe(2);
    expect(row.userALongestStreak).toBe(4);
  });
});

describe('the closest match ever played', () => {
  it('starts unset and takes the first competitive margin', () => {
    const row = playLifetime([
      match({ scoreA: 5, scoreB: 1, endedAt: at('2026-01-01T00:00:00Z') }),
    ]);

    expect(row.closestMatchMargin).toBe(4);
    expect(row.closestMatchGameId).toBe(REACTION);
    expect(row.closestMatchAt).toEqual(at('2026-01-01T00:00:00Z'));
  });

  it('only moves for something strictly closer', () => {
    const row = playLifetime([
      match({ scoreA: 5, scoreB: 3 }),
      match({ gameId: CONNECT, scoreA: 4, scoreB: 3, endedAt: at('2026-02-02T00:00:00Z') }),
      match({ scoreA: 5, scoreB: 0 }),
    ]);

    expect(row.closestMatchMargin).toBe(1);
    expect(row.closestMatchGameId).toBe(CONNECT);
    expect(row.closestMatchAt).toEqual(at('2026-02-02T00:00:00Z'));
  });

  it('leaves an equal margin alone, so the dashboard does not reshuffle its own answer', () => {
    const row = playLifetime([
      match({ scoreA: 3, scoreB: 2, endedAt: at('2026-03-03T00:00:00Z') }),
      match({ gameId: CONNECT, scoreA: 1, scoreB: 0, endedAt: at('2026-04-04T00:00:00Z') }),
    ]);

    expect(row.closestMatchMargin).toBe(1);
    expect(row.closestMatchGameId).toBe(REACTION);
    expect(row.closestMatchAt).toEqual(at('2026-03-03T00:00:00Z'));
  });

  it('counts a draw as the closest a match can get', () => {
    const row = playLifetime([
      match({ scoreA: 3, scoreB: 2 }),
      match({ winner: null, scoreA: 2, scoreB: 2 }),
    ]);

    expect(row.closestMatchMargin).toBe(0);
  });
});

describe('a forfeit counts as a win and nothing more', () => {
  const forfeit = match({ byForfeit: true, winner: 'b', scoreA: 0, scoreB: 1 });

  it('is played, won, and part of a streak', () => {
    const row = playLifetime([forfeit]);

    expect(row.totalGames).toBe(1);
    expect(row.competitiveGames).toBe(1);
    expect(row.userBWins).toBe(1);
    expect(row.userBCurrentStreak).toBe(1);
  });

  it('never becomes the closest match, even though 1-0 would beat everything else', () => {
    const row = playLifetime([match({ scoreA: 5, scoreB: 2 }), forfeit]);

    expect(row.closestMatchMargin).toBe(3);
    expect(row.closestMatchGameId).toBe(REACTION);
  });

  it('feeds no margin sample and no best score', () => {
    const row = playGame([forfeit]);

    expect(row.plays).toBe(1);
    expect(row.userBWins).toBe(1);
    expect(row.marginTotal).toBe(0);
    expect(row.marginSamples).toBe(0);
    expect(row.userABestScore).toBeNull();
    expect(row.userBBestScore).toBeNull();
  });

  it('still ends the other side of a streak', () => {
    const row = playLifetime([match({ winner: 'a' }), match({ winner: 'a' }), forfeit]);

    expect(row.userACurrentStreak).toBe(0);
    expect(row.userALongestStreak).toBe(2);
  });
});

describe('per-game counters', () => {
  it('accumulates margins as a sum and a count, so the average survives retention', () => {
    const row = playGame([
      match({ scoreA: 5, scoreB: 3 }),
      match({ scoreA: 4, scoreB: 4, winner: null }),
      match({ scoreA: 2, scoreB: 5, winner: 'b' }),
    ]);

    expect(row.plays).toBe(3);
    expect(row.marginSamples).toBe(3);
    expect(row.marginTotal).toBe(2 + 0 + 3);
    expect(row.marginTotal / row.marginSamples).toBeCloseTo(1.67, 2);
  });

  it('keeps each partner best score, and only their own', () => {
    const row = playGame([
      match({ scoreA: 5, scoreB: 1 }),
      match({ scoreA: 2, scoreB: 4, winner: 'b' }),
    ]);

    expect(row.userABestScore).toBe(5);
    expect(row.userBBestScore).toBe(4);
  });

  it('accepts a zero as a best score rather than reading it as no score at all', () => {
    const row = playGame([match({ scoreA: 1, scoreB: 0 })]);

    expect(row.userBBestScore).toBe(0);
  });

  it('counts wins, losses and draws for the one game', () => {
    const row = playGame([
      match({ winner: 'a' }),
      match({ winner: 'b' }),
      match({ winner: null, scoreA: 1, scoreB: 1 }),
    ]);

    expect(row.userAWins).toBe(1);
    expect(row.userBWins).toBe(1);
    expect(row.draws).toBe(1);
  });
});

describe('duration', () => {
  it('is wall clock, to the nearest second', () => {
    expect(durationSeconds(at('2026-08-16T12:00:00.000Z'), at('2026-08-16T12:01:30.400Z'))).toBe(
      90,
    );
  });

  it('never goes negative, whatever a clock adjustment does', () => {
    expect(durationSeconds(at('2026-08-16T12:00:00Z'), at('2026-08-16T11:59:00Z'))).toBe(0);
  });
});
