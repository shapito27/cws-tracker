/**
 * Tests for useRankings composable - chart data transformation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import { loadRankHistory } from '@/dashboard/composables/useRankings';
import type { Extension, RankSnapshot } from '@/shared/types';

const ext1: Extension = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.slice(0, 32),
  name: 'Extension A',
  iconUrl: null,
  addedAt: new Date(),
  lastScannedAt: null,
  status: 'active',
  projectRefs: [1],
};

// Generate valid 32-char IDs
const EXT_A_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EXT_B_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const extA: Extension = {
  id: EXT_A_ID,
  name: 'Extension A',
  iconUrl: null,
  addedAt: new Date(),
  lastScannedAt: null,
  status: 'active',
  projectRefs: [1],
};

const extB: Extension = {
  id: EXT_B_ID,
  name: 'Extension B',
  iconUrl: null,
  addedAt: new Date(),
  lastScannedAt: null,
  status: 'active',
  projectRefs: [1],
};

beforeEach(async () => {
  await db.rank_snapshots.clear();
  await db.extensions.clear();
  await db.saveExtension(extA);
  await db.saveExtension(extB);
});

function makeSnapshot(
  keywordId: number,
  extensionId: string,
  date: string,
  position: number | null
): RankSnapshot {
  return {
    keywordId,
    extensionId,
    date,
    position,
    totalResults: 30,
    scannedAt: new Date(),
  };
}

describe('loadRankHistory', () => {
  it('correctly transforms DB records into ApexCharts series', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 3),
    ]);

    const series = await loadRankHistory(1, [extA], '2026-01-01', '2026-01-02');

    expect(series).toHaveLength(1);
    expect(series[0].name).toBe('Extension A');
    expect(series[0].extensionId).toBe(EXT_A_ID);
    expect(series[0].data).toEqual([
      { x: '2026-01-01', y: 5 },
      { x: '2026-01-02', y: 3 },
    ]);
  });

  it('null positions are represented correctly in the series', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', null),
      makeSnapshot(1, EXT_A_ID, '2026-01-03', 8),
    ]);

    const series = await loadRankHistory(1, [extA], '2026-01-01', '2026-01-03');

    expect(series[0].data[1].y).toBeNull();
  });

  it('multiple extensions: one series per extension', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 3),
      makeSnapshot(1, EXT_B_ID, '2026-01-01', 7),
    ]);

    const series = await loadRankHistory(
      1,
      [extA, extB],
      '2026-01-01',
      '2026-01-01'
    );

    expect(series).toHaveLength(2);
    expect(series[0].extensionId).toBe(EXT_A_ID);
    expect(series[1].extensionId).toBe(EXT_B_ID);
  });

  it('date range filtering: only includes snapshots within range', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2025-12-31', 10),
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 3),
      makeSnapshot(1, EXT_A_ID, '2026-01-03', 8),
    ]);

    const series = await loadRankHistory(1, [extA], '2026-01-01', '2026-01-02');

    expect(series[0].data).toHaveLength(2);
    expect(series[0].data[0].x).toBe('2026-01-01');
    expect(series[0].data[1].x).toBe('2026-01-02');
  });

  it('empty result: returns empty series data', async () => {
    const series = await loadRankHistory(1, [extA], '2026-01-01', '2026-01-02');

    expect(series).toHaveLength(1);
    expect(series[0].data).toHaveLength(0);
  });

  it('uses extension ID as name if name is empty', async () => {
    const extNoName: Extension = {
      ...extA,
      id: EXT_A_ID,
      name: '',
    };

    const series = await loadRankHistory(
      1,
      [extNoName],
      '2026-01-01',
      '2026-01-02'
    );

    expect(series[0].name).toBe(EXT_A_ID);
  });

  it('data points are sorted by date ascending', async () => {
    // Insert in non-chronological order
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-03', 8),
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 3),
    ]);

    const series = await loadRankHistory(1, [extA], '2026-01-01', '2026-01-03');

    expect(series[0].data.map((d) => d.x)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
  });
});
