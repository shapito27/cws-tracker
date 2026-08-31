/**
 * Data-safety guarantees for slot-aware snapshot storage.
 *
 * The upsert changed from "delete every row for this date" to "delete only this
 * slot's row". These tests pin the cases where that could go wrong: upgrading an
 * existing install, changing `scansPerDay` in either direction, and re-running a
 * slot. The invariant throughout is that nothing already recorded is lost except
 * the specific sample being replaced.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/shared/db/database';
import type { ListingSnapshot, RankSnapshot, AutocompleteSnapshot } from '@/shared/types';

const EXT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function listing(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    extensionId: EXT,
    date: '2026-08-20',
    title: 'Title',
    shortDescription: '',
    fullDescription: '',
    rating: 4,
    ratingCount: 10,
    reviewCount: 10,
    userCount: '1,000+',
    userCountNumeric: 1000,
    version: '1.0.0',
    lastUpdated: '2026-08-01',
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
    scannedAt: new Date('2026-08-20T03:00:00'),
    ...overrides,
  };
}

function rank(overrides: Partial<RankSnapshot> = {}): RankSnapshot {
  return {
    keywordId: 1,
    extensionId: EXT,
    date: '2026-08-20',
    position: 5,
    totalResults: 100,
    scannedAt: new Date('2026-08-20T03:00:00'),
    ...overrides,
  };
}

function autocomplete(overrides: Partial<AutocompleteSnapshot> = {}): AutocompleteSnapshot {
  return {
    keywordId: 1,
    extensionId: EXT,
    date: '2026-08-20',
    position: 3,
    suggestedName: 'Thing',
    scannedAt: new Date('2026-08-20T03:00:00'),
    ...overrides,
  };
}

beforeEach(async () => {
  await db.listing_snapshots.clear();
  await db.rank_snapshots.clear();
  await db.autocomplete_snapshots.clear();
  await db.autocomplete_keyword_suggestions.clear();
});

describe('upgrading an existing install', () => {
  it('a slot-0 scan replaces an untagged legacy snapshot rather than duplicating it', async () => {
    // Every row written before this feature has no `slot`. The single daily scan
    // they came from is slot 0, so slot 0 must still own them.
    await db.listing_snapshots.put(listing({ title: 'Before upgrade' }));

    await db.saveListingSnapshot(listing({ title: 'After upgrade', slot: 0 }));

    const all = await db.listing_snapshots.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('After upgrade');
  });

  it('a later slot does not disturb an untagged legacy snapshot', async () => {
    await db.listing_snapshots.put(listing({ title: 'Legacy' }));

    await db.saveListingSnapshot(
      listing({ title: 'Slot 1', slot: 1, scannedAt: new Date('2026-08-20T11:00:00') })
    );

    const titles = (await db.listing_snapshots.toArray()).map((s) => s.title).sort();
    expect(titles).toEqual(['Legacy', 'Slot 1']);
  });

  it('leaves every historical date untouched', async () => {
    await db.rank_snapshots.bulkAdd([
      rank({ date: '2026-08-17', position: 9 }),
      rank({ date: '2026-08-18', position: 8 }),
      rank({ date: '2026-08-19', position: 7 }),
    ]);

    await db.saveRankSnapshots([rank({ date: '2026-08-20', position: 5, slot: 0 })]);

    expect(await db.rank_snapshots.count()).toBe(4);
  });
});

describe('changing scansPerDay', () => {
  it('lowering it does not delete the extra slots already recorded', async () => {
    // Someone scanning 3x/day drops to 1x. The samples already taken are real
    // observations and must survive; only the slot being written is replaced.
    await db.saveRankSnapshots([rank({ position: 9, slot: 0, scannedAt: new Date('2026-08-20T03:00:00') })]);
    await db.saveRankSnapshots([rank({ position: 5, slot: 1, scannedAt: new Date('2026-08-20T11:00:00') })]);
    await db.saveRankSnapshots([rank({ position: 7, slot: 2, scannedAt: new Date('2026-08-20T19:00:00') })]);
    expect(await db.rank_snapshots.count()).toBe(3);

    // Now at scansPerDay: 1, a scan writes slot 0.
    await db.saveRankSnapshots([rank({ position: 4, slot: 0, scannedAt: new Date('2026-08-20T20:00:00') })]);

    const all = await db.rank_snapshots.toArray();
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.position).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([4, 5, 7]);
  });

  it('raising it accumulates samples instead of overwriting', async () => {
    for (const [slot, time, position] of [
      [0, '03:00:00', 9],
      [1, '11:00:00', 5],
      [2, '19:00:00', 7],
    ] as const) {
      await db.saveRankSnapshots([
        rank({ slot, position, scannedAt: new Date(`2026-08-20T${time}`) }),
      ]);
    }

    expect(await db.rank_snapshots.count()).toBe(3);
  });
});

describe('re-running a slot', () => {
  it('replaces only that slot across all four snapshot tables', async () => {
    await db.saveListingSnapshot(listing({ title: 'A', slot: 0 }));
    await db.saveListingSnapshot(listing({ title: 'B', slot: 1 }));
    await db.saveRankSnapshots([rank({ position: 9, slot: 0 }), rank({ position: 5, slot: 1 })]);
    await db.saveAutocompleteSnapshots([
      autocomplete({ position: 3, slot: 0 }),
      autocomplete({ position: 2, slot: 1 }),
    ]);
    await db.saveAutocompleteSuggestions({
      keywordId: 1, date: '2026-08-20', slot: 0,
      suggestions: ['a'], scannedAt: new Date('2026-08-20T03:00:00'),
    });
    await db.saveAutocompleteSuggestions({
      keywordId: 1, date: '2026-08-20', slot: 1,
      suggestions: ['b'], scannedAt: new Date('2026-08-20T11:00:00'),
    });

    // Re-run slot 0 everywhere.
    await db.saveListingSnapshot(listing({ title: 'A2', slot: 0 }));
    await db.saveRankSnapshots([rank({ position: 8, slot: 0 })]);
    await db.saveAutocompleteSnapshots([autocomplete({ position: 4, slot: 0 })]);
    await db.saveAutocompleteSuggestions({
      keywordId: 1, date: '2026-08-20', slot: 0,
      suggestions: ['a2'], scannedAt: new Date('2026-08-20T03:30:00'),
    });

    expect((await db.listing_snapshots.toArray()).map((s) => s.title).sort()).toEqual(['A2', 'B']);
    expect((await db.rank_snapshots.toArray()).map((s) => s.position).sort()).toEqual([5, 8]);
    expect((await db.autocomplete_snapshots.toArray()).map((s) => s.position).sort()).toEqual([2, 4]);
    expect(
      (await db.autocomplete_keyword_suggestions.toArray())
        .flatMap((s) => s.suggestions)
        .sort()
    ).toEqual(['a2', 'b']);
  });

  it('keeps rank snapshots for other extensions and keywords', async () => {
    const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await db.saveRankSnapshots([
      rank({ position: 5, slot: 0 }),
      rank({ extensionId: OTHER, position: 9, slot: 0 }),
      rank({ keywordId: 2, position: 12, slot: 0 }),
    ]);

    await db.saveRankSnapshots([rank({ position: 3, slot: 0 })]);

    const all = await db.rank_snapshots.toArray();
    expect(all).toHaveLength(3);
    expect(all.find((s) => s.extensionId === OTHER)!.position).toBe(9);
    expect(all.find((s) => s.keywordId === 2)!.position).toBe(12);
  });
});

describe('the day still reads as one value', () => {
  it('rolls three samples up to the last one', async () => {
    const { rollupByDate } = await import('@/shared/utils/daily-rollup');

    await db.saveRankSnapshots([rank({ position: 9, slot: 0, scannedAt: new Date('2026-08-20T03:00:00') })]);
    await db.saveRankSnapshots([rank({ position: 5, slot: 1, scannedAt: new Date('2026-08-20T11:00:00') })]);
    await db.saveRankSnapshots([rank({ position: 7, slot: 2, scannedAt: new Date('2026-08-20T19:00:00') })]);

    const rolled = rollupByDate(await db.rank_snapshots.toArray());

    expect(rolled).toHaveLength(1);
    expect(rolled[0].value.position).toBe(7);
    expect(rolled[0].count).toBe(3);
  });
});

describe('counting the day\'s scans', () => {
  it('reports the distinct slots that produced data', async () => {
    await db.saveListingSnapshot(listing({ slot: 0, scannedAt: new Date('2026-08-20T03:00:00') }));
    await db.saveListingSnapshot(listing({ slot: 2, scannedAt: new Date('2026-08-20T15:00:00') }));

    expect(await db.getScanSlotsForDate(EXT, '2026-08-20')).toEqual([0, 2]);
  });

  it('counts a pre-upgrade untagged snapshot as slot 0', async () => {
    await db.listing_snapshots.put(listing());

    expect(await db.getScanSlotsForDate(EXT, '2026-08-20')).toEqual([0]);
  });

  it('does not count another day or another extension', async () => {
    await db.saveListingSnapshot(listing({ slot: 0 }));
    await db.saveListingSnapshot(listing({ slot: 1, date: '2026-08-19' }));
    await db.saveListingSnapshot(
      listing({ slot: 3, extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })
    );

    expect(await db.getScanSlotsForDate(EXT, '2026-08-20')).toEqual([0]);
  });

  it('is empty when nothing was scanned that day', async () => {
    expect(await db.getScanSlotsForDate(EXT, '2026-08-20')).toEqual([]);
  });
});
