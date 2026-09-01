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
 * Convert a Unix timestamp (seconds) to a YYYY-MM-DD string.
 * Returns an empty string for non-positive/invalid input.
 */
export function epochToDateString(epochSeconds: number): string {
  if (!epochSeconds || epochSeconds <= 0) return '';
  return toDateString(new Date(epochSeconds * 1000));
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

/**
 * Format a Date relative to today: "Today, 3:04 PM", "Yesterday, 9:12 AM", or
 * "Mar 4, 9:12 AM" for anything further out.
 */
export function formatRelativeDateTime(date: Date): string {
  if (isNaN(date.getTime())) return 'Unknown';

  const now = new Date();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((dateStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return `Today, ${timeStr}`;
  if (diffDays === -1) return `Yesterday, ${timeStr}`;
  if (diffDays === 1) return `Tomorrow, ${timeStr}`;

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
}

// ---------------------------------------------------------------------------
// Observation windows
// ---------------------------------------------------------------------------

/**
 * Format a Date as a compact local "MMM D HH:MM" label (e.g. "Jul 10 11:47").
 */
export function formatDateTimeShort(date: Date): string {
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${month} ${day} ${hh}:${mm}`;
}

/**
 * Width of an observation window in hours, rounded to one decimal.
 *
 * This is the number that tells a reader whether a latency question can be
 * answered at all: a 24h window cannot support "the rank moved 3 hours after
 * the title changed".
 */
export function windowHours(from: Date, to: Date): number {
  const diffMs = Math.abs(to.getTime() - from.getTime());
  return Math.round((diffMs / 3_600_000) * 10) / 10;
}

/**
 * Render an observation window as "Jul 10 11:47 → Jul 13 14:49".
 *
 * A change observed by polling is only ever known to have happened *between*
 * the last sighting of the old value and the first sighting of the new one.
 */
export function formatObservationWindow(from: Date, to: Date): string {
  return `${formatDateTimeShort(from)} → ${formatDateTimeShort(to)}`;
}

/**
 * Human-readable window width, e.g. "~45m", "~7.5h", "~2.1d".
 *
 * Each unit is derived from the raw millisecond difference rather than from
 * `windowHours`, whose one-decimal rounding would distort the smaller units
 * (45 minutes is 0.75h, which rounds to 0.8h and back out to 48 minutes).
 */
export function formatWindowWidth(from: Date, to: Date): string {
  const diffMs = Math.abs(to.getTime() - from.getTime());
  const hours = diffMs / 3_600_000;
  if (hours < 1) return `~${Math.round(diffMs / 60_000)}m`;
  if (hours < 48) return `~${Math.round(hours * 10) / 10}h`;
  return `~${Math.round((diffMs / 86_400_000) * 10) / 10}d`;
}
