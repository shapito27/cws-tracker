/**
 * Utility for deduplicating snapshots by date.
 *
 * When multiple scans occur on the same day, keeps only the snapshot
 * with the latest scannedAt timestamp per date.
 */

interface HasDateAndScannedAt {
  date: string;
  scannedAt: Date;
}

/**
 * Deduplicate snapshots by date, keeping the latest scannedAt per day.
 * Returns a new array (does not mutate input).
 */
export function deduplicateByDate<T extends HasDateAndScannedAt>(
  snapshots: T[]
): T[] {
  const byDate = new Map<string, T>();
  for (const snap of snapshots) {
    const existing = byDate.get(snap.date);
    if (!existing || snap.scannedAt > existing.scannedAt) {
      byDate.set(snap.date, snap);
    }
  }
  return [...byDate.values()];
}
