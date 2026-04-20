/**
 * Tests for useRankings composable - chart data transformation.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import {
  loadRankHistory,
  loadExtensionRankHistory,
  loadAllKeywordLatestRanks,
  loadRankDeltas,
  buildHeatmapData,
  buildCoverageData,
  buildScatterData,
} from '@/dashboard/composables/useRankings';
import type { Extension, Keyword, RankSnapshot } from '@/shared/types';

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

  it('carries iconUrl from extension onto the series', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
    ]);
    const extWithIcon: Extension = {
      ...extA,
      iconUrl: 'https://lh3.googleusercontent.com/icon.png',
    };

    const series = await loadRankHistory(1, [extWithIcon], '2026-01-01', '2026-01-01');

    expect(series[0].iconUrl).toBe('https://lh3.googleusercontent.com/icon.png');
  });

  it('carries iconUrl=null when extension has no icon', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
    ]);

    const series = await loadRankHistory(1, [extA], '2026-01-01', '2026-01-01');

    expect(series[0].iconUrl).toBeNull();
  });

  it('deduplicates multiple snapshots for same date, keeps latest', async () => {
    await db.rank_snapshots.bulkAdd([
      {
        keywordId: 1, extensionId: EXT_A_ID, date: '2026-01-01',
        position: 10, totalResults: 30,
        scannedAt: new Date('2026-01-01T09:00:00Z'),
      },
      {
        keywordId: 1, extensionId: EXT_A_ID, date: '2026-01-01',
        position: 5, totalResults: 30,
        scannedAt: new Date('2026-01-01T17:00:00Z'),
      },
      {
        keywordId: 1, extensionId: EXT_A_ID, date: '2026-01-02',
        position: 3, totalResults: 30,
        scannedAt: new Date('2026-01-02T10:00:00Z'),
      },
    ]);

    const series = await loadRankHistory(1, [extA], '2026-01-01', '2026-01-02');

    // Should have 2 points (one per day), not 3
    expect(series[0].data).toHaveLength(2);
    expect(series[0].data[0]).toEqual({ x: '2026-01-01', y: 5 }); // latest scan
    expect(series[0].data[1]).toEqual({ x: '2026-01-02', y: 3 });
  });
});

// ---------------------------------------------------------------------------
// Helpers for new tests
// ---------------------------------------------------------------------------

const kw1: Keyword = { id: 1, projectId: 1, text: 'ad blocker', createdAt: new Date() };
const kw2: Keyword = { id: 2, projectId: 1, text: 'privacy tool', createdAt: new Date() };

function makeSnapshotWithTotal(
  keywordId: number,
  extensionId: string,
  date: string,
  position: number | null,
  totalResults: number
): RankSnapshot {
  return { keywordId, extensionId, date, position, totalResults, scannedAt: new Date() };
}

// ---------------------------------------------------------------------------
// loadAllKeywordLatestRanks
// ---------------------------------------------------------------------------

describe('loadAllKeywordLatestRanks', () => {
  it('loads latest ranks for multiple keywords', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 3),
      makeSnapshot(2, EXT_A_ID, '2026-01-01', 10),
    ]);

    const result = await loadAllKeywordLatestRanks([kw1, kw2]);

    expect(result.size).toBe(2);
    // kw1 latest date = 2026-01-02
    const kw1Ranks = result.get(1)!;
    expect(kw1Ranks).toHaveLength(1);
    expect(kw1Ranks[0].position).toBe(3);
    // kw2 latest date = 2026-01-01
    const kw2Ranks = result.get(2)!;
    expect(kw2Ranks).toHaveLength(1);
    expect(kw2Ranks[0].position).toBe(10);
  });

  it('returns empty arrays for keywords without snapshots', async () => {
    const result = await loadAllKeywordLatestRanks([kw1]);
    expect(result.get(1)).toEqual([]);
  });

  it('skips keywords without id', async () => {
    const kwNoId: Keyword = { projectId: 1, text: 'no id', createdAt: new Date() };
    const result = await loadAllKeywordLatestRanks([kwNoId]);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadRankDeltas
// ---------------------------------------------------------------------------

describe('loadRankDeltas', () => {
  // loadRankDeltas queries the last 90 days from today(). The test fixtures
  // below use 2026-01-01/02 dates, so pin the clock just after so those
  // snapshots fall inside the window regardless of the machine's real clock.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-03T12:00:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('calculates positive delta when rank improves', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 10),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 5),
    ]);

    const deltas = await loadRankDeltas(1, [extA]);
    const d = deltas.get(EXT_A_ID)!;

    expect(d.current).toBe(5);
    expect(d.previous).toBe(10);
    expect(d.delta).toBe(5); // improved by 5 positions
  });

  it('calculates negative delta when rank drops', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 3),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 8),
    ]);

    const deltas = await loadRankDeltas(1, [extA]);
    const d = deltas.get(EXT_A_ID)!;

    expect(d.delta).toBe(-5); // dropped by 5 positions
  });

  it('returns zero delta when position unchanged', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 5),
    ]);

    const deltas = await loadRankDeltas(1, [extA]);
    expect(deltas.get(EXT_A_ID)!.delta).toBe(0);
  });

  it('returns null delta with only one snapshot', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 5),
    ]);

    const deltas = await loadRankDeltas(1, [extA]);
    const d = deltas.get(EXT_A_ID)!;

    expect(d.current).toBe(5);
    expect(d.previous).toBeNull();
    expect(d.delta).toBeNull();
  });

  it('returns null delta when current position is null', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', null),
    ]);

    const deltas = await loadRankDeltas(1, [extA]);
    expect(deltas.get(EXT_A_ID)!.delta).toBeNull();
  });

  it('handles no snapshots for an extension', async () => {
    const deltas = await loadRankDeltas(1, [extA]);
    const d = deltas.get(EXT_A_ID)!;

    expect(d.current).toBeNull();
    expect(d.previous).toBeNull();
    expect(d.delta).toBeNull();
  });

  it('handles multiple extensions in parallel', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 10),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 5),
      makeSnapshot(1, EXT_B_ID, '2026-01-01', 3),
      makeSnapshot(1, EXT_B_ID, '2026-01-02', 7),
    ]);

    const deltas = await loadRankDeltas(1, [extA, extB]);

    expect(deltas.get(EXT_A_ID)!.delta).toBe(5);  // improved
    expect(deltas.get(EXT_B_ID)!.delta).toBe(-4);  // dropped
  });

  it('deduplicates same-day snapshots, compares across different days', async () => {
    // Two scans on Jan 1, two scans on Jan 2
    await db.rank_snapshots.bulkAdd([
      {
        keywordId: 1, extensionId: EXT_A_ID, date: '2026-01-01',
        position: 10, totalResults: 30,
        scannedAt: new Date('2026-01-01T09:00:00Z'),
      },
      {
        keywordId: 1, extensionId: EXT_A_ID, date: '2026-01-01',
        position: 8, totalResults: 30,
        scannedAt: new Date('2026-01-01T17:00:00Z'),
      },
      {
        keywordId: 1, extensionId: EXT_A_ID, date: '2026-01-02',
        position: 5, totalResults: 30,
        scannedAt: new Date('2026-01-02T09:00:00Z'),
      },
      {
        keywordId: 1, extensionId: EXT_A_ID, date: '2026-01-02',
        position: 3, totalResults: 30,
        scannedAt: new Date('2026-01-02T17:00:00Z'),
      },
    ]);

    const deltas = await loadRankDeltas(1, [extA]);
    const d = deltas.get(EXT_A_ID)!;

    // Should compare latest Jan 2 (3) vs latest Jan 1 (8), not two Jan 2 scans
    expect(d.current).toBe(3);
    expect(d.previous).toBe(8);
    expect(d.delta).toBe(5); // improved by 5
  });
});

// ---------------------------------------------------------------------------
// buildHeatmapData
// ---------------------------------------------------------------------------

describe('buildHeatmapData', () => {
  it('converts rank map into flat cell array', () => {
    const allRanks = new Map<number, RankSnapshot[]>();
    allRanks.set(1, [
      makeSnapshotWithTotal(1, EXT_A_ID, '2026-01-02', 3, 50),
      makeSnapshotWithTotal(1, EXT_B_ID, '2026-01-02', 7, 50),
    ]);
    allRanks.set(2, [
      makeSnapshotWithTotal(2, EXT_A_ID, '2026-01-02', null, 20),
    ]);

    const cells = buildHeatmapData(allRanks);

    expect(cells).toHaveLength(3);
    expect(cells[0]).toEqual({
      keywordId: 1,
      extensionId: EXT_A_ID,
      position: 3,
      totalResults: 50,
    });
  });

  it('returns empty array for empty input', () => {
    expect(buildHeatmapData(new Map())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildCoverageData
// ---------------------------------------------------------------------------

describe('buildCoverageData', () => {
  it('counts keywords in each tier per extension', () => {
    const cells = [
      { keywordId: 1, extensionId: EXT_A_ID, position: 2, totalResults: 50 },
      { keywordId: 2, extensionId: EXT_A_ID, position: 8, totalResults: 50 },
      { keywordId: 3, extensionId: EXT_A_ID, position: 15, totalResults: 50 },
      { keywordId: 4, extensionId: EXT_A_ID, position: 25, totalResults: 50 },
      { keywordId: 1, extensionId: EXT_B_ID, position: null, totalResults: 50 },
    ];

    const coverage = buildCoverageData(cells, [extA, extB]);

    expect(coverage).toHaveLength(2);
    const covA = coverage.find((c) => c.extensionId === EXT_A_ID)!;
    expect(covA.top3).toBe(1);   // position 2
    expect(covA.top10).toBe(2);  // positions 2, 8
    expect(covA.top20).toBe(3);  // positions 2, 8, 15
    expect(covA.top30).toBe(4);  // positions 2, 8, 15, 25

    const covB = coverage.find((c) => c.extensionId === EXT_B_ID)!;
    expect(covB.top3).toBe(0);
    expect(covB.top10).toBe(0);
    expect(covB.top20).toBe(0);
    expect(covB.top30).toBe(0);
  });

  it('handles empty cells', () => {
    const coverage = buildCoverageData([], [extA]);
    expect(coverage[0].top3).toBe(0);
    expect(coverage[0].top30).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadExtensionRankHistory
// ---------------------------------------------------------------------------

describe('loadExtensionRankHistory', () => {
  it('returns one series per keyword for the own extension', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 3),
      makeSnapshot(2, EXT_A_ID, '2026-01-01', 10),
    ]);

    const series = await loadExtensionRankHistory(
      [kw1, kw2],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-02'
    );

    expect(series).toHaveLength(2);
    expect(series[0].name).toBe('ad blocker');
    expect(series[0].extensionId).toBe(EXT_A_ID);
    expect(series[0].data).toHaveLength(2);
    expect(series[1].name).toBe('privacy tool');
    expect(series[1].extensionId).toBe(EXT_A_ID);
    expect(series[1].data).toHaveLength(1);
  });

  it('does not set iconUrl on keyword-mode series', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
    ]);

    const series = await loadExtensionRankHistory(
      [kw1],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-01'
    );

    expect(series).toHaveLength(1);
    expect('iconUrl' in series[0]).toBe(false);
  });

  it('skips keywords with no ranking data', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
    ]);

    const series = await loadExtensionRankHistory(
      [kw1, kw2],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-02'
    );

    expect(series).toHaveLength(1);
    expect(series[0].name).toBe('ad blocker');
  });

  it('skips keywords without id', async () => {
    const kwNoId: Keyword = { projectId: 1, text: 'no id', createdAt: new Date() };

    const series = await loadExtensionRankHistory(
      [kwNoId],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-02'
    );

    expect(series).toEqual([]);
  });

  it('returns empty array when no keywords have data', async () => {
    const series = await loadExtensionRankHistory(
      [kw1, kw2],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-02'
    );

    expect(series).toEqual([]);
  });

  it('only includes data for the specified extension', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_B_ID, '2026-01-01', 2),
    ]);

    const series = await loadExtensionRankHistory(
      [kw1],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-02'
    );

    expect(series).toHaveLength(1);
    expect(series[0].data[0].y).toBe(5);
  });

  it('applies date range filtering', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2025-12-31', 10),
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-03', 8),
    ]);

    const series = await loadExtensionRankHistory(
      [kw1],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-02'
    );

    expect(series[0].data).toHaveLength(1);
    expect(series[0].data[0].x).toBe('2026-01-01');
  });

  it('preserves null positions for unranked keywords', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-01', null),
    ]);

    const series = await loadExtensionRankHistory(
      [kw1],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-02'
    );

    expect(series[0].data[0].y).toBeNull();
  });

  it('sorts data points by date ascending', async () => {
    await db.rank_snapshots.bulkAdd([
      makeSnapshot(1, EXT_A_ID, '2026-01-03', 8),
      makeSnapshot(1, EXT_A_ID, '2026-01-01', 5),
      makeSnapshot(1, EXT_A_ID, '2026-01-02', 3),
    ]);

    const series = await loadExtensionRankHistory(
      [kw1],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-03'
    );

    expect(series[0].data.map((d) => d.x)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
  });

  it('deduplicates multiple snapshots for same date', async () => {
    await db.rank_snapshots.bulkAdd([
      {
        keywordId: 1, extensionId: EXT_A_ID, date: '2026-01-01',
        position: 10, totalResults: 30,
        scannedAt: new Date('2026-01-01T09:00:00Z'),
      },
      {
        keywordId: 1, extensionId: EXT_A_ID, date: '2026-01-01',
        position: 5, totalResults: 30,
        scannedAt: new Date('2026-01-01T17:00:00Z'),
      },
    ]);

    const series = await loadExtensionRankHistory(
      [kw1],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-01'
    );

    expect(series[0].data).toHaveLength(1);
    expect(series[0].data[0]).toEqual({ x: '2026-01-01', y: 5 });
  });
});

// ---------------------------------------------------------------------------
// buildScatterData
// ---------------------------------------------------------------------------

describe('buildScatterData', () => {
  it('builds scatter points for own extension', () => {
    const allRanks = new Map<number, RankSnapshot[]>();
    allRanks.set(1, [
      makeSnapshotWithTotal(1, EXT_A_ID, '2026-01-02', 5, 100),
      makeSnapshotWithTotal(1, EXT_B_ID, '2026-01-02', 2, 100),
    ]);
    allRanks.set(2, [
      makeSnapshotWithTotal(2, EXT_B_ID, '2026-01-02', 3, 40),
    ]);

    const points = buildScatterData(allRanks, [kw1, kw2], EXT_A_ID);

    expect(points).toHaveLength(2);
    // kw1: own extension has position 5, totalResults 100
    expect(points[0]).toEqual({
      keywordId: 1,
      keywordText: 'ad blocker',
      position: 5,
      totalResults: 100,
    });
    // kw2: own extension not ranked, uses first snap's totalResults
    expect(points[1]).toEqual({
      keywordId: 2,
      keywordText: 'privacy tool',
      position: null,
      totalResults: 40,
    });
  });

  it('returns zero totalResults when no snapshots exist', () => {
    const allRanks = new Map<number, RankSnapshot[]>();
    allRanks.set(1, []);

    const points = buildScatterData(allRanks, [kw1], EXT_A_ID);

    expect(points[0].totalResults).toBe(0);
    expect(points[0].position).toBeNull();
  });

  it('skips keywords without id', () => {
    const kwNoId: Keyword = { projectId: 1, text: 'test', createdAt: new Date() };
    const points = buildScatterData(new Map(), [kwNoId], EXT_A_ID);
    expect(points).toHaveLength(0);
  });
});
