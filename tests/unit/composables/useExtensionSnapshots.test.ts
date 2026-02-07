/**
 * Tests for useExtensionSnapshots composable.
 *
 * Covers loading own extension snapshots, delta calculations,
 * date range switching, sorting, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import { useExtensionSnapshots } from '@/dashboard/composables/useExtensionSnapshots';
import { today, daysAgo } from '@/shared/utils/dates';
import type { Extension, ListingSnapshot } from '@/shared/types';

/** Helper to create a minimal listing snapshot. */
function makeSnapshot(
  extensionId: string,
  date: string,
  overrides: Partial<ListingSnapshot> = {}
): Omit<ListingSnapshot, 'id'> {
  return {
    extensionId,
    date,
    title: 'Test Extension',
    shortDescription: 'Test',
    fullDescription: 'Full description',
    rating: 4.0,
    ratingCount: 100,
    reviewCount: 100,
    userCount: '10,000+',
    userCountNumeric: 10000,
    version: '1.0.0',
    lastUpdated: date,
    size: '1MiB',
    permissions: [],
    hostPermissions: [],
    permissionRiskScore: 0,
    badgeFlags: {},
    screenshotCount: 1,
    hasPromoVideo: false,
    translationCount: 1,
    availableLocales: ['en'],
    category: 'productivity',
    developerName: 'Dev',
    developerVerified: false,
    listingQualityScore: null,
    scannedAt: new Date(),
    ...overrides,
  };
}

const EXT_ID_1 = 'aaaabbbbccccddddeeeeffffgggghhhh';
const EXT_ID_2 = 'iiiijjjjkkkkllllmmmmnnnnoooopppp';

beforeEach(async () => {
  await db.projects.clear();
  await db.extensions.clear();
  await db.listing_snapshots.clear();
  await db.keywords.clear();
  await db.rank_snapshots.clear();
  await db.events.clear();
  await db.queue.clear();
  await db.translation_snapshots.clear();
});

