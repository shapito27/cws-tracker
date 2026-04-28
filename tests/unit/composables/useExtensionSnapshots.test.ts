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
    developerEmail: null,
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

      const { dateColumns, setRangeDays } = useExtensionSnapshots();
      expect(dateColumns.value).toHaveLength(7);

      await setRangeDays(14);
      expect(dateColumns.value).toHaveLength(14);
      expect(dateColumns.value[0]).toBe(daysAgo(13));
      expect(dateColumns.value[13]).toBe(today());
    });
  });

  describe('setRangeDays', () => {
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

      const { rows, rangeDays, loadSnapshots, setRangeDays } = useExtensionSnapshots();

      await loadSnapshots();
      const row7 = rows.value[0];
      expect(row7?.days.get(daysAgo(20))).toBeUndefined();

      await setRangeDays(30);
      expect(rangeDays.value).toBe(30);
      const row30 = rows.value[0];
      expect(row30?.days.get(daysAgo(20))).toBeDefined();
      expect(row30!.days.get(daysAgo(20))!.users).toBe(500);
    });
  });

  describe('setStep (Daily/Weekly toggle)', () => {
    async function seedExtension(): Promise<void> {
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
    }

    it('defaults to daily mode with 7-day range', () => {
      const { step, rangeDays, dateColumns } = useExtensionSnapshots();
      expect(step.value).toBe('daily');
      expect(rangeDays.value).toBe(7);
      expect(dateColumns.value).toHaveLength(7);
    });

    it('switching to weekly from default produces 4 weekly columns', async () => {
      await seedExtension();
      const { step, rangeDays, dateColumns, setStep } = useExtensionSnapshots();

      await setStep('weekly');

      expect(step.value).toBe('weekly');
      expect(rangeDays.value).toBe(28);
      expect(dateColumns.value).toHaveLength(4);
      expect(dateColumns.value[0]).toBe(daysAgo(21));
      expect(dateColumns.value[1]).toBe(daysAgo(14));
      expect(dateColumns.value[2]).toBe(daysAgo(7));
      expect(dateColumns.value[3]).toBe(today());
    });

    it('preserves range "position" when toggling Daily -> Weekly', async () => {
      await seedExtension();
      const { rangeDays, setRangeDays, setStep } = useExtensionSnapshots();

      await setRangeDays(30);
      await setStep('weekly');
      expect(rangeDays.value).toBe(182);
    });

    it('preserves range "position" when toggling Weekly -> Daily', async () => {
      await seedExtension();
      const { rangeDays, setRangeDays, setStep } = useExtensionSnapshots();

      await setStep('weekly');
      await setRangeDays(84);
      await setStep('daily');
      expect(rangeDays.value).toBe(14);
    });

    it('renders 26 weekly columns at the longest range', async () => {
      await seedExtension();
      const { dateColumns, setStep, setRangeDays } = useExtensionSnapshots();

      await setStep('weekly');
      await setRangeDays(182);

      expect(dateColumns.value).toHaveLength(26);
      expect(dateColumns.value[25]).toBe(today());
      expect(dateColumns.value[0]).toBe(daysAgo(175));
    });

    it('computes week-over-week deltas from the previous visible column', async () => {
      await seedExtension();

      // Snapshots exactly 7 days apart so each weekly column has data.
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, daysAgo(21), { userCountNumeric: 1000, reviewCount: 50 }) as ListingSnapshot
      );
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, daysAgo(14), { userCountNumeric: 1100, reviewCount: 55 }) as ListingSnapshot
      );
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, daysAgo(7), { userCountNumeric: 1300, reviewCount: 60 }) as ListingSnapshot
      );
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, today(), { userCountNumeric: 1500, reviewCount: 70 }) as ListingSnapshot
      );

      const { rows, setStep, loadSnapshots } = useExtensionSnapshots();
      await setStep('weekly');
      await loadSnapshots();

      const row = rows.value[0];
      // Rightmost column: today vs 7d ago
      const todayCell = row.days.get(today());
      expect(todayCell).toBeDefined();
      expect(todayCell!.usersDelta).toBe(200);
      expect(todayCell!.reviewsDelta).toBe(10);

      // Middle column: 7d ago vs 14d ago
      const week1Cell = row.days.get(daysAgo(7));
      expect(week1Cell!.usersDelta).toBe(200);
      expect(week1Cell!.reviewsDelta).toBe(5);
    });

    it('uses buffer snapshot for leftmost-column delta in weekly mode', async () => {
      await seedExtension();

      // Buffer snapshot 28 days ago (one week before the leftmost visible column at 21d)
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, daysAgo(28), { userCountNumeric: 800, reviewCount: 40 }) as ListingSnapshot
      );
      await db.saveListingSnapshot(
        makeSnapshot(EXT_ID_1, daysAgo(21), { userCountNumeric: 1000, reviewCount: 50 }) as ListingSnapshot
      );

      const { rows, setStep, loadSnapshots } = useExtensionSnapshots();
      await setStep('weekly');
      await loadSnapshots();

      const cell = rows.value[0].days.get(daysAgo(21));
      expect(cell).toBeDefined();
      expect(cell!.usersDelta).toBe(200);
      expect(cell!.reviewsDelta).toBe(10);
    });

    it('is a no-op when switching to the current step', async () => {
      await seedExtension();
      const { step, rangeDays, setStep } = useExtensionSnapshots();
      const spy = vi.spyOn(db, 'getAllProjects');

      await setStep('daily');

      expect(step.value).toBe('daily');
      expect(rangeDays.value).toBe(7);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('setRangeDays cross-mode guard', () => {
    it('ignores a daily range value when in weekly mode', async () => {
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

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { rangeDays, setStep, setRangeDays } = useExtensionSnapshots();

      await setStep('weekly');
      expect(rangeDays.value).toBe(28);

      // 14 is a daily range — should be rejected in weekly mode.
      await setRangeDays(14);
      expect(rangeDays.value).toBe(28);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('ignores a weekly range value when in daily mode', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { rangeDays, setRangeDays } = useExtensionSnapshots();

      await setRangeDays(84);
      expect(rangeDays.value).toBe(7);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});
