import { describe, expect, it } from 'vitest';
import {
  daysTogether,
  favouriteGame,
  mostCompetitiveGame,
  winPercentage,
  type GameCounters,
} from './summary';

function counters(overrides: Partial<GameCounters> & { slug: string }): GameCounters {
  return {
    name: overrides.slug,
    scoringKind: 'competitive',
    plays: 0,
    marginTotal: 0,
    marginSamples: 0,
    ...overrides,
  };
}

describe('daysTogether', () => {
  const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it('counts the day they met as day zero', () => {
    expect(daysTogether('2024-05-01', on('2024-05-01'))).toBe(0);
  });

  it('counts whole calendar days since', () => {
    expect(daysTogether('2024-05-01', on('2024-05-02'))).toBe(1);
    expect(daysTogether('2024-05-01', on('2024-06-01'))).toBe(31);
  });

  it('counts across a leap day', () => {
    expect(daysTogether('2024-02-28', on('2024-03-01'))).toBe(2);
  });

  it('counts across years', () => {
    expect(daysTogether('2021-03-14', on('2026-08-15'))).toBe(1980);
  });

  it('ignores the time of day, so the number does not change as the day goes on', () => {
    const early = daysTogether('2024-05-01', new Date('2024-06-01T00:00:01Z'));
    const late = daysTogether('2024-05-01', new Date('2024-06-01T23:59:59Z'));
    expect(early).toBe(late);
  });

  it('never reads as negative when the date is somehow in the future', () => {
    expect(daysTogether('2030-01-01', on('2026-08-15'))).toBe(0);
  });

  it('falls back to zero rather than NaN on an unusable date', () => {
    expect(daysTogether('not-a-date', on('2026-08-15'))).toBe(0);
  });
});

describe('winPercentage', () => {
  it('is zero before anything has been played, rather than NaN', () => {
    expect(winPercentage(0, 0)).toBe(0);
  });

  it('is a whole percent of competitive games played', () => {
    expect(winPercentage(3, 4)).toBe(75);
    expect(winPercentage(1, 3)).toBe(33);
  });

  it('leaves room for draws, so both partners plus draws account for every match', () => {
    // 5 competitive games: 2 each and one draw.
    expect(winPercentage(2, 5) + winPercentage(2, 5) + winPercentage(1, 5)).toBe(100);
  });
});

describe('favouriteGame', () => {
  it('is null with nothing played', () => {
    expect(favouriteGame([counters({ slug: 'reflex' }), counters({ slug: 'memory' })])).toBeNull();
  });

  it('is the most played game', () => {
    const result = favouriteGame([
      counters({ slug: 'reflex', plays: 2 }),
      counters({ slug: 'memory', plays: 9 }),
      counters({ slug: 'drawing', plays: 4 }),
    ]);
    expect(result).toEqual({ gameSlug: 'memory', gameName: 'memory', plays: 9 });
  });

  it('counts any category, not just competitive ones', () => {
    const result = favouriteGame([
      counters({ slug: 'reflex', plays: 3 }),
      counters({ slug: 'drawing', scoringKind: 'casual', plays: 8 }),
    ]);
    expect(result?.gameSlug).toBe('drawing');
  });

  it('breaks ties the same way every time, so it does not flicker between refreshes', () => {
    const games = [counters({ slug: 'reflex', plays: 4 }), counters({ slug: 'memory', plays: 4 })];
    expect(favouriteGame(games)?.gameSlug).toBe('reflex');
    expect(favouriteGame([...games].reverse())?.gameSlug).toBe('memory');
  });
});

describe('mostCompetitiveGame', () => {
  it('is null before any competitive match has finished', () => {
    expect(mostCompetitiveGame([counters({ slug: 'reflex', plays: 3 })])).toBeNull();
  });

  it('is the game with the smallest average margin', () => {
    const result = mostCompetitiveGame([
      // Blowouts: 10 across 2 matches.
      counters({ slug: 'basketball', plays: 2, marginTotal: 10, marginSamples: 2 }),
      // Nail-biters: 3 across 3 matches.
      counters({ slug: 'four-in-a-row', plays: 3, marginTotal: 3, marginSamples: 3 }),
    ]);
    expect(result).toEqual({
      gameSlug: 'four-in-a-row',
      gameName: 'four-in-a-row',
      averageMargin: 1,
    });
  });

  it('ignores non-competitive games even when they have samples', () => {
    const result = mostCompetitiveGame([
      counters({ slug: 'basketball', marginTotal: 8, marginSamples: 2 }),
      counters({ slug: 'survival', scoringKind: 'cooperative', marginTotal: 0, marginSamples: 5 }),
    ]);
    expect(result?.gameSlug).toBe('basketball');
  });

  it('keeps two decimals, so a close average is not rounded into a wider one', () => {
    const result = mostCompetitiveGame([
      counters({ slug: 'reflex', marginTotal: 3, marginSamples: 2 }),
    ]);
    expect(result?.averageMargin).toBe(1.5);
  });
});
