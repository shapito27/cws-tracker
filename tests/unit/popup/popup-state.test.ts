/**
 * Tests for popup state composable (Phase 1.9).
 *
 * Tests the pure data functions exported from usePopupState, the badge logic,
 * and the Vue component rendering via @vue/test-utils.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  chromeMock,
  resetChromeMock,
  getCalls,
} from '../../mocks/chrome';
import { CWSDatabase } from '../../../src/shared/db/database';
import type { RankSnapshot, Extension, Keyword, Project } from '../../../src/shared/types';
import {
  loadRecentRankChanges,
  updateBadgeCount,
  clearBadge,
  openDashboard,
  requestRefresh,
  requestPause,
  requestResume,
  isServiceWorkerMessage,
} from '../../../src/popup/composables/usePopupState';

// ---------------------------------------------------------------------------
// Test DB setup
// ---------------------------------------------------------------------------

let db: CWSDatabase;

function makeRankSnapshot(overrides: Partial<RankSnapshot> = {}): RankSnapshot {
  return {
    keywordId: 1,
    extensionId: 'ext-aaa',
    date: '2026-02-05',
    position: 5,
    totalResults: 30,
    scannedAt: new Date('2026-02-05T10:00:00'),
    ...overrides,
  };
}

function makeExtension(overrides: Partial<Extension> = {}): Extension {
  return {
    id: 'ext-aaa',
    name: 'Test Extension',
    iconUrl: null,
    addedAt: new Date(),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
    ...overrides,
  };
}

function makeKeyword(overrides: Partial<Keyword> = {}): Keyword {
  return {
    id: 1,
    text: 'ad blocker',
    projectId: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: 'Test Project',
    ownExtensionId: 'ext-aaa',
    competitorIds: ['ext-bbb'],
    keywordIds: [1],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(async () => {
  resetChromeMock();
  // Create fresh DB for each test (unique name avoids cross-test contamination)
  db = new CWSDatabase('TestPopupDB_' + Math.random().toString(36).slice(2));
  await db.open();

  // Monkey-patch the module's db import
  // We need to replace the db instance used by the composable
  const dbModule = await import('../../../src/shared/db/database');
  Object.defineProperty(dbModule, 'db', {
    value: db,
    writable: true,
    configurable: true,
  });
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// loadRecentRankChanges()
// ---------------------------------------------------------------------------

describe('loadRecentRankChanges()', () => {
  it('returns empty array when no rank snapshots exist', async () => {
    const changes = await loadRecentRankChanges();
    expect(changes).toEqual([]);
  });

  it('returns empty array when no projects exist', async () => {
    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ date: '2026-02-04', position: 5 }),
      makeRankSnapshot({ date: '2026-02-05', position: 10 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toEqual([]);
  });

  it('returns empty array when only one scan date exists', async () => {
    await db.projects.add(makeProject({ keywordIds: [1] }));
    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ date: '2026-02-05', position: 5 }),
      makeRankSnapshot({ date: '2026-02-05', position: 10, extensionId: 'ext-bbb' }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toEqual([]);
  });

  it('detects rank improvement (moved up)', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'My Extension' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'ad blocker' }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 10 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 5 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].change).toBe(5); // improved by 5 (was 10, now 5)
    expect(changes[0].previousPosition).toBe(10);
    expect(changes[0].currentPosition).toBe(5);
    expect(changes[0].extensionName).toBe('My Extension');
    expect(changes[0].keyword).toBe('ad blocker');
    expect(changes[0].isOwn).toBe(true);
  });

  it('detects rank drop (moved down)', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'My Extension' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'vpn' }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 3 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 12 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].change).toBe(-9); // dropped by 9 (was 3, now 12)
    expect(changes[0].previousPosition).toBe(3);
    expect(changes[0].currentPosition).toBe(12);
  });

  it('skips unchanged positions (no change)', async () => {
    await db.projects.add(makeProject({ keywordIds: [1] }));
    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 5 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 5 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(0);
  });

  it('handles position: null as "30+" but flags the first null as unstable', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'Test Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 8 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: null }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].currentPosition).toBeNull();
    expect(changes[0].change).toBe(-31); // dropped out of top 30
    // First null after a ranked day → unconfirmed (likely volatility).
    expect(changes[0].unstable).toBe(true);
  });

  it('marks a confirmed (second consecutive) null as NOT unstable', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'Test Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-03', position: 8 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: null }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: null }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].currentPosition).toBeNull();
    expect(changes[0].change).toBe(-31);
    expect(changes[0].unstable).toBeFalsy();
  });

  it('handles entering top 30 (null -> ranked)', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'Test Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: null }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 15 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].previousPosition).toBeNull();
    expect(changes[0].currentPosition).toBe(15);
    expect(changes[0].change).toBe(31); // appeared in results
  });

  it('skips when both positions are null (still not ranked)', async () => {
    await db.projects.add(makeProject({ keywordIds: [1] }));
    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: null }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: null }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(0);
  });

  it('limits results to requested count', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa' }));
    await db.extensions.add(makeExtension({ id: 'ext-bbb', name: 'Ext B' }));
    await db.extensions.add(makeExtension({ id: 'ext-ccc', name: 'Ext C' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'kw1' }));
    await db.keywords.add(makeKeyword({ id: 2, text: 'kw2', projectId: 1 }));
    await db.keywords.add(makeKeyword({ id: 3, text: 'kw3', projectId: 1 }));
    await db.projects.add(makeProject({ keywordIds: [1, 2, 3] }));

    // Create 3 changes
    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 10 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 3 }),
      makeRankSnapshot({ keywordId: 2, extensionId: 'ext-bbb', date: '2026-02-04', position: 5 }),
      makeRankSnapshot({ keywordId: 2, extensionId: 'ext-bbb', date: '2026-02-05', position: 8 }),
      makeRankSnapshot({ keywordId: 3, extensionId: 'ext-ccc', date: '2026-02-04', position: 20 }),
      makeRankSnapshot({ keywordId: 3, extensionId: 'ext-ccc', date: '2026-02-05', position: 2 }),
    ]);

    const changes = await loadRecentRankChanges(2);
    expect(changes).toHaveLength(2);
  });

  it('sorts own extensions first, then by magnitude', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'My Ext' }));
    await db.extensions.add(makeExtension({ id: 'ext-bbb', name: 'Competitor' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'kw1' }));
    await db.keywords.add(makeKeyword({ id: 2, text: 'kw2', projectId: 1 }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa', competitorIds: ['ext-bbb'], keywordIds: [1, 2] }));

    await db.rank_snapshots.bulkAdd([
      // Own ext: small change 5 -> 3 = +2
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 5 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 3 }),
      // Competitor: big change 20 -> 2 = +18
      makeRankSnapshot({ keywordId: 2, extensionId: 'ext-bbb', date: '2026-02-04', position: 20 }),
      makeRankSnapshot({ keywordId: 2, extensionId: 'ext-bbb', date: '2026-02-05', position: 2 }),
    ]);

    const changes = await loadRecentRankChanges();
    // Own extension comes first despite smaller magnitude
    expect(changes[0].extensionId).toBe('ext-aaa');
    expect(changes[0].change).toBe(2);
    expect(changes[0].isOwn).toBe(true);
    expect(changes[1].extensionId).toBe('ext-bbb');
    expect(changes[1].change).toBe(18);
    expect(changes[1].isOwn).toBe(false);
  });

  it('handles multiple extensions and keywords correctly', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'My Ext' }));
    await db.extensions.add(makeExtension({ id: 'ext-bbb', name: 'Competitor' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'ad blocker' }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa', competitorIds: ['ext-bbb'] }));

    await db.rank_snapshots.bulkAdd([
      // ext-aaa improved
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 8 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 3 }),
      // ext-bbb dropped
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-bbb', date: '2026-02-04', position: 2 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-bbb', date: '2026-02-05', position: 7 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(2);

    // Own extension sorted first
    expect(changes[0].extensionId).toBe('ext-aaa');
    expect(changes[0].change).toBe(5); // was 8, now 3
    expect(changes[0].isOwn).toBe(true);

    expect(changes[1].extensionId).toBe('ext-bbb');
    expect(changes[1].change).toBe(-5); // was 2, now 7
    expect(changes[1].isOwn).toBe(false);
  });

  it('marks extension as own when referenced by multiple projects', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'Multi Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'kw' }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));
    await db.projects.add(makeProject({ name: 'Project 2', ownExtensionId: 'ext-aaa', competitorIds: [] }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 10 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 5 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].isOwn).toBe(true);
  });

  it('excludes snapshots for keywords not in any project', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'Orphan Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));
    // Project exists but doesn't include keyword 1
    await db.projects.add(makeProject({ keywordIds: [99] }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 10 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 5 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(0); // filtered out since keyword 1 not in project
  });

  it('marks competitor extensions as not own', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-bbb', name: 'Competitor Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa', competitorIds: ['ext-bbb'] }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-bbb', date: '2026-02-04', position: 10 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-bbb', date: '2026-02-05', position: 5 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].isOwn).toBe(false);
  });

  it('uses extension ID prefix when extension name not in DB', async () => {
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));
    await db.projects.add(makeProject({ keywordIds: [1] }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'abcdefghijklmnop', date: '2026-02-04', position: 10 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'abcdefghijklmnop', date: '2026-02-05', position: 5 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].extensionName).toBe('abcdefgh...');
  });

  it('deduplicates snapshots by keywordId+extensionId per date (keeps latest scannedAt)', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'My Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

    // Two snapshots for the same keyword+extension+date but different positions/times.
    // This shouldn't happen in practice (saveRankSnapshots prevents it), but
    // dedup ensures consistent behavior matching the dashboard.
    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 8, scannedAt: new Date('2026-02-04T10:00:00') }),
      // Stale duplicate on current date (earlier scannedAt, wrong position)
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: null, scannedAt: new Date('2026-02-05T08:00:00') }),
      // Latest snapshot on current date (later scannedAt, correct position)
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 2, scannedAt: new Date('2026-02-05T14:00:00') }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    // Should use the latest scannedAt snapshot (position 2), not the stale one (null)
    expect(changes[0].currentPosition).toBe(2);
    expect(changes[0].change).toBe(6); // was 8, now 2 = improved by 6
  });

  it('only shows rank changes for keywords in active projects', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'My Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'project keyword' }));
    await db.keywords.add(makeKeyword({ id: 2, text: 'orphan keyword', projectId: 1 }));
    // Project only includes keyword 1, not keyword 2
    await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa', keywordIds: [1] }));

    await db.rank_snapshots.bulkAdd([
      // Keyword 1 (in project): improved
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 10 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 3 }),
      // Keyword 2 (not in project): shows as dropped — should be excluded
      makeRankSnapshot({ keywordId: 2, extensionId: 'ext-aaa', date: '2026-02-04', position: 2 }),
      makeRankSnapshot({ keywordId: 2, extensionId: 'ext-aaa', date: '2026-02-05', position: null }),
    ]);

    const changes = await loadRecentRankChanges();
    // Only keyword 1 shown, keyword 2 filtered out
    expect(changes).toHaveLength(1);
    expect(changes[0].keywordId).toBe(1);
    expect(changes[0].change).toBe(7);
  });

  // -------------------------------------------------------------------------
  // Gap-day regression: a partial-scan day with position:null between two
  // real ranked days must NOT produce a "New" event on the recovery day.
  // -------------------------------------------------------------------------
  describe('gap-day handling (null-prev lookback)', () => {
    it('suppresses spurious "New" when pair was ranked within lookback window', async () => {
      // Apr 27 #1, Apr 28 null (gap day), Apr 29 #1 — should report no change.
      await db.extensions.add(makeExtension({ id: 'ext-aaa' }));
      await db.keywords.add(makeKeyword({ id: 1 }));
      await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-27', position: 1 }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-28', position: null }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-29', position: 1 }),
      ]);

      const changes = await loadRecentRankChanges();
      expect(changes).toHaveLength(0);
    });

    it('reports the real delta when the recovery day differs from the pre-gap position', async () => {
      // Apr 27 #1, Apr 28 null, Apr 29 #5 — should report a 4-position drop
      // relative to Apr 27, NOT a "New" entry from null.
      await db.extensions.add(makeExtension({ id: 'ext-aaa' }));
      await db.keywords.add(makeKeyword({ id: 1 }));
      await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-27', position: 1 }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-28', position: null }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-29', position: 5 }),
      ]);

      const changes = await loadRecentRankChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0].previousPosition).toBe(1);
      expect(changes[0].currentPosition).toBe(5);
      expect(changes[0].change).toBe(-4);
    });

    it('still emits "New" when there is no non-null history within the window', async () => {
      // First-ever ranking — pair has only the null prev day, no earlier
      // non-null history. Should emit the "New" sentinel (change=31).
      await db.extensions.add(makeExtension({ id: 'ext-aaa' }));
      await db.keywords.add(makeKeyword({ id: 1 }));
      await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-28', position: null }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-29', position: 5 }),
      ]);

      const changes = await loadRecentRankChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0].change).toBe(31);
    });

    it('still emits "New" when the prior non-null is older than the lookback window', async () => {
      // Apr 1 #1 (>14 days ago), Apr 28 null, Apr 29 #1 — counts as a
      // legitimate re-entry into top 30 since the long absence wipes the
      // recent-history signal.
      await db.extensions.add(makeExtension({ id: 'ext-aaa' }));
      await db.keywords.add(makeKeyword({ id: 1 }));
      await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-01', position: 1 }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-28', position: null }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-29', position: 1 }),
      ]);

      const changes = await loadRecentRankChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0].change).toBe(31);
    });

    it('still reports a real "Out" event when curr drops to null', async () => {
      // The fix only suppresses spurious "New"; "Out" detection unchanged.
      // Apr 27 #1, Apr 28 #1 (immediate prev non-null), Apr 29 null → "Out".
      await db.extensions.add(makeExtension({ id: 'ext-aaa' }));
      await db.keywords.add(makeKeyword({ id: 1 }));
      await db.projects.add(makeProject({ ownExtensionId: 'ext-aaa' }));

      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-27', position: 1 }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-28', position: 1 }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-04-29', position: null }),
      ]);

      const changes = await loadRecentRankChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0].change).toBe(-31);
    });
  });
});

// ---------------------------------------------------------------------------
// Badge management
// ---------------------------------------------------------------------------

describe('updateBadgeCount()', () => {
  it('sets badge text when count > 0', async () => {
    await updateBadgeCount(3);
    const calls = getCalls('action.setBadgeText');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual({ text: '3' });
  });

  it('sets badge background color when count > 0', async () => {
    await updateBadgeCount(5);
    const colorCalls = getCalls('action.setBadgeBackgroundColor');
    expect(colorCalls).toHaveLength(1);
    expect(colorCalls[0].args[0]).toEqual({ color: '#EF4444' });
  });

  it('clears badge text when count is 0', async () => {
    await updateBadgeCount(0);
    const calls = getCalls('action.setBadgeText');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual({ text: '' });
  });

  it('does not set background color when count is 0', async () => {
    await updateBadgeCount(0);
    const colorCalls = getCalls('action.setBadgeBackgroundColor');
    expect(colorCalls).toHaveLength(0);
  });
});

describe('clearBadge()', () => {
  it('clears badge text', async () => {
    // Set badge first
    await updateBadgeCount(3);
    resetChromeMock();

    await clearBadge();
    const calls = getCalls('action.setBadgeText');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual({ text: '' });
  });
});

// ---------------------------------------------------------------------------
// Action functions
// ---------------------------------------------------------------------------

describe('openDashboard()', () => {
  it('opens dashboard in a new tab', () => {
    openDashboard();
    const calls = getCalls('tabs.create');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual({
      url: 'chrome-extension://mock-extension-id/src/dashboard/index.html',
    });
  });
});

describe('requestRefresh()', () => {
  it('sends TRIGGER_REFRESH message to service worker', () => {
    requestRefresh();
    const calls = getCalls('runtime.sendMessage');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual({ type: 'TRIGGER_REFRESH' });
  });
});

describe('requestPause()', () => {
  it('sends PAUSE_SCAN message to service worker', () => {
    requestPause();
    const calls = getCalls('runtime.sendMessage');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual({ type: 'PAUSE_SCAN' });
  });
});

describe('requestResume()', () => {
  it('sends RESUME_SCAN message to service worker', () => {
    requestResume();
    const calls = getCalls('runtime.sendMessage');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual({ type: 'RESUME_SCAN' });
  });
});

// ---------------------------------------------------------------------------
// isServiceWorkerMessage() type guard
// ---------------------------------------------------------------------------

describe('isServiceWorkerMessage()', () => {
  it('rejects null', () => {
    expect(isServiceWorkerMessage(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isServiceWorkerMessage(undefined)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isServiceWorkerMessage('hello')).toBe(false);
    expect(isServiceWorkerMessage(42)).toBe(false);
  });

  it('rejects object without type', () => {
    expect(isServiceWorkerMessage({ foo: 'bar' })).toBe(false);
  });

  it('rejects unknown type', () => {
    expect(isServiceWorkerMessage({ type: 'UNKNOWN' })).toBe(false);
  });

  it('accepts valid SCAN_PROGRESS', () => {
    expect(
      isServiceWorkerMessage({
        type: 'SCAN_PROGRESS',
        completed: 5,
        total: 10,
        currentJob: 'Scanning extension',
      })
    ).toBe(true);
  });

  it('rejects SCAN_PROGRESS with missing fields', () => {
    expect(
      isServiceWorkerMessage({ type: 'SCAN_PROGRESS', completed: 5 })
    ).toBe(false);
  });

  it('rejects SCAN_PROGRESS with wrong field types', () => {
    expect(
      isServiceWorkerMessage({
        type: 'SCAN_PROGRESS',
        completed: '5',
        total: 10,
        currentJob: 'test',
      })
    ).toBe(false);
  });

  it('accepts valid SCAN_COMPLETE', () => {
    expect(
      isServiceWorkerMessage({
        type: 'SCAN_COMPLETE',
        date: '2026-02-05',
        jobsCompleted: 10,
        jobsFailed: 0,
      })
    ).toBe(true);
  });

  it('rejects SCAN_COMPLETE with missing fields', () => {
    expect(
      isServiceWorkerMessage({ type: 'SCAN_COMPLETE', date: '2026-02-05' })
    ).toBe(false);
  });

  it('accepts valid QUEUE_STATUS', () => {
    expect(
      isServiceWorkerMessage({
        type: 'QUEUE_STATUS',
        pending: 5,
        running: 1,
        failed: 0,
      })
    ).toBe(true);
  });

  it('rejects QUEUE_STATUS with missing fields', () => {
    expect(
      isServiceWorkerMessage({ type: 'QUEUE_STATUS', pending: 5 })
    ).toBe(false);
  });

  it('accepts valid NEW_EVENT', () => {
    expect(
      isServiceWorkerMessage({
        type: 'NEW_EVENT',
        event: { extensionId: 'abc', type: 'title_change' },
      })
    ).toBe(true);
  });

  it('rejects NEW_EVENT with null event', () => {
    expect(
      isServiceWorkerMessage({ type: 'NEW_EVENT', event: null })
    ).toBe(false);
  });

  it('accepts valid SCAN_ERROR', () => {
    expect(
      isServiceWorkerMessage({
        type: 'SCAN_ERROR',
        jobId: 1,
        error: 'HTTP 429',
        retriesLeft: 2,
      })
    ).toBe(true);
  });

  it('rejects SCAN_ERROR with wrong types', () => {
    expect(
      isServiceWorkerMessage({
        type: 'SCAN_ERROR',
        jobId: 'abc',
        error: 'test',
      })
    ).toBe(false);
  });
});
