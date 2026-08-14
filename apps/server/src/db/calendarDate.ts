/**
 * Formats a Postgres `date` as the calendar day it actually is.
 *
 * node-postgres hands a `date` column back as a JS Date at **local** midnight. Calling
 * `.toISOString()` on it converts to UTC, so anywhere east of Greenwich the day rolls backwards:
 * in IST, 2021-03-14 becomes "2021-03-13". That would quietly make "days together" wrong by one,
 * and wrong by a different amount depending on where each partner is.
 *
 * Reading the local components instead keeps the calendar day intact, which is the only thing a
 * date column ever meant.
 */
export function formatCalendarDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