describe('useExtensionSnapshots', () => {
  describe('loadSnapshots', () => {
    it('returns empty rows when no projects exist', async () => {
      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();
      expect(rows.value).toEqual([]);
    });

    it('loads own extensions only (not competitors)', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Own Ext',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveExtension({
        id: EXT_ID_2,
        name: 'Competitor',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveProject({
        name: 'Project A',
        ownExtensionId: EXT_ID_1,
        competitorIds: [EXT_ID_2],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      // Add snapshots for both
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, today(), { userCountNumeric: 5000, reviewCount: 50 }) as ListingSnapshot
      );
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_2, today(), { userCountNumeric: 3000, reviewCount: 30 }) as ListingSnapshot
      );

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      expect(rows.value).toHaveLength(1);
      expect(rows.value[0].extensionId).toBe(EXT_ID_1);
      expect(rows.value[0].name).toBe('Own Ext');
    });

    it('calculates deltas between consecutive days', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Test Ext',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveProject({
        name: 'Project',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      const day2 = daysAgo(5);
      const day3 = daysAgo(4);
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, day2, { userCountNumeric: 1000, reviewCount: 50 }) as ListingSnapshot
      );
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, day3, { userCountNumeric: 1200, reviewCount: 45 }) as ListingSnapshot
      );

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      const row = rows.value[0];
      const cell3 = row.days.get(day3);
      expect(cell3).toBeDefined();
      expect(cell3!.users).toBe(1200);
      expect(cell3!.reviews).toBe(45);
      expect(cell3!.usersDelta).toBe(200);
      expect(cell3!.reviewsDelta).toBe(-5);
    });

    it('calculates delta for first column using day-before-range data', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Test Ext',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveProject({
        name: 'Project',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      // Day before range (day 7 for a 7d range) and first visible day (day 6)
      const dayBeforeRange = daysAgo(7);
      const firstVisibleDay = daysAgo(6);

      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, dayBeforeRange, { userCountNumeric: 1000, reviewCount: 50 }) as ListingSnapshot
      );
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, firstVisibleDay, { userCountNumeric: 1100, reviewCount: 55 }) as ListingSnapshot
      );

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      const row = rows.value[0];
      const cell = row.days.get(firstVisibleDay);
      expect(cell).toBeDefined();
      // Should have delta because day-before-range exists
      expect(cell!.usersDelta).toBe(100);
      expect(cell!.reviewsDelta).toBe(5);
    });

    it('returns null deltas when no previous day exists', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Test Ext',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveProject({
        name: 'Project',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      // Only a single snapshot, no previous data
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, daysAgo(3), { userCountNumeric: 1000, reviewCount: 50 }) as ListingSnapshot
      );

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      const row = rows.value[0];
      const cell = row.days.get(daysAgo(3));
      expect(cell).toBeDefined();
      expect(cell!.usersDelta).toBeNull();
      expect(cell!.reviewsDelta).toBeNull();
    });

    it('handles gaps in snapshot data', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Test Ext',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveProject({
        name: 'Project',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      // Day 5 and day 3 (gap on day 4)
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, daysAgo(5), { userCountNumeric: 1000, reviewCount: 50 }) as ListingSnapshot
      );
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, daysAgo(3), { userCountNumeric: 1300, reviewCount: 60 }) as ListingSnapshot
      );

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      const row = rows.value[0];
      // Day 4 should have no cell
      expect(row.days.get(daysAgo(4))).toBeUndefined();
      // Day 3 delta should be computed against day 5 (skipping the gap)
      const cell = row.days.get(daysAgo(3));
      expect(cell).toBeDefined();
      expect(cell!.usersDelta).toBe(300);
      expect(cell!.reviewsDelta).toBe(10);
    });

    it('deduplicates own extensions across projects', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Shared Ext',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1, 2],
      });

      // Two projects with the same own extension
      await db.saveProject({
        name: 'Project A',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });
      await db.saveProject({
        name: 'Project B',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, today(), { userCountNumeric: 5000 }) as ListingSnapshot
      );

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      // Should only have one row
      expect(rows.value).toHaveLength(1);
    });

    it('sorts rows by project name then extension name', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Zulu Ext',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveExtension({
        id: EXT_ID_2,
        name: 'Alpha Ext',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [2],
      });
      await db.saveProject({
        name: 'Zulu Project',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });
      await db.saveProject({
        name: 'Alpha Project',
        ownExtensionId: EXT_ID_2,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, today()) as ListingSnapshot
      );
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_2, today()) as ListingSnapshot
      );

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      expect(rows.value).toHaveLength(2);
      expect(rows.value[0].projectName).toBe('Alpha Project');
      expect(rows.value[1].projectName).toBe('Zulu Project');
    });

    it('uses extension ID as fallback when name is empty', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: '',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveProject({
        name: 'Project',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, today()) as ListingSnapshot
      );

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      expect(rows.value[0].name).toBe(EXT_ID_1);
    });

    it('takes latest snapshot when multiple exist for same date', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Test Ext',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveProject({
        name: 'Project',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      const scanDate = daysAgo(2);
      // Earlier scan
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, scanDate, {
          userCountNumeric: 1000,
          scannedAt: new Date('2026-02-05T08:00:00'),
        }) as ListingSnapshot
      );
      // Later scan (should win)
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, scanDate, {
          userCountNumeric: 1100,
          scannedAt: new Date('2026-02-05T16:00:00'),
        }) as ListingSnapshot
      );

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      const cell = rows.value[0].days.get(scanDate);
      expect(cell).toBeDefined();
      expect(cell!.users).toBe(1100);
    });

    it('handles DB errors gracefully', async () => {
      const spy = vi
        .spyOn(db, 'getAllProjects')
        .mockRejectedValueOnce(new Error('DB error'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      expect(rows.value).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load extension snapshots:',
        expect.any(Error)
      );

      spy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('skips extensions not found in DB', async () => {
      const now = new Date();
      // Project references an extension that doesn't exist in the extensions table
      await db.saveProject({
        name: 'Ghost Project',
        ownExtensionId: 'nonexistent_ext_idnonexistent_e',
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      const { rows, loadSnapshots } = useExtensionSnapshots();
      await loadSnapshots();

      expect(rows.value).toEqual([]);
    });
  });

  describe('dateColumns', () => {
    it('generates correct date columns for 7d range', () => {
      const { dateColumns } = useExtensionSnapshots();
      const columns = dateColumns.value;
      expect(columns).toHaveLength(7);
      expect(columns[0]).toBe(daysAgo(6));
      expect(columns[6]).toBe(today());
    });

    it('updates columns when date range changes', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Test',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveProject({
        name: 'Project',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      const { dateColumns, setDateRange } = useExtensionSnapshots();
      expect(dateColumns.value).toHaveLength(7);

      await setDateRange(14);
      expect(dateColumns.value).toHaveLength(14);
      expect(dateColumns.value[0]).toBe(daysAgo(13));
      expect(dateColumns.value[13]).toBe(today());
    });
  });

  describe('setDateRange', () => {
    it('updates date range and reloads data', async () => {
      const now = new Date();
      await db.saveExtension({
        id: EXT_ID_1,
        name: 'Test',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [1],
      });
      await db.saveProject({
        name: 'Project',
        ownExtensionId: EXT_ID_1,
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      // Snapshot 20 days ago (visible in 30d, not in 7d)
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, daysAgo(20), { userCountNumeric: 500 }) as ListingSnapshot
      );

      const { rows, dateRange, loadSnapshots, setDateRange } = useExtensionSnapshots();

      await loadSnapshots();
      const row7 = rows.value[0];
      expect(row7?.days.get(daysAgo(20))).toBeUndefined();

      await setDateRange(30);
      expect(dateRange.value).toBe(30);
      const row30 = rows.value[0];
      expect(row30?.days.get(daysAgo(20))).toBeDefined();
      expect(row30!.days.get(daysAgo(20))!.users).toBe(500);
    });
  });
});
