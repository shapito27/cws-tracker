/**
 * Date utilities (Phase 1.5.3).
 *
 * All date strings use the YYYY-MM-DD format, consistent with the
 * IndexedDB indexed date convention used throughout CWS Tracker.
 */

/**
 * Format a Date object as a YYYY-MM-DD string.
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns today's date as a YYYY-MM-DD string.
 */
export function today(): string {
  return formatDate(new Date());
}

/**
 * Returns the date `n` days ago as a YYYY-MM-DD string.
 *
 * `daysAgo(0)` is equivalent to `today()`.
 */
export function daysAgo(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return formatDate(date);
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
