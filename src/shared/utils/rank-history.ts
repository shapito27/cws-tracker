/**
 * Rank/autocomplete history lookback helpers.
 *
 * When the queue processor records a `position: null` snapshot for a tracked
 * extension that wasn't found in the response, a single gap day with a
 * partial scan can poison the next day's comparison: prev=null, curr=#1
 * naively reads as "extension just entered top 30" even though the same
 * extension was at #1 two days ago. These helpers look back through the
 * pair's history within a bounded window to find the most recent non-null
 * snapshot to use as the effective previous.
 *
 * Pure functions — safe to import from both the service worker and Vue
 * contexts.
 */

/**
 * When the immediately-prior snapshot has `position: null`, look back this
 * many days for a non-null snapshot to use as the effective previous.
 * Beyond this window, an absence is considered a real "gone from top 30"
 * gap and the subsequent re-appearance generates a legitimate "New" event.
 */
export const RANK_NULL_LOOKBACK_DAYS = 14;

/**
 * Day-difference between two YYYY-MM-DD strings (a - b). Positive when a > b.
 * Uses UTC midnights to sidestep DST edges.
 */
export function dayDiff(a: string, b: string): number {
  const aMs = new Date(a + 'T00:00:00Z').getTime();
  const bMs = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((aMs - bMs) / 86_400_000);
}

/**
 * If `immediatePrev` has a non-null position, returns it unchanged. If it
 * is `position: null`, scans `pairHistory` (ascending by date, all entries
 * for a single keyword/extension pair) for the most recent snapshot before
 * `currentDate` with a non-null position, within `lookbackDays` of
 * `currentDate`. Returns `immediatePrev` unchanged when no qualifying
 * snapshot exists.
 */
export function findEffectivePrevious<
  T extends { date: string; position: number | null }
>(
  pairHistory: readonly T[],
  immediatePrev: T | undefined,
  currentDate: string,
  lookbackDays: number = RANK_NULL_LOOKBACK_DAYS
): T | undefined {
  if (!immediatePrev || immediatePrev.position !== null) return immediatePrev;
  for (let i = pairHistory.length - 1; i >= 0; i--) {
    const candidate = pairHistory[i];
    if (candidate.position === null) continue;
    if (candidate.date >= currentDate) continue;
    if (dayDiff(currentDate, candidate.date) > lookbackDays) break;
    return candidate;
  }
  return immediatePrev;
}
