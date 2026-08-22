import { describe, expect, it } from 'vitest';
import { formatCalendarDate } from './calendarDate';

describe('formatCalendarDate', () => {
  it('keeps the calendar day when the driver returns local midnight', () => {
    // How node-postgres represents '2021-03-14'::date — month is zero-based.
    const fromDriver = new Date(2021, 2, 14);

    expect(formatCalendarDate(fromDriver)).toBe('2021-03-14');
  });

  it('does not roll backwards the way toISOString does east of Greenwich', () => {
    const fromDriver = new Date(2021, 2, 14);
    const naive = fromDriver.toISOString().slice(0, 10);

    // In a UTC+ timezone the naive version is a day early; ours must not be, wherever this runs.
    expect(formatCalendarDate(fromDriver)).toBe('2021-03-14');
    if (fromDriver.getTimezoneOffset() < 0) expect(naive).not.toBe('2021-03-14');
  });

  it('pads single-digit months and days', () => {
    expect(formatCalendarDate(new Date(2024, 0, 5))).toBe('2024-01-05');
  });

  it('handles a leap day', () => {
    expect(formatCalendarDate(new Date(2024, 1, 29))).toBe('2024-02-29');
  });

  it('does not roll over at the end of a month or a year', () => {
    expect(formatCalendarDate(new Date(2023, 11, 31))).toBe('2023-12-31');
    expect(formatCalendarDate(new Date(2024, 0, 1))).toBe('2024-01-01');
  });

  it('is not fooled by a time late in the day', () => {
    // A timestamptz read through the same helper must still name the local day, not tomorrow.
    expect(formatCalendarDate(new Date(2021, 2, 14, 23, 59, 59, 999))).toBe('2021-03-14');
  });

  it('passes a string through, taking only the date part', () => {
    expect(formatCalendarDate('2021-03-14')).toBe('2021-03-14');
    expect(formatCalendarDate('2021-03-14T00:00:00Z')).toBe('2021-03-14');
  });
});
