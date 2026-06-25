/**
 * Date utilities (Phase 1.5.3).
 *
 * All date strings use the YYYY-MM-DD format, consistent with the
 * IndexedDB indexed date convention used throughout CWS Tracker.
 */

/**
 * Format a Date object as a YYYY-MM-DD string (using local calendar fields).
 *
 * Exported so callers can derive a date string from an explicit `Date` —
 * e.g. the scheduler computing "today" from an injectable `now` for
 * deterministic catch-up logic, instead of always reading the wall clock.
 */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns today's date as a YYYY-MM-DD string.
 */
export function today(): string {
  return toDateString(new Date());
}

/**
 * Returns the date `n` days ago as a YYYY-MM-DD string.
 *
 * `daysAgo(0)` is equivalent to `today()`.
 */
export function daysAgo(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return toDateString(date);
}

/**
 * Returns `true` if the given YYYY-MM-DD string matches today's date.
 */
export function isToday(dateStr: string): boolean {
  return dateStr === today();
}

/**
 * Returns the number of days between two YYYY-MM-DD date strings.
 *
 * The result is always a non-negative number (absolute difference).
 */
export function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  const diffMs = Math.abs(a.getTime() - b.getTime());
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
