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

  it('returns empty array when only one scan date exists', async () => {
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
    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 5 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 5 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(0);
  });

  it('handles position: null as "30+" (not in top 30)', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'Test Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 8 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: null }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].currentPosition).toBeNull();
    expect(changes[0].change).toBe(-31); // dropped out of top 30
  });

  it('handles entering top 30 (null -> ranked)', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'Test Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));

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

  it('sorts by absolute change magnitude (biggest first)', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'A' }));
    await db.extensions.add(makeExtension({ id: 'ext-bbb', name: 'B' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'kw1' }));
    await db.keywords.add(makeKeyword({ id: 2, text: 'kw2', projectId: 1 }));

    await db.rank_snapshots.bulkAdd([
      // Small change: 5 -> 3 = +2
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 5 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 3 }),
      // Big change: 20 -> 2 = +18
      makeRankSnapshot({ keywordId: 2, extensionId: 'ext-bbb', date: '2026-02-04', position: 20 }),
      makeRankSnapshot({ keywordId: 2, extensionId: 'ext-bbb', date: '2026-02-05', position: 2 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes[0].change).toBe(18); // biggest change first
    expect(changes[1].change).toBe(2);
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

    const improved = changes.find((c) => c.extensionId === 'ext-aaa');
    const dropped = changes.find((c) => c.extensionId === 'ext-bbb');

    expect(improved).toBeDefined();
    expect(improved!.change).toBe(5); // was 8, now 3
    expect(improved!.isOwn).toBe(true);
    expect(dropped).toBeDefined();
    expect(dropped!.change).toBe(-5); // was 2, now 7
    expect(dropped!.isOwn).toBe(false);
  });

  it('marks extensions without a project as not own', async () => {
    await db.extensions.add(makeExtension({ id: 'ext-aaa', name: 'Orphan Ext' }));
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));
    // No project created — extension is not associated as "own"

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-04', position: 10 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'ext-aaa', date: '2026-02-05', position: 5 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].isOwn).toBe(false);
  });

  it('uses extension ID prefix when extension name not in DB', async () => {
    await db.keywords.add(makeKeyword({ id: 1, text: 'test' }));

    await db.rank_snapshots.bulkAdd([
      makeRankSnapshot({ keywordId: 1, extensionId: 'abcdefghijklmnop', date: '2026-02-04', position: 10 }),
      makeRankSnapshot({ keywordId: 1, extensionId: 'abcdefghijklmnop', date: '2026-02-05', position: 5 }),
    ]);

    const changes = await loadRecentRankChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].extensionName).toBe('abcdefgh...');
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
