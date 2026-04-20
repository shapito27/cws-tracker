/**
 * Tests for useAutocomplete composable - iconUrl propagation on chart series.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import {
  loadAutocompleteHistory,
  loadExtensionAutocompleteHistory,
  loadKeywordAcPositionTable,
} from '@/dashboard/composables/useAutocomplete';
import type { Extension, Keyword, AutocompleteSnapshot } from '@/shared/types';

const EXT_A_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const extA: Extension = {
  id: EXT_A_ID,
  name: 'Extension A',
  iconUrl: null,
  addedAt: new Date(),
  lastScannedAt: null,
  status: 'active',
  projectRefs: [1],
};

const kw1: Keyword = { id: 1, projectId: 1, text: 'ad blocker', createdAt: new Date() };

function makeAcSnapshot(
  keywordId: number,
  extensionId: string,
  date: string,
  position: number
): AutocompleteSnapshot {
  return {
    keywordId,
    extensionId,
    date,
    position,
    suggestedName: 'Test Extension',
    scannedAt: new Date(),
  };
}

beforeEach(async () => {
  await db.autocomplete_snapshots.clear();
});

describe('loadAutocompleteHistory - iconUrl', () => {
  it('carries iconUrl from extension onto the series', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-01-01', 3),
    ]);
    const extWithIcon: Extension = {
      ...extA,
      iconUrl: 'https://lh3.googleusercontent.com/icon.png',
    };

    const series = await loadAutocompleteHistory(1, [extWithIcon], '2026-01-01', '2026-01-01');

    expect(series[0].iconUrl).toBe('https://lh3.googleusercontent.com/icon.png');
  });

  it('carries iconUrl=null when extension has no icon', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-01-01', 3),
    ]);

    const series = await loadAutocompleteHistory(1, [extA], '2026-01-01', '2026-01-01');

    expect(series[0].iconUrl).toBeNull();
  });
});

describe('loadExtensionAutocompleteHistory - iconUrl', () => {
  it('does not set iconUrl on keyword-mode series', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-01-01', 3),
    ]);

    const series = await loadExtensionAutocompleteHistory(
      [kw1],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-01'
    );

    expect(series).toHaveLength(1);
    expect('iconUrl' in series[0]).toBe(false);
  });
});

describe('loadKeywordAcPositionTable', () => {
  const kw2: Keyword = { id: 2, projectId: 1, text: 'vpn extension', createdAt: new Date() };

  function makeAcSnapshotAt(
    keywordId: number,
    extensionId: string,
    date: string,
    position: number | null,
    scannedAt: Date
  ): AutocompleteSnapshot {
    return { keywordId, extensionId, date, position, suggestedName: 'Test', scannedAt };
  }

  it('returns one row per keyword with correct fields', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-03-30', 2),
      makeAcSnapshot(2, EXT_A_ID, '2026-03-30', 5),
    ]);

    const rows = await loadKeywordAcPositionTable([kw1, kw2], EXT_A_ID, 7);

    expect(rows).toHaveLength(2);
    expect(rows[0].keywordId).toBe(1);
    expect(rows[0].keywordText).toBe('ad blocker');
    expect(rows[1].keywordId).toBe(2);
    expect(rows[1].keywordText).toBe('vpn extension');
  });

  it('returns empty array when no keywords have IDs', async () => {
    const noIdKw: Keyword = { projectId: 1, text: 'no id', createdAt: new Date() };
    const rows = await loadKeywordAcPositionTable([noIdKw], EXT_A_ID, 7);
    expect(rows).toHaveLength(0);
  });

  it('returns rows with empty days map when no snapshots exist', async () => {
    const rows = await loadKeywordAcPositionTable([kw1], EXT_A_ID, 7);
    expect(rows).toHaveLength(1);
    expect(rows[0].days.size).toBe(0);
  });

  it('stores position: null snapshots correctly (not in AC)', async () => {
    await db.autocomplete_snapshots.add({
      keywordId: 1,
      extensionId: EXT_A_ID,
      date: '2026-03-30',
      position: null,
      suggestedName: null,
      scannedAt: new Date(),
    });

    const rows = await loadKeywordAcPositionTable([kw1], EXT_A_ID, 7);
    const cell = rows[0].days.get('2026-03-30');
    expect(cell).toBeDefined();
    expect(cell!.position).toBeNull();
  });

  it('computes positive delta when position improves', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-03-29', 5),
      makeAcSnapshot(1, EXT_A_ID, '2026-03-30', 2),
    ]);

    const rows = await loadKeywordAcPositionTable([kw1], EXT_A_ID, 7);
    const cell = rows[0].days.get('2026-03-30');
    expect(cell).toBeDefined();
    expect(cell!.delta).toBe(3); // 5 - 2 = 3 (improved)
  });

  it('computes negative delta when position drops', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-03-29', 1),
      makeAcSnapshot(1, EXT_A_ID, '2026-03-30', 5),
    ]);

    const rows = await loadKeywordAcPositionTable([kw1], EXT_A_ID, 7);
    const cell = rows[0].days.get('2026-03-30');
    expect(cell).toBeDefined();
    expect(cell!.delta).toBe(-4); // 1 - 5 = -4 (dropped)
  });

  it('delta is null when only one day of data', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-03-30', 3),
    ]);

    const rows = await loadKeywordAcPositionTable([kw1], EXT_A_ID, 7);
    const cell = rows[0].days.get('2026-03-30');
    expect(cell).toBeDefined();
    expect(cell!.delta).toBeNull();
  });

  it('delta is null when either day has position: null', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      { keywordId: 1, extensionId: EXT_A_ID, date: '2026-03-29', position: null, suggestedName: null, scannedAt: new Date() },
      makeAcSnapshot(1, EXT_A_ID, '2026-03-30', 3),
    ]);

    const rows = await loadKeywordAcPositionTable([kw1], EXT_A_ID, 7);
    const cell = rows[0].days.get('2026-03-30');
    expect(cell).toBeDefined();
    expect(cell!.delta).toBeNull();
  });

  it('deduplicates multiple snapshots on same date (latest scannedAt wins)', async () => {
    const earlier = new Date('2026-03-30T08:00:00Z');
    const later = new Date('2026-03-30T14:00:00Z');

    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshotAt(1, EXT_A_ID, '2026-03-30', 5, earlier),
      makeAcSnapshotAt(1, EXT_A_ID, '2026-03-30', 2, later),
    ]);

    const rows = await loadKeywordAcPositionTable([kw1], EXT_A_ID, 7);
    const cell = rows[0].days.get('2026-03-30');
    expect(cell).toBeDefined();
    expect(cell!.position).toBe(2); // later scan wins
  });

  it('uses lookback day for delta on first visible date', async () => {
    // With rangeDays=7, visibleDates[0] = daysAgo(6) and startDate = daysAgo(7)
    // We simulate this with concrete dates
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // daysAgo(7) - the lookback sentinel
    const sentinel = new Date(now);
    sentinel.setDate(sentinel.getDate() - 7);
    const sentinelDate = sentinel.toISOString().slice(0, 10);

    // daysAgo(6) - first visible date
    const firstVisible = new Date(now);
    firstVisible.setDate(firstVisible.getDate() - 6);
    const firstVisibleDate = firstVisible.toISOString().slice(0, 10);

    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, sentinelDate, 8),
      makeAcSnapshot(1, EXT_A_ID, firstVisibleDate, 3),
    ]);

    const rows = await loadKeywordAcPositionTable([kw1], EXT_A_ID, 7);
    const cell = rows[0].days.get(firstVisibleDate);
    expect(cell).toBeDefined();
    expect(cell!.position).toBe(3);
    expect(cell!.delta).toBe(5); // 8 - 3 = 5 (improved)
  });
});
