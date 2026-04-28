/**
 * Phase 1.2.1 & 1.2.2 - CWSDatabase schema and CRUD verification tests.
 *
 * Tests that:
 * - DB opens and all tables are accessible
 * - Primary keys and compound indexes work
 * - Basic Dexie CRUD operations work with our schema
 * - Transactions commit and abort correctly
 * - Migration paths work
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Dexie from 'dexie';
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
} from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers: factory functions for test data
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: 'Test Project',
    ownExtensionId: 'abcdefghijklmnopqrstuvwxyz012345',
    competitorIds: [],
    keywordIds: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeExtension(overrides: Partial<Extension> = {}): Extension {
  return {
    id: 'abcdefghijklmnopqrstuvwxyz012345',
    name: 'Test Extension',
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
    extensionId: 'abcdefghijklmnopqrstuvwxyz012345',
    date: '2026-01-15',
    title: 'Test Extension',
    shortDescription: 'A test extension',
    fullDescription: 'Full description of the test extension.',
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
    developerEmail: null,
    developerVerified: false,
    listingQualityScore: null,
    scannedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeRankSnapshot(overrides: Partial<RankSnapshot> = {}): RankSnapshot {
  return {
    keywordId: 1,
    extensionId: 'abcdefghijklmnopqrstuvwxyz012345',
    date: '2026-01-15',
    position: 5,
    totalResults: 30,
    scannedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeEventRecord(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    extensionId: 'abcdefghijklmnopqrstuvwxyz012345',
    date: '2026-01-15',
    type: 'title_change',
    field: 'title',
    oldValue: 'Old Title',
    newValue: 'New Title',
    note: "Title changed from 'Old Title' to 'New Title'",
    ...overrides,
  };
}

function makeQueueJob(overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    type: 'listing_scan',
    payload: { extensionId: 'abcdefghijklmnopqrstuvwxyz012345' },
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let dbCounter = 0;

describe('CWSDatabase - Schema & CRUD (Phase 1.2.1 & 1.2.2)', () => {
  let db: CWSDatabase;

  beforeEach(() => {
    db = new CWSDatabase(`TestDB_${++dbCounter}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  // -------------------------------------------------------------------------
  // 1.2.1 Schema
  // -------------------------------------------------------------------------

  describe('schema', () => {
    it('opens successfully with all tables accessible', async () => {
      await db.open();
      expect(db.isOpen()).toBe(true);
      const tableNames = db.tables.map((t) => t.name).sort();
      expect(tableNames).toEqual([
        'audit_cache',
        'autocomplete_keyword_suggestions',
        'autocomplete_snapshots',
        'events',
        'extensions',
        'keywords',
        'listing_snapshots',
        'projects',
        'queue',
        'rank_snapshots',
        'scan_logs',
        'translation_snapshots',
      ]);
    });

    it('projects table has auto-increment primary key', async () => {
      const id1 = await db.projects.add(makeProject());
      const id2 = await db.projects.add(makeProject({ name: 'Second' }));
      expect(typeof id1).toBe('number');
      expect(id2).toBeGreaterThan(id1);
    });

    it('extensions table uses string primary key', async () => {
      const key = await db.extensions.add(
        makeExtension({ id: 'myextensionidxxxxxxxxxxxxxxxxxx' })
      );
      expect(key).toBe('myextensionidxxxxxxxxxxxxxxxxxx');
    });

    it('keywords table has projectId index', async () => {
      await db.keywords.bulkAdd([
        makeKeyword({ projectId: 1, text: 'vpn' }),
        makeKeyword({ projectId: 2, text: 'proxy' }),
        makeKeyword({ projectId: 1, text: 'network' }),
      ]);
      const results = await db.keywords
        .where('projectId')
        .equals(1)
        .toArray();
      expect(results).toHaveLength(2);
    });

    it('listing_snapshots compound index [extensionId+date] works', async () => {
      const extId = 'testextidxxxxxxxxxxxxxxxxxxxx01';
      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({ extensionId: extId, date: '2026-01-10' }),
        makeListingSnapshot({ extensionId: extId, date: '2026-01-15' }),
        makeListingSnapshot({ extensionId: extId, date: '2026-01-20' }),
        makeListingSnapshot({
          extensionId: 'otheridxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          date: '2026-01-15',
        }),
      ]);
      const results = await db.listing_snapshots
        .where('[extensionId+date]')
        .between([extId, '2026-01-10'], [extId, '2026-01-15'], true, true)
        .toArray();
      expect(results).toHaveLength(2);
      expect(results.every((s) => s.extensionId === extId)).toBe(true);
    });

    it('rank_snapshots compound index [keywordId+extensionId+date] works', async () => {
      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', date: '2026-01-10' }),
        makeRankSnapshot({ keywordId: 1, extensionId: 'ext1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', date: '2026-01-15' }),
        makeRankSnapshot({ keywordId: 2, extensionId: 'ext1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', date: '2026-01-10' }),
      ]);
      const results = await db.rank_snapshots
        .where('[keywordId+extensionId+date]')
        .between(
          [1, 'ext1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', Dexie.minKey],
          [1, 'ext1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', Dexie.maxKey]
        )
        .toArray();
      expect(results).toHaveLength(2);
    });

    it('future migration preserves data (v1 -> v2 simulation)', async () => {
      // Insert data with v1 schema
      await db.projects.add(makeProject({ name: 'Survivor' }));
      const count = await db.projects.count();
      expect(count).toBe(1);

      // Close and reopen with a "v2" that adds a new index on projects
      db.close();

      class CWSDatabase_v2 extends Dexie {
        projects!: Dexie.Table<Project, number>;
        extensions!: Dexie.Table<Extension, string>;
        keywords!: Dexie.Table<Keyword, number>;
        listing_snapshots!: Dexie.Table<ListingSnapshot, number>;
        rank_snapshots!: Dexie.Table<RankSnapshot, number>;
        events!: Dexie.Table<EventRecord, number>;
        queue!: Dexie.Table<QueueJob, number>;
        translation_snapshots!: Dexie.Table<TranslationSnapshot, number>;

        constructor(name: string) {
          super(name);
          this.version(1).stores({
            projects: '++id',
            extensions: 'id',
            keywords: '++id, projectId',
            listing_snapshots: '++id, [extensionId+date], extensionId',
            rank_snapshots:
              '++id, [keywordId+extensionId+date], [extensionId+date]',
            events: '++id, [extensionId+date]',
            queue: '++id, [status+scheduledAt], status',
            translation_snapshots: '++id, [extensionId+date]',
          });
          // v2 adds a name index on projects
          this.version(2).stores({
            projects: '++id, name',
          });
        }
      }

      const db2 = new CWSDatabase_v2(db.name);
      try {
        await db2.open();
        const projects = await db2.projects.toArray();
        expect(projects).toHaveLength(1);
        expect(projects[0].name).toBe('Survivor');

        // New index should work
        const byName = await db2.projects
          .where('name')
          .equals('Survivor')
          .toArray();
        expect(byName).toHaveLength(1);
      } finally {
        await db2.delete();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 1.2.2 CRUD verification
  // -------------------------------------------------------------------------

  describe('CRUD operations', () => {
    it('table.add() inserts a record retrievable via table.get()', async () => {
      const id = await db.projects.add(makeProject());
      const record = await db.projects.get(id);
      expect(record).toBeDefined();
      expect(record!.name).toBe('Test Project');
    });

    it('table.add() with duplicate key throws ConstraintError', async () => {
      await db.extensions.add(makeExtension({ id: 'dupidxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }));
      await expect(
        db.extensions.add(makeExtension({ id: 'dupidxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }))
      ).rejects.toThrow();
    });

    it('table.get() returns undefined for non-existent key', async () => {
      const record = await db.projects.get(99999);
      expect(record).toBeUndefined();
    });

    it('table.put() updates existing record (upsert)', async () => {
      const id = await db.projects.add(makeProject({ name: 'Original' }));
      await db.projects.put(makeProject({ id, name: 'Updated' }));
      const record = await db.projects.get(id);
      expect(record!.name).toBe('Updated');
    });

    it('table.delete() removes record', async () => {
      const id = await db.projects.add(makeProject());
      await db.projects.delete(id);
      const record = await db.projects.get(id);
      expect(record).toBeUndefined();
    });

    it('table.delete() on non-existent key does not throw', async () => {
      await expect(db.projects.delete(99999)).resolves.not.toThrow();
    });

    it('table.toArray() returns all records', async () => {
      await db.projects.bulkAdd([
        makeProject({ name: 'A' }),
        makeProject({ name: 'B' }),
      ]);
      const all = await db.projects.toArray();
      expect(all).toHaveLength(2);
    });

    it('table.toArray() returns empty array for empty table', async () => {
      const all = await db.projects.toArray();
      expect(all).toEqual([]);
    });

    it('table.where(index).equals(value) returns correct records', async () => {
      await db.keywords.bulkAdd([
        makeKeyword({ projectId: 1, text: 'a' }),
        makeKeyword({ projectId: 2, text: 'b' }),
        makeKeyword({ projectId: 1, text: 'c' }),
      ]);
      const results = await db.keywords
        .where('projectId')
        .equals(1)
        .toArray();
      expect(results).toHaveLength(2);
      expect(results.every((k) => k.projectId === 1)).toBe(true);
    });

    it('table.where(index).between() range query works with compound index', async () => {
      const extId = 'rangetestidxxxxxxxxxxxxxxxxxxx01';
      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({ extensionId: extId, date: '2026-01-01' }),
        makeListingSnapshot({ extensionId: extId, date: '2026-01-05' }),
        makeListingSnapshot({ extensionId: extId, date: '2026-01-10' }),
        makeListingSnapshot({ extensionId: extId, date: '2026-01-15' }),
      ]);

      const results = await db.listing_snapshots
        .where('[extensionId+date]')
        .between([extId, '2026-01-05'], [extId, '2026-01-10'], true, true)
        .toArray();
      expect(results).toHaveLength(2);
    });

    it('table.where(index).between() returns empty array when no records in range', async () => {
      const extId = 'emptyrangexxxxxxxxxxxxxxxxxxxxxxxxx';
      await db.listing_snapshots.add(
        makeListingSnapshot({ extensionId: extId, date: '2026-01-01' })
      );
      const results = await db.listing_snapshots
        .where('[extensionId+date]')
        .between([extId, '2026-06-01'], [extId, '2026-06-30'], true, true)
        .toArray();
      expect(results).toEqual([]);
    });

    it('table.count() returns correct count', async () => {
      await db.projects.bulkAdd([
        makeProject({ name: 'X' }),
        makeProject({ name: 'Y' }),
        makeProject({ name: 'Z' }),
      ]);
      expect(await db.projects.count()).toBe(3);
    });

    it('table.clear() removes all records', async () => {
      await db.projects.bulkAdd([
        makeProject({ name: 'A' }),
        makeProject({ name: 'B' }),
      ]);
      await db.projects.clear();
      expect(await db.projects.count()).toBe(0);
    });

    it('transaction commits on success', async () => {
      await db.transaction('rw', [db.projects, db.keywords], async () => {
        await db.projects.add(makeProject());
        await db.keywords.add(makeKeyword());
      });
      expect(await db.projects.count()).toBe(1);
      expect(await db.keywords.count()).toBe(1);
    });

    it('transaction aborts on error with no partial writes', async () => {
      try {
        await db.transaction('rw', [db.projects, db.keywords], async () => {
          await db.projects.add(makeProject({ name: 'Should not persist' }));
          throw new Error('Intentional abort');
        });
      } catch {
        // expected
      }
      expect(await db.projects.count()).toBe(0);
    });

    it('concurrent reads from different tables do not deadlock', async () => {
      await db.projects.add(makeProject());
      await db.extensions.add(makeExtension());

      const [projects, extensions] = await Promise.all([
        db.projects.toArray(),
        db.extensions.toArray(),
      ]);
      expect(projects).toHaveLength(1);
      expect(extensions).toHaveLength(1);
    });
  });
});
