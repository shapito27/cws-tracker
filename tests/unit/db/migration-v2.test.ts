/**
 * Phase 2.6 - Database Migration v2 Verification Tests.
 *
 * Confirms that no v2 migration is needed: all Phase 2 features
 * (quality score, comparison, keyword analysis, diff, event annotations)
 * compute data on-the-fly from the existing v1 schema.
 *
 * These tests validate that:
 * 1. Phase 2 query patterns work with v1 indexes
 * 2. Populated v1 data is fully usable for Phase 2 features
 * 3. No new stores or indexes are required
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CWSDatabase } from '@/shared/db/database';
import type {
  ListingSnapshot,
  RankSnapshot,
  EventRecord,
} from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeListingSnapshot(
  overrides: Partial<ListingSnapshot> = {}
): ListingSnapshot {
  return {
    extensionId: 'abcdefghijklmnopqrstuvwxyz012345',
    date: '2026-01-15',
    title: 'Test Extension',
    shortDescription: 'A test extension for the Chrome Web Store',
    fullDescription:
      'Full description of the test extension with keywords and details.',
    rating: 4.5,
    ratingCount: 100,
    reviewCount: 80,
    userCount: '10,000+',
    userCountNumeric: 10000,
    version: '1.0.0',
    lastUpdated: '2026-01-10',
    size: '1.5MiB',
    permissions: ['storage', 'tabs'],
    hostPermissions: [],
    permissionRiskScore: 20,
    badgeFlags: { featured: true },
    screenshotCount: 3,
    hasPromoVideo: false,
    translationCount: 5,
    availableLocales: ['en', 'es', 'fr', 'de', 'ja'],
    category: 'productivity',
    developerName: 'Test Developer',
    developerEmail: null,
    developerVerified: true,
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

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let dbCounter = 0;

describe('Phase 2.6 - Database Migration v2 Verification', () => {
  let db: CWSDatabase;

  beforeEach(() => {
    db = new CWSDatabase(`MigrationV2Test_${++dbCounter}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  describe('v1 schema supports Phase 2.1 (Quality Score) queries', () => {
    it('listingQualityScore field is stored and retrievable in v1 schema', async () => {
      await db.listing_snapshots.add(
        makeListingSnapshot({ listingQualityScore: null })
      );
      const snapshot = await db.listing_snapshots.toArray();
      expect(snapshot[0].listingQualityScore).toBeNull();
    });

    it('getLatestListingSnapshot returns data for on-the-fly quality score calculation', async () => {
      const extId = 'qualitytestidxxxxxxxxxxxxxxxxxxx';
      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({ extensionId: extId, date: '2026-01-10' }),
        makeListingSnapshot({ extensionId: extId, date: '2026-01-15' }),
      ]);

      const latest = await db.getLatestListingSnapshot(extId);
      expect(latest).toBeDefined();
      expect(latest!.date).toBe('2026-01-15');
      // All fields needed for quality score calculation are present
      expect(latest!.title).toBeDefined();
      expect(latest!.shortDescription).toBeDefined();
      expect(latest!.fullDescription).toBeDefined();
      expect(latest!.screenshotCount).toBeDefined();
      expect(latest!.rating).toBeDefined();
      expect(latest!.reviewCount).toBeDefined();
      expect(latest!.translationCount).toBeDefined();
      expect(latest!.lastUpdated).toBeDefined();
      expect(latest!.permissions).toBeDefined();
      expect(latest!.developerVerified).toBeDefined();
    });
  });

  describe('v1 schema supports Phase 2.2 (Comparison View) queries', () => {
    it('retrieves latest snapshots for multiple extensions for comparison', async () => {
      const ext1 = 'compext1xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const ext2 = 'compext2xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const ext3 = 'compext3xxxxxxxxxxxxxxxxxxxxxxxxxxxx';

      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({ extensionId: ext1, date: '2026-01-15' }),
        makeListingSnapshot({ extensionId: ext2, date: '2026-01-15' }),
        makeListingSnapshot({ extensionId: ext3, date: '2026-01-15' }),
      ]);

      // Comparison view fetches latest snapshot per extension
      const snapshots = await Promise.all([
        db.getLatestListingSnapshot(ext1),
        db.getLatestListingSnapshot(ext2),
        db.getLatestListingSnapshot(ext3),
      ]);

      expect(snapshots.every((s) => s !== undefined)).toBe(true);
      expect(snapshots).toHaveLength(3);
    });

    it('comparison fields (permissions, descriptions) are available without new indexes', async () => {
      const extId = 'permcompxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      await db.listing_snapshots.add(
        makeListingSnapshot({
          extensionId: extId,
          permissions: ['storage', 'tabs', 'history'],
          hostPermissions: ['https://example.com/*'],
          fullDescription: 'A detailed description with many keywords.',
        })
      );

      const snapshot = await db.getLatestListingSnapshot(extId);
      expect(snapshot!.permissions).toEqual(['storage', 'tabs', 'history']);
      expect(snapshot!.hostPermissions).toEqual(['https://example.com/*']);
      expect(snapshot!.fullDescription).toContain('keywords');
    });
  });

  describe('v1 schema supports Phase 2.3 (Event Annotations) queries', () => {
    it('getEvents returns events in date range for chart annotations', async () => {
      const extId = 'annotext1xxxxxxxxxxxxxxxxxxxxxxxxxxx';
      await db.events.bulkAdd([
        makeEvent({
          extensionId: extId,
          date: '2026-01-10',
          type: 'version_change',
        }),
        makeEvent({
          extensionId: extId,
          date: '2026-01-15',
          type: 'title_change',
        }),
        makeEvent({
          extensionId: extId,
          date: '2026-01-20',
          type: 'permission_change',
        }),
      ]);

      const events = await db.getEvents(extId, '2026-01-01', '2026-01-31');
      expect(events).toHaveLength(3);
      // Events have all fields needed for annotations (date, type, note)
      expect(events[0].date).toBeDefined();
      expect(events[0].type).toBeDefined();
      expect(events[0].note).toBeDefined();
    });

    it('events from multiple extensions can be queried for a project', async () => {
      const ext1 = 'annext1xxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const ext2 = 'annext2xxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

      await db.events.bulkAdd([
        makeEvent({ extensionId: ext1, date: '2026-01-15', type: 'title_change' }),
        makeEvent({ extensionId: ext2, date: '2026-01-15', type: 'version_change' }),
        makeEvent({ extensionId: ext1, date: '2026-01-20', type: 'user_milestone' }),
      ]);

      // Dashboard loads events for each extension in parallel
      const [ext1Events, ext2Events] = await Promise.all([
        db.getEvents(ext1, '2026-01-01', '2026-01-31'),
        db.getEvents(ext2, '2026-01-01', '2026-01-31'),
      ]);

      expect(ext1Events).toHaveLength(2);
      expect(ext2Events).toHaveLength(1);
    });
  });

  describe('v1 schema supports Phase 2.4 (Keyword Analysis) queries', () => {
    it('listing snapshots provide text data for keyword frequency analysis', async () => {
      const ext1 = 'kwanext1xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const ext2 = 'kwanext2xxxxxxxxxxxxxxxxxxxxxxxxxxxx';

      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({
          extensionId: ext1,
          title: 'Best Ad Blocker',
          shortDescription: 'Block ads quickly',
          fullDescription: 'Ad blocker extension that blocks all ads.',
        }),
        makeListingSnapshot({
          extensionId: ext2,
          title: 'Super Ad Filter',
          shortDescription: 'Filter ads easily',
          fullDescription: 'Advanced ad filtering with custom rules.',
        }),
      ]);

      const snapshots = await Promise.all([
        db.getLatestListingSnapshot(ext1),
        db.getLatestListingSnapshot(ext2),
      ]);

      // Keyword frequency matrix is built from title, shortDescription, fullDescription
      expect(snapshots[0]!.title).toContain('Ad Blocker');
      expect(snapshots[1]!.title).toContain('Ad Filter');
    });

    it('rank snapshots provide position data for keyword difficulty estimation', async () => {
      const ext1 = 'kwdext1xxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const ext2 = 'kwdext2xxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({
          keywordId: 1,
          extensionId: ext1,
          date: '2026-01-15',
          position: 1,
        }),
        makeRankSnapshot({
          keywordId: 1,
          extensionId: ext2,
          date: '2026-01-15',
          position: 3,
        }),
      ]);

      // Keyword difficulty uses latest ranks for a keyword
      const ranks = await db.getLatestRankForKeyword(1);
      expect(ranks).toHaveLength(2);
      expect(ranks.some((r) => r.position === 1)).toBe(true);
      expect(ranks.some((r) => r.position === 3)).toBe(true);
    });
  });

  describe('v1 schema supports Phase 2.5 (Diff View) queries', () => {
    it('events store old and new values for diff rendering', async () => {
      const extId = 'diffextxxxxxxxxxxxxxxxxxxxxxxxxxx01';
      await db.events.add(
        makeEvent({
          extensionId: extId,
          type: 'title_change',
          oldValue: 'My Extension - Ad Blocker',
          newValue: 'My Extension - Best Ad Blocker 2026',
        })
      );

      const events = await db.getEvents(extId, '2026-01-01', '2026-12-31');
      expect(events).toHaveLength(1);
      expect(events[0].oldValue).toBe('My Extension - Ad Blocker');
      expect(events[0].newValue).toBe('My Extension - Best Ad Blocker 2026');
    });

    it('permission change events store JSON arrays for permission diff', async () => {
      const extId = 'diffextxxxxxxxxxxxxxxxxxxxxxxxxxx02';
      await db.events.add(
        makeEvent({
          extensionId: extId,
          type: 'permission_change',
          field: 'permissions',
          oldValue: JSON.stringify(['storage', 'tabs']),
          newValue: JSON.stringify(['storage', 'tabs', 'history']),
        })
      );

      const events = await db.getEvents(extId, '2026-01-01', '2026-12-31');
      const perms = JSON.parse(events[0].newValue!);
      expect(perms).toContain('history');
    });
  });

  describe('v2 schema adds audit_cache table', () => {
    it('all 12 stores exist in v4', async () => {
      await db.open();
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

    it('schema version is 4', async () => {
      await db.open();
      expect(db.verno).toBe(4);
    });

    it('populated v1 data is fully usable for all Phase 2 features', async () => {
      // Populate with realistic data across all stores used by Phase 2
      const extId = 'fullphase2xxxxxxxxxxxxxxxxxxxxxxxxxx';

      await db.listing_snapshots.bulkAdd([
        makeListingSnapshot({
          extensionId: extId,
          date: '2026-01-10',
          title: 'Old Title',
          version: '1.0.0',
        }),
        makeListingSnapshot({
          extensionId: extId,
          date: '2026-01-15',
          title: 'New Title',
          version: '1.1.0',
        }),
      ]);

      await db.rank_snapshots.bulkAdd([
        makeRankSnapshot({
          keywordId: 1,
          extensionId: extId,
          date: '2026-01-10',
          position: 8,
        }),
        makeRankSnapshot({
          keywordId: 1,
          extensionId: extId,
          date: '2026-01-15',
          position: 5,
        }),
      ]);

      await db.events.bulkAdd([
        makeEvent({
          extensionId: extId,
          date: '2026-01-15',
          type: 'title_change',
          oldValue: 'Old Title',
          newValue: 'New Title',
        }),
        makeEvent({
          extensionId: extId,
          date: '2026-01-15',
          type: 'version_change',
          oldValue: '1.0.0',
          newValue: '1.1.0',
        }),
      ]);

      // Quality score: needs latest snapshot
      const latest = await db.getLatestListingSnapshot(extId);
      expect(latest).toBeDefined();
      expect(latest!.title).toBe('New Title');

      // Comparison: needs snapshot per extension
      const snapshots = await db.getListingSnapshots(
        extId,
        '2026-01-01',
        '2026-01-31'
      );
      expect(snapshots).toHaveLength(2);

      // Event annotations: needs events in date range
      const events = await db.getEvents(extId, '2026-01-01', '2026-01-31');
      expect(events).toHaveLength(2);

      // Keyword analysis: needs rank snapshots
      const ranks = await db.getLatestRankForKeyword(1);
      expect(ranks).toHaveLength(1);
      expect(ranks[0].position).toBe(5);

      // Diff view: needs event old/new values
      const titleEvent = events.find((e) => e.type === 'title_change');
      expect(titleEvent!.oldValue).toBe('Old Title');
      expect(titleEvent!.newValue).toBe('New Title');
    });
  });
});
