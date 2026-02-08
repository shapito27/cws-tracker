/**
 * Phase 1.2.3 - Domain-specific query method tests.
 *
 * Tests the higher-level query methods on CWSDatabase.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CWSDatabase } from '@/shared/db/database';
import type {
  Project,
  Extension,
  Keyword,
  ListingSnapshot,
  RankSnapshot,
  EventRecord,
  QueueJob,
  TranslationSnapshot,
  ManipulationFlags,
} from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXT_ID_A = 'extaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EXT_ID_B = 'extbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: 'Test Project',
    ownExtensionId: EXT_ID_A,
    competitorIds: [],
    keywordIds: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeExtension(overrides: Partial<Extension> = {}): Extension {
  return {
    id: EXT_ID_A,
    name: 'Extension A',
    iconUrl: null,
    addedAt: new Date('2026-01-01'),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
    ...overrides,
  };
}

function makeKeyword(overrides: Partial<Keyword> = {}): Keyword {
  return {
    text: 'ad blocker',
    projectId: 1,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeListingSnapshot(
  overrides: Partial<ListingSnapshot> = {}
): ListingSnapshot {
  return {
    extensionId: EXT_ID_A,
    date: '2026-01-15',
    title: 'Test Extension',
    shortDescription: 'A test extension',
    fullDescription: 'Full description.',
    rating: 4.5,
    ratingCount: 100,
    reviewCount: 100,
    userCount: '10,000+',
    userCountNumeric: 10000,
    version: '1.0.0',
    lastUpdated: '2026-01-10',
    size: '1.5MiB',
    permissions: ['storage'],
    hostPermissions: [],
    permissionRiskScore: 10,
    badgeFlags: {},
    screenshotCount: 3,
    hasPromoVideo: false,
    translationCount: 1,
    availableLocales: ['en'],
    category: 'productivity',
    developerName: 'Test Dev',
    developerVerified: false,
    listingQualityScore: null,
    scannedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeRankSnapshot(overrides: Partial<RankSnapshot> = {}): RankSnapshot {
  return {
    keywordId: 1,
    extensionId: EXT_ID_A,
    date: '2026-01-15',
    position: 5,
    totalResults: 30,
    scannedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    extensionId: EXT_ID_A,
    date: '2026-01-15',
    type: 'title_change',
    field: 'title',
    oldValue: 'Old',
    newValue: 'New',
    note: 'Title changed',
    ...overrides,
  };
}

function makeQueueJob(overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    type: 'listing_scan',
    payload: { extensionId: EXT_ID_A },
    status: 'pending',
    priority: 10,
    retryCount: 0,
    maxRetries: 3,
    scheduledAt: new Date('2026-01-15T10:00:00Z'),
    startedAt: null,
    completedAt: null,
    error: null,
    ...overrides,
  };
}

const emptyFlags: ManipulationFlags = {
  differentName: { detected: false, similarity: 1 },
  differentShortDesc: { detected: false, similarity: 1 },
  competitorNames: { detected: false, matches: [] },
  extendedDescription: { detected: false, ratio: 1 },
  keywordsAtEnd: { detected: false },
  keywordsInline: { detected: false },
  differentDescription: { detected: false, similarity: 1 },
  untranslatedEnglish: { detected: false, englishRatio: 0 },
};

function makeTranslationSnapshot(
  overrides: Partial<TranslationSnapshot> = {}
): TranslationSnapshot {
  return {
    extensionId: EXT_ID_A,
    locale: 'en',
    date: '2026-01-15',
    title: 'Test',
    shortDescription: 'Short',
    fullDescription: 'Full',
    descriptionLength: 4,
    detectedLanguage: 'en',
    manipulationFlags: emptyFlags,
    scannedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let dbCounter = 0;

describe('CWSDatabase - Domain Query Methods (Phase 1.2.3)', () => {
  let db: CWSDatabase;

  beforeEach(() => {
    db = new CWSDatabase(`TestQueryDB_${++dbCounter}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  // -------------------------------------------------------------------------
  // Project methods
  // -------------------------------------------------------------------------

  describe('project methods', () => {
    it('getProject returns project by id', async () => {
      const id = await db.projects.add(makeProject({ name: 'My Project' }));
      const project = await db.getProject(id);
      expect(project).toBeDefined();
      expect(project!.name).toBe('My Project');
    });

    it('getProject returns undefined for non-existent id', async () => {
      expect(await db.getProject(999)).toBeUndefined();
    });

    it('getAllProjects returns all projects', async () => {
      await db.projects.bulkAdd([
        makeProject({ name: 'A' }),
        makeProject({ name: 'B' }),
      ]);
      const all = await db.getAllProjects();
      expect(all).toHaveLength(2);
    });

    it('getAllProjects returns empty array when no projects', async () => {
      expect(await db.getAllProjects()).toEqual([]);
    });

    it('saveProject creates or updates via put', async () => {
      const id = await db.saveProject(makeProject({ name: 'Original' }));
      const project = await db.getProject(id);
      await db.saveProject({ ...project!, name: 'Updated' });
      const updated = await db.getProject(id);
      expect(updated!.name).toBe('Updated');
    });

    it('deleteProject removes the project', async () => {
      const id = await db.projects.add(makeProject());
      await db.deleteProject(id);
      expect(await db.getProject(id)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Extension methods
  // -------------------------------------------------------------------------

  describe('extension methods', () => {
    it('getExtension returns extension by CWS id', async () => {
      await db.extensions.add(makeExtension());
      const ext = await db.getExtension(EXT_ID_A);
      expect(ext).toBeDefined();
      expect(ext!.name).toBe('Extension A');
    });

    it('saveExtension upserts', async () => {
      await db.saveExtension(makeExtension({ name: 'V1' }));
      await db.saveExtension(makeExtension({ name: 'V2' }));
      const ext = await db.getExtension(EXT_ID_A);
      expect(ext!.name).toBe('V2');
    });

    it('deleteExtension removes extension', async () => {
      await db.extensions.add(makeExtension());
      await db.deleteExtension(EXT_ID_A);
      expect(await db.getExtension(EXT_ID_A)).toBeUndefined();
    });

    it('getOrphanedExtensions returns extensions with empty projectRefs', async () => {
      await db.extensions.bulkAdd([
        makeExtension({ id: EXT_ID_A, projectRefs: [1] }),
        makeExtension({ id: EXT_ID_B, projectRefs: [] }),
      ]);
      const orphans = await db.getOrphanedExtensions();
      expect(orphans).toHaveLength(1);
      expect(orphans[0].id).toBe(EXT_ID_B);
    });
  });

  // -------------------------------------------------------------------------
  // Keyword methods
  // -------------------------------------------------------------------------

  describe('keyword methods', () => {
    it('getKeywordsByProject returns keywords for a project', async () => {
      await db.keywords.bulkAdd([
        makeKeyword({ projectId: 1, text: 'vpn' }),
        makeKeyword({ projectId: 2, text: 'proxy' }),
        makeKeyword({ projectId: 1, text: 'ad blocker' }),
      ]);
      const result = await db.getKeywordsByProject(1);
      expect(result).toHaveLength(2);
      expect(result.every((k) => k.projectId === 1)).toBe(true);
    });

    it('getKeywordsByProject returns empty for unknown project', async () => {
      expect(await db.getKeywordsByProject(999)).toEqual([]);
    });

    it('saveKeyword and deleteKeyword work', async () => {
      const id = await db.saveKeyword(makeKeyword({ text: 'test' }));
      expect(await db.keywords.get(id)).toBeDefined();
      await db.deleteKeyword(id);
      expect(await db.keywords.get(id)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Listing snapshot methods
  // -------------------------------------------------------------------------

  describe('listing snapshot methods', () => {
    it('getListingSnapshots returns snapshots in date range', async () => {
      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-01' }),
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-10' }),
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-20' }),
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-30' }),
      ]);

      const results = await db.getListingSnapshots(
        EXT_ID_A,
        '2026-01-10',
        '2026-01-20'
      );
      expect(results).toHaveLength(2);
      expect(results.every((s) => s.date >= '2026-01-10' && s.date <= '2026-01-20')).toBe(true);
    });

    it('getListingSnapshots excludes other extensions', async () => {
      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-15' }),
        makeListingSnapshot({ extensionId: EXT_ID_B, date: '2026-01-15' }),
      ]);
      const results = await db.getListingSnapshots(
        EXT_ID_A,
        '2026-01-01',
        '2026-01-31'
      );
      expect(results).toHaveLength(1);
      expect(results[0].extensionId).toBe(EXT_ID_A);
    });

    it('getListingSnapshots with start === end returns that exact date', async () => {
      await db.listing_snapshots.add(
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-15' })
      );
      const results = await db.getListingSnapshots(
        EXT_ID_A,
        '2026-01-15',
        '2026-01-15'
      );
      expect(results).toHaveLength(1);
    });

    it('getLatestListingSnapshot returns most recent snapshot', async () => {
      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-01', title: 'Old' }),
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-20', title: 'Latest' }),
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-10', title: 'Middle' }),
      ]);
      const latest = await db.getLatestListingSnapshot(EXT_ID_A);
      expect(latest).toBeDefined();
      expect(latest!.title).toBe('Latest');
    });

    it('getLatestListingSnapshot returns undefined if none exist', async () => {
      expect(await db.getLatestListingSnapshot(EXT_ID_A)).toBeUndefined();
    });

    it('saveListingSnapshot stores and returns id', async () => {
      const id = await db.saveListingSnapshot(makeListingSnapshot());
      expect(typeof id).toBe('number');
      const snap = await db.listing_snapshots.get(id);
      expect(snap).toBeDefined();
    });

    it('saveListingSnapshot overwrites existing snapshot for same extension+date', async () => {
      await db.saveListingSnapshot(makeListingSnapshot({
        extensionId: EXT_ID_A,
        date: '2026-01-15',
        title: 'Morning scan',
        scannedAt: new Date('2026-01-15T09:00:00Z'),
      }));
      expect(await db.listing_snapshots.count()).toBe(1);

      await db.saveListingSnapshot(makeListingSnapshot({
        extensionId: EXT_ID_A,
        date: '2026-01-15',
        title: 'Evening scan',
        scannedAt: new Date('2026-01-15T17:00:00Z'),
      }));

      // Should still be 1, not 2
      expect(await db.listing_snapshots.count()).toBe(1);
      const all = await db.listing_snapshots.toArray();
      expect(all[0].title).toBe('Evening scan');
    });

    it('saveListingSnapshot preserves snapshots for different dates', async () => {
      await db.saveListingSnapshot(makeListingSnapshot({
        extensionId: EXT_ID_A, date: '2026-01-14',
      }));
      await db.saveListingSnapshot(makeListingSnapshot({
        extensionId: EXT_ID_A, date: '2026-01-15',
      }));
      expect(await db.listing_snapshots.count()).toBe(2);
    });

    it('getLatestListingSnapshot picks latest scannedAt among same-date records', async () => {
      // Simulate pre-existing duplicates (from before the fix)
      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({
          extensionId: EXT_ID_A, date: '2026-01-15',
          title: 'Morning', scannedAt: new Date('2026-01-15T09:00:00Z'),
        }),
        makeListingSnapshot({
          extensionId: EXT_ID_A, date: '2026-01-15',
          title: 'Evening', scannedAt: new Date('2026-01-15T17:00:00Z'),
        }),
      ]);

      const latest = await db.getLatestListingSnapshot(EXT_ID_A);
      expect(latest).toBeDefined();
      expect(latest!.title).toBe('Evening');
    });
  });

  // -------------------------------------------------------------------------
  // Rank snapshot methods
  // -------------------------------------------------------------------------

  describe('rank snapshot methods', () => {
    it('getRankSnapshots returns snapshots in date range for keyword+extension', async () => {
      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ keywordId: 1, extensionId: EXT_ID_A, date: '2026-01-01' }),
        makeRankSnapshot({ keywordId: 1, extensionId: EXT_ID_A, date: '2026-01-15' }),
        makeRankSnapshot({ keywordId: 1, extensionId: EXT_ID_A, date: '2026-01-30' }),
        makeRankSnapshot({ keywordId: 2, extensionId: EXT_ID_A, date: '2026-01-15' }),
      ]);

      const results = await db.getRankSnapshots(
        1,
        EXT_ID_A,
        '2026-01-01',
        '2026-01-15'
      );
      expect(results).toHaveLength(2);
    });

    it('saveRankSnapshots saves multiple records atomically', async () => {
      const snapshots = [
        makeRankSnapshot({ extensionId: EXT_ID_A, position: 1 }),
        makeRankSnapshot({ extensionId: EXT_ID_B, position: 5 }),
      ];
      await db.saveRankSnapshots(snapshots);
      expect(await db.rank_snapshots.count()).toBe(2);
    });

    it('getLatestRankForKeyword returns latest date snapshots', async () => {
      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ keywordId: 1, extensionId: EXT_ID_A, date: '2026-01-10', position: 3 }),
        makeRankSnapshot({ keywordId: 1, extensionId: EXT_ID_B, date: '2026-01-10', position: 7 }),
        makeRankSnapshot({ keywordId: 1, extensionId: EXT_ID_A, date: '2026-01-15', position: 2 }),
        makeRankSnapshot({ keywordId: 1, extensionId: EXT_ID_B, date: '2026-01-15', position: 6 }),
      ]);

      const latest = await db.getLatestRankForKeyword(1);
      expect(latest).toHaveLength(2);
      expect(latest.every((s) => s.date === '2026-01-15')).toBe(true);
    });

    it('getLatestRankForKeyword returns empty array when no data', async () => {
      expect(await db.getLatestRankForKeyword(999)).toEqual([]);
    });

    it('saveRankSnapshots overwrites existing snapshots for same keyword+extension+date', async () => {
      // First scan
      await db.saveRankSnapshots([
        makeRankSnapshot({
          keywordId: 1,
          extensionId: EXT_ID_A,
          date: '2026-01-15',
          position: 5,
          scannedAt: new Date('2026-01-15T09:00:00Z'),
        }),
        makeRankSnapshot({
          keywordId: 1,
          extensionId: EXT_ID_B,
          date: '2026-01-15',
          position: 10,
          scannedAt: new Date('2026-01-15T09:00:00Z'),
        }),
      ]);
      expect(await db.rank_snapshots.count()).toBe(2);

      // Second scan same day - should overwrite, not duplicate
      await db.saveRankSnapshots([
        makeRankSnapshot({
          keywordId: 1,
          extensionId: EXT_ID_A,
          date: '2026-01-15',
          position: 3,
          scannedAt: new Date('2026-01-15T17:00:00Z'),
        }),
        makeRankSnapshot({
          keywordId: 1,
          extensionId: EXT_ID_B,
          date: '2026-01-15',
          position: 8,
          scannedAt: new Date('2026-01-15T17:00:00Z'),
        }),
      ]);

      // Should still be 2, not 4
      expect(await db.rank_snapshots.count()).toBe(2);
      const all = await db.rank_snapshots.toArray();
      const snapA = all.find((s) => s.extensionId === EXT_ID_A)!;
      expect(snapA.position).toBe(3); // latest value
    });

    it('saveRankSnapshots preserves snapshots for different dates', async () => {
      await db.saveRankSnapshots([
        makeRankSnapshot({ keywordId: 1, extensionId: EXT_ID_A, date: '2026-01-14', position: 5 }),
      ]);
      await db.saveRankSnapshots([
        makeRankSnapshot({ keywordId: 1, extensionId: EXT_ID_A, date: '2026-01-15', position: 3 }),
      ]);
      expect(await db.rank_snapshots.count()).toBe(2);
    });

    it('getLatestRankForKeyword deduplicates same-day records per extension', async () => {
      // Simulate pre-existing duplicates (from before the fix)
      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({
          keywordId: 1, extensionId: EXT_ID_A, date: '2026-01-15',
          position: 5, scannedAt: new Date('2026-01-15T09:00:00Z'),
        }),
        makeRankSnapshot({
          keywordId: 1, extensionId: EXT_ID_A, date: '2026-01-15',
          position: 3, scannedAt: new Date('2026-01-15T17:00:00Z'),
        }),
      ]);

      const latest = await db.getLatestRankForKeyword(1);
      // Should return 1, not 2
      expect(latest).toHaveLength(1);
      expect(latest[0].position).toBe(3); // latest scannedAt
    });
  });

  // -------------------------------------------------------------------------
  // Event methods
  // -------------------------------------------------------------------------

  describe('event methods', () => {
    it('getEvents returns events in date range for extension', async () => {
      await db.events.bulkAdd([
        makeEvent({ extensionId: EXT_ID_A, date: '2026-01-01' }),
        makeEvent({ extensionId: EXT_ID_A, date: '2026-01-15' }),
        makeEvent({ extensionId: EXT_ID_A, date: '2026-01-30' }),
        makeEvent({ extensionId: EXT_ID_B, date: '2026-01-15' }),
      ]);
      const results = await db.getEvents(EXT_ID_A, '2026-01-01', '2026-01-15');
      expect(results).toHaveLength(2);
    });

    it('getRecentEvents returns events ordered by id descending', async () => {
      await db.events.bulkAdd([
        makeEvent({ date: '2026-01-01', note: 'first' }),
        makeEvent({ date: '2026-01-02', note: 'second' }),
        makeEvent({ date: '2026-01-03', note: 'third' }),
      ]);
      const recent = await db.getRecentEvents(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].note).toBe('third');
      expect(recent[1].note).toBe('second');
    });

    it('saveEvent stores and returns id', async () => {
      const id = await db.saveEvent(makeEvent());
      expect(typeof id).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // Queue methods
  // -------------------------------------------------------------------------

  describe('queue methods', () => {
    it('enqueueJobs adds multiple jobs', async () => {
      await db.enqueueJobs([
        makeQueueJob({ priority: 10 }),
        makeQueueJob({ priority: 20 }),
      ]);
      expect(await db.queue.count()).toBe(2);
    });

    it('dequeueNext returns highest priority (lowest number) pending job', async () => {
      await db.enqueueJobs([
        makeQueueJob({ priority: 20, scheduledAt: new Date('2025-01-01') }),
        makeQueueJob({ priority: 5, scheduledAt: new Date('2025-01-01') }),
        makeQueueJob({ priority: 10, scheduledAt: new Date('2025-01-01') }),
      ]);
      const job = await db.dequeueNext();
      expect(job).not.toBeNull();
      expect(job!.priority).toBe(5);
      expect(job!.status).toBe('running');
    });

    it('dequeueNext returns null when no pending jobs', async () => {
      expect(await db.dequeueNext()).toBeNull();
    });

    it('dequeueNext skips jobs where scheduledAt is in the future', async () => {
      await db.enqueueJobs([
        makeQueueJob({
          priority: 1,
          scheduledAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour in the future
        }),
      ]);
      expect(await db.dequeueNext()).toBeNull();
    });

    it('dequeueNext picks past job over future job', async () => {
      await db.enqueueJobs([
        makeQueueJob({
          priority: 1,
          scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
        makeQueueJob({
          priority: 10,
          scheduledAt: new Date('2025-01-01'),
        }),
      ]);
      const job = await db.dequeueNext();
      expect(job).not.toBeNull();
      expect(job!.priority).toBe(10);
    });

    it('updateJobStatus sets status and completedAt', async () => {
      await db.enqueueJobs([makeQueueJob()]);
      const jobs = await db.queue.toArray();
      await db.updateJobStatus(jobs[0].id!, 'completed');
      const updated = await db.queue.get(jobs[0].id!);
      expect(updated!.status).toBe('completed');
      expect(updated!.completedAt).toBeInstanceOf(Date);
    });

    it('updateJobStatus sets error on failure', async () => {
      await db.enqueueJobs([makeQueueJob()]);
      const jobs = await db.queue.toArray();
      await db.updateJobStatus(jobs[0].id!, 'failed', 'Network error');
      const updated = await db.queue.get(jobs[0].id!);
      expect(updated!.status).toBe('failed');
      expect(updated!.error).toBe('Network error');
    });

    it('getRunningJobs returns only running jobs', async () => {
      await db.enqueueJobs([
        makeQueueJob({ status: 'pending' }),
        makeQueueJob({ status: 'running' }),
        makeQueueJob({ status: 'completed' }),
      ]);
      const running = await db.getRunningJobs();
      expect(running).toHaveLength(1);
      expect(running[0].status).toBe('running');
    });

    it('resetRunningJobs sets all running jobs back to pending', async () => {
      await db.enqueueJobs([
        makeQueueJob({ status: 'running' }),
        makeQueueJob({ status: 'running' }),
        makeQueueJob({ status: 'pending' }),
      ]);
      const count = await db.resetRunningJobs();
      expect(count).toBe(2);
      const running = await db.getRunningJobs();
      expect(running).toHaveLength(0);
      const pending = await db.queue.where('status').equals('pending').count();
      expect(pending).toBe(3);
    });

    it('resetRunningJobs returns 0 when no running jobs', async () => {
      expect(await db.resetRunningJobs()).toBe(0);
    });

    it('getPendingCount returns correct count', async () => {
      await db.enqueueJobs([
        makeQueueJob({ status: 'pending' }),
        makeQueueJob({ status: 'pending' }),
        makeQueueJob({ status: 'running' }),
      ]);
      expect(await db.getPendingCount()).toBe(2);
    });

    it('getQueueStats returns counts by status', async () => {
      await db.enqueueJobs([
        makeQueueJob({ status: 'pending' }),
        makeQueueJob({ status: 'pending' }),
        makeQueueJob({ status: 'running' }),
        makeQueueJob({ status: 'completed' }),
        makeQueueJob({ status: 'failed' }),
      ]);
      const stats = await db.getQueueStats();
      expect(stats).toEqual({
        pending: 2,
        running: 1,
        completed: 1,
        failed: 1,
      });
    });

    it('cleanupOldJobs deletes completed jobs older than threshold', async () => {
      await db.enqueueJobs([
        makeQueueJob({
          status: 'completed',
          completedAt: new Date('2026-01-01'),
        }),
        makeQueueJob({
          status: 'completed',
          completedAt: new Date('2026-01-20'),
        }),
      ]);
      const count = await db.cleanupOldJobs(
        new Date('2026-01-10'),
        new Date('2026-01-10')
      );
      expect(count).toBe(1);
      expect(await db.queue.count()).toBe(1);
    });

    it('cleanupOldJobs deletes failed terminal jobs older than threshold', async () => {
      await db.enqueueJobs([
        makeQueueJob({
          status: 'failed',
          completedAt: new Date('2025-12-01'),
          error: 'old error',
        }),
        makeQueueJob({
          status: 'failed',
          completedAt: new Date('2026-01-20'),
          error: 'recent error',
        }),
      ]);
      const count = await db.cleanupOldJobs(
        new Date('2026-01-10'),
        new Date('2026-01-10')
      );
      expect(count).toBe(1);
      expect(await db.queue.count()).toBe(1);
    });

    it('cleanupOldJobs does not touch pending or running jobs', async () => {
      await db.enqueueJobs([
        makeQueueJob({ status: 'pending' }),
        makeQueueJob({ status: 'running' }),
      ]);
      const count = await db.cleanupOldJobs(
        new Date('2099-01-01'),
        new Date('2099-01-01')
      );
      expect(count).toBe(0);
      expect(await db.queue.count()).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // deleteExtensionData
  // -------------------------------------------------------------------------

  describe('deleteExtensionData', () => {
    it('removes all related data across all tables in one transaction', async () => {
      // Set up data for EXT_ID_A and EXT_ID_B
      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({ extensionId: EXT_ID_A }),
        makeListingSnapshot({ extensionId: EXT_ID_B }),
      ]);
      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ extensionId: EXT_ID_A }),
        makeRankSnapshot({ extensionId: EXT_ID_B }),
      ]);
      await db.events.bulkAdd([
        makeEvent({ extensionId: EXT_ID_A }),
        makeEvent({ extensionId: EXT_ID_B }),
      ]);
      await db.translation_snapshots.bulkAdd([
        makeTranslationSnapshot({ extensionId: EXT_ID_A }),
        makeTranslationSnapshot({ extensionId: EXT_ID_B }),
      ]);

      await db.deleteExtensionData(EXT_ID_A);

      // EXT_ID_A data should be gone
      expect(await db.listing_snapshots.where('extensionId').equals(EXT_ID_A).count()).toBe(0);
      const rankA = await db.rank_snapshots.filter((r) => r.extensionId === EXT_ID_A).count();
      expect(rankA).toBe(0);
      const eventsA = await db.events.filter((e) => e.extensionId === EXT_ID_A).count();
      expect(eventsA).toBe(0);
      const transA = await db.translation_snapshots.filter((t) => t.extensionId === EXT_ID_A).count();
      expect(transA).toBe(0);

      // EXT_ID_B data should still exist
      expect(await db.listing_snapshots.where('extensionId').equals(EXT_ID_B).count()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // pruneOldSnapshots
  // -------------------------------------------------------------------------

  describe('pruneOldSnapshots', () => {
    it('removes snapshots older than date, keeps newer ones', async () => {
      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2025-06-01' }),
        makeListingSnapshot({ extensionId: EXT_ID_A, date: '2026-01-15' }),
      ]);
      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ date: '2025-06-01' }),
        makeRankSnapshot({ date: '2026-01-15' }),
      ]);
      await db.translation_snapshots.bulkAdd([
        makeTranslationSnapshot({ date: '2025-06-01' }),
        makeTranslationSnapshot({ date: '2026-01-15' }),
      ]);

      await db.pruneOldSnapshots('2026-01-01');

      expect(await db.listing_snapshots.count()).toBe(1);
      expect(await db.rank_snapshots.count()).toBe(1);
      expect(await db.translation_snapshots.count()).toBe(1);
    });

    it('does nothing when all snapshots are newer', async () => {
      await db.listing_snapshots.add(
        makeListingSnapshot({ date: '2026-06-01' })
      );
      await db.pruneOldSnapshots('2026-01-01');
      expect(await db.listing_snapshots.count()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('queries on empty tables return empty arrays, not errors', async () => {
      expect(await db.getAllProjects()).toEqual([]);
      expect(await db.getKeywordsByProject(1)).toEqual([]);
      expect(await db.getListingSnapshots(EXT_ID_A, '2026-01-01', '2026-01-31')).toEqual([]);
      expect(await db.getRankSnapshots(1, EXT_ID_A, '2026-01-01', '2026-01-31')).toEqual([]);
      expect(await db.getEvents(EXT_ID_A, '2026-01-01', '2026-01-31')).toEqual([]);
      expect(await db.getRecentEvents(10)).toEqual([]);
      expect(await db.getRunningJobs()).toEqual([]);
      expect(await db.getOrphanedExtensions()).toEqual([]);
    });

    it('date range where start === end returns records from that exact date', async () => {
      await db.events.add(makeEvent({ extensionId: EXT_ID_A, date: '2026-01-15' }));
      const results = await db.getEvents(EXT_ID_A, '2026-01-15', '2026-01-15');
      expect(results).toHaveLength(1);
    });
  });
});
