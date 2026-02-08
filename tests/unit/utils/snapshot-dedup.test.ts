/**
 * Tests for snapshot deduplication utility.
 */

import { describe, it, expect } from 'vitest';
import { deduplicateByDate } from '@/shared/utils/snapshot-dedup';

interface TestSnap {
  date: string;
  scannedAt: Date;
  value: number;
}

function makeSnap(date: string, hour: number, value: number): TestSnap {
  return { date, scannedAt: new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`), value };
}

describe('deduplicateByDate', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateByDate([])).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const snap = makeSnap('2026-01-01', 10, 5);
    const result = deduplicateByDate([snap]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(snap);
  });

  it('keeps latest scannedAt when multiple snapshots share same date', () => {
    const morning = makeSnap('2026-01-01', 9, 10);
    const evening = makeSnap('2026-01-01', 17, 5);

    const result = deduplicateByDate([morning, evening]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(5);
  });

  it('preserves snapshots from different dates', () => {
    const day1 = makeSnap('2026-01-01', 10, 5);
    const day2 = makeSnap('2026-01-02', 10, 3);

    const result = deduplicateByDate([day1, day2]);
    expect(result).toHaveLength(2);
  });

  it('handles mix of duplicate and unique dates', () => {
    const snaps = [
      makeSnap('2026-01-01', 9, 10),
      makeSnap('2026-01-01', 17, 5),
      makeSnap('2026-01-02', 10, 3),
      makeSnap('2026-01-03', 8, 7),
      makeSnap('2026-01-03', 20, 2),
    ];

    const result = deduplicateByDate(snaps);
    expect(result).toHaveLength(3);

    const byDate = new Map(result.map((s) => [s.date, s]));
    expect(byDate.get('2026-01-01')!.value).toBe(5);  // evening
    expect(byDate.get('2026-01-02')!.value).toBe(3);
    expect(byDate.get('2026-01-03')!.value).toBe(2);  // 8pm
  });

  it('does not mutate input array', () => {
    const snaps = [
      makeSnap('2026-01-01', 9, 10),
      makeSnap('2026-01-01', 17, 5),
    ];
    const original = [...snaps];
    deduplicateByDate(snaps);
    expect(snaps).toEqual(original);
  });
});
