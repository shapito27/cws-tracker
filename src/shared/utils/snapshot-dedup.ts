/**
 * Utility for deduplicating snapshots by date.
 *
 * When multiple scans occur on the same day, keeps only the snapshot
 * with the latest scannedAt timestamp per date.
 *
 * Retained as the established name for this operation; the implementation now
 * lives in `daily-rollup.ts` alongside the per-day statistics that the intraday
 * view needs, so there is a single definition of "the day's value".
 */

import { pickLatestPerDate, type DatedSample } from './daily-rollup';

/**
 * Deduplicate snapshots by date, keeping the latest scannedAt per day.
 * Returns a new array (does not mutate input), ascending by date.
 */
export function deduplicateByDate<T extends DatedSample>(snapshots: T[]): T[] {
  return pickLatestPerDate(snapshots);
}
