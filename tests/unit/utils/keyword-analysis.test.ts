/**
 * Tests for keyword analysis utilities (Phase 2.4).
 *
 * Covers keyword frequency matrix, gap analysis, keyword difficulty estimation,
 * and edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  buildKeywordFrequencyMatrix,
  hasLowerDensity,
  analyzeKeywordGaps,
  estimateKeywordDifficulty,
  type KeywordFrequencyRow,
} from '../../../src/shared/utils/keyword-analysis';
import type { ListingSnapshot, RankSnapshot } from '../../../src/shared/types/index';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    date: '2026-02-05',
    title: 'Ad Blocker - Block Ads Fast',
    shortDescription: 'Block annoying ads on every website. Fast and lightweight ad blocker.',
    fullDescription: 'Ad Blocker is the best ad blocking extension for Chrome. It blocks ads on every website quickly and efficiently. Features include popup blocking, tracker blocking, and custom filter lists.',
    rating: 4.5,
    ratingCount: 200,
    reviewCount: 200,
    userCount: '100,000+',
    userCountNumeric: 100000,
    version: '3.0.0',
    lastUpdated: '2026-01-15',
    size: '2.1MiB',
    permissions: ['storage', 'webRequest', 'tabs'],
    hostPermissions: ['<all_urls>'],
    permissionRiskScore: 65,
    badgeFlags: { featured: true },
    screenshotCount: 5,
    hasPromoVideo: false,
    translationCount: 15,
    availableLocales: ['en', 'es', 'fr', 'de', 'ja'],
    category: 'Productivity',
    developerName: 'Dev Inc.',
    developerEmail: null,
    developerVerified: true,
    listingQualityScore: null,
    scannedAt: new Date('2026-02-05T12:00:00Z'),
    ...overrides,
  };
}

function makeRankSnapshot(overrides: Partial<RankSnapshot> = {}): RankSnapshot {
  return {
    id: 1,
    keywordId: 1,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    date: '2026-02-05',
    position: 1,
    totalResults: 100,
    scannedAt: new Date('2026-02-05T12:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Keyword frequency matrix (2.4.2)
// ---------------------------------------------------------------------------

describe('buildKeywordFrequencyMatrix', () => {
  it('returns empty array for no keywords', () => {
    const snap = makeSnapshot();
    const result = buildKeywordFrequencyMatrix([], new Map([['ext1', snap]]));
    expect(result).toEqual([]);
  });

  it('returns rows with zero counts when keyword not found in any description', () => {
    const snap = makeSnapshot({
      title: 'Hello World',
      shortDescription: 'A test extension',
      fullDescription: 'This is a test extension description.',
    });
    const result = buildKeywordFrequencyMatrix(['xyz'], new Map([['ext1', snap]]));
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('xyz');
    expect(result[0].cells).toHaveLength(1);
    expect(result[0].cells[0].titleCount).toBe(0);
    expect(result[0].cells[0].shortDescCount).toBe(0);
    expect(result[0].cells[0].fullDescCount).toBe(0);
    expect(result[0].cells[0].totalCount).toBe(0);
  });

  it('correctly counts keyword occurrences in title, short desc, and full desc', () => {
    const snap = makeSnapshot();
    const result = buildKeywordFrequencyMatrix(['ad'], new Map([['ext1', snap]]));
    expect(result).toHaveLength(1);
    const cell = result[0].cells[0];
    expect(cell.extensionId).toBe('ext1');
    // "Ad Blocker - Block Ads Fast" → "ad" as whole word = 1 match ("Ad")
    expect(cell.titleCount).toBe(1);
    // "Block annoying ads on every website. Fast and lightweight ad blocker."
    expect(cell.shortDescCount).toBe(1);
    // Full desc: "Ad Blocker is the best ad blocking..." → 2 matches
    expect(cell.fullDescCount).toBe(2);
    expect(cell.totalCount).toBe(4);
  });

  it('works with multiple keywords and multiple extensions', () => {
    const snap1 = makeSnapshot({ extensionId: 'ext1' });
    const snap2 = makeSnapshot({
      extensionId: 'ext2',
      title: 'VPN Proxy Extension',
      shortDescription: 'A fast vpn proxy for browsing.',
      fullDescription: 'This vpn proxy helps you browse securely with vpn protection.',
    });

    const result = buildKeywordFrequencyMatrix(
      ['ad', 'vpn'],
      new Map([['ext1', snap1], ['ext2', snap2]])
    );

    expect(result).toHaveLength(2);

    // "ad" keyword
    const adRow = result[0];
    expect(adRow.keyword).toBe('ad');
    expect(adRow.cells).toHaveLength(2);
    expect(adRow.cells[0].extensionId).toBe('ext1');
    expect(adRow.cells[0].totalCount).toBeGreaterThan(0);
    expect(adRow.cells[1].extensionId).toBe('ext2');
    expect(adRow.cells[1].totalCount).toBe(0); // no "ad" whole word in VPN text

    // "vpn" keyword
    const vpnRow = result[1];
    expect(vpnRow.keyword).toBe('vpn');
    expect(vpnRow.cells[0].totalCount).toBe(0); // no "vpn" in ad blocker
    expect(vpnRow.cells[1].totalCount).toBeGreaterThan(0); // "vpn" in VPN extension
  });

  it('handles empty snapshots map', () => {
    const result = buildKeywordFrequencyMatrix(['ad'], new Map());
    expect(result).toHaveLength(1);
    expect(result[0].cells).toHaveLength(0);
  });

  it('handles empty text fields in snapshot', () => {
    const snap = makeSnapshot({
      title: '',
      shortDescription: '',
      fullDescription: '',
    });
    const result = buildKeywordFrequencyMatrix(['test'], new Map([['ext1', snap]]));
    expect(result).toHaveLength(1);
    expect(result[0].cells[0].totalCount).toBe(0);
  });
});

describe('hasLowerDensity', () => {
  it('returns true when competitor has higher total count', () => {
    const row: KeywordFrequencyRow = {
      keyword: 'test',
      cells: [
        { extensionId: 'own', titleCount: 0, shortDescCount: 1, fullDescCount: 0, totalCount: 1 },
        { extensionId: 'comp', titleCount: 1, shortDescCount: 1, fullDescCount: 2, totalCount: 4 },
      ],
    };
    expect(hasLowerDensity(row, 'own')).toBe(true);
  });

  it('returns false when own extension has equal or higher count', () => {
    const row: KeywordFrequencyRow = {
      keyword: 'test',
      cells: [
        { extensionId: 'own', titleCount: 2, shortDescCount: 1, fullDescCount: 3, totalCount: 6 },
        { extensionId: 'comp', titleCount: 1, shortDescCount: 0, fullDescCount: 2, totalCount: 3 },
      ],
    };
    expect(hasLowerDensity(row, 'own')).toBe(false);
  });

  it('returns false when own extension not found', () => {
    const row: KeywordFrequencyRow = {
      keyword: 'test',
      cells: [
        { extensionId: 'comp', titleCount: 1, shortDescCount: 1, fullDescCount: 2, totalCount: 4 },
      ],
    };
    expect(hasLowerDensity(row, 'own')).toBe(false);
  });

  it('returns false when all counts are zero', () => {
    const row: KeywordFrequencyRow = {
      keyword: 'test',
      cells: [
        { extensionId: 'own', titleCount: 0, shortDescCount: 0, fullDescCount: 0, totalCount: 0 },
        { extensionId: 'comp', titleCount: 0, shortDescCount: 0, fullDescCount: 0, totalCount: 0 },
      ],
    };
    expect(hasLowerDensity(row, 'own')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gap analysis (2.4.3)
// ---------------------------------------------------------------------------

describe('analyzeKeywordGaps', () => {
  it('returns empty array when no competitor snapshots', () => {
    const ownSnap = makeSnapshot();
    const result = analyzeKeywordGaps(ownSnap, [], ['ad']);
    expect(result).toEqual([]);
  });

  it('correctly identifies keywords in competitors but not in user extension', () => {
    const ownSnap = makeSnapshot({
      title: 'Simple Tool',
      shortDescription: 'A simple tool',
      fullDescription: 'This is a simple tool for productivity.',
    });

    const competitorSnap = makeSnapshot({
      extensionId: 'comp1',
      title: 'Advanced Blocker Extension',
      shortDescription: 'Block content efficiently with advanced filtering.',
      fullDescription: 'Advanced blocker with content filtering, privacy protection, and tracker blocking features.',
    });

    const result = analyzeKeywordGaps(ownSnap, [competitorSnap], []);

    // Should find keywords like "blocker", "filtering", "advanced", "privacy", "tracker" etc.
    const keywordTexts = result.map(s => s.keyword);
    expect(keywordTexts).toContain('blocker');
    expect(keywordTexts).toContain('advanced');
  });

  it('filters out tracked keywords', () => {
    const ownSnap = makeSnapshot({
      title: 'My Extension',
      shortDescription: 'My extension',
      fullDescription: 'My extension is great.',
    });

    const competitorSnap = makeSnapshot({
      extensionId: 'comp1',
      title: 'Advanced Blocker',
      shortDescription: 'Advanced blocker tool',
      fullDescription: 'Advanced blocker with many features including content filtering and privacy protection.',
    });

    const result = analyzeKeywordGaps(ownSnap, [competitorSnap], ['blocker']);

    // "blocker" should be filtered out because it's tracked
    const keywordTexts = result.map(s => s.keyword);
    expect(keywordTexts).not.toContain('blocker');
  });

  it('filters out keywords that own extension already uses', () => {
    const ownSnap = makeSnapshot({
      title: 'Privacy Extension',
      shortDescription: 'Protect your privacy',
      fullDescription: 'Privacy protection tool with advanced features.',
    });

    const competitorSnap = makeSnapshot({
      extensionId: 'comp1',
      title: 'Privacy Guard Pro',
      shortDescription: 'Guard your privacy online',
      fullDescription: 'Privacy guard with tracking protection and encryption.',
    });

    const result = analyzeKeywordGaps(ownSnap, [competitorSnap], []);

    // "privacy" and "protection" should be filtered since own extension uses them
    const keywordTexts = result.map(s => s.keyword);
    expect(keywordTexts).not.toContain('privacy');
    expect(keywordTexts).not.toContain('protection');
  });

  it('sorts by competitor count, then by frequency', () => {
    const ownSnap = makeSnapshot({
      title: 'My App',
      shortDescription: 'My app',
      fullDescription: 'My app does things.',
    });

    const comp1 = makeSnapshot({
      extensionId: 'comp1',
      title: 'Security Tool',
      shortDescription: 'Security and encryption',
      fullDescription: 'Security tool with encryption features for safe browsing.',
    });

    const comp2 = makeSnapshot({
      extensionId: 'comp2',
      title: 'Security Shield',
      shortDescription: 'Security protection',
      fullDescription: 'Security shield with protection and encryption capabilities.',
    });

    const result = analyzeKeywordGaps(ownSnap, [comp1, comp2], []);

    // "security" and "encryption" should appear in both competitors
    const securityGap = result.find(s => s.keyword === 'security');
    expect(securityGap).toBeDefined();
    expect(securityGap!.competitorCount).toBe(2);

    // Verify sorting: items used by more competitors come first
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      if (prev.competitorCount !== curr.competitorCount) {
        expect(prev.competitorCount).toBeGreaterThan(curr.competitorCount);
      }
    }
  });

  it('respects maxResults parameter', () => {
    const ownSnap = makeSnapshot({
      title: 'Simple',
      shortDescription: 'Simple app',
      fullDescription: 'Just simple.',
    });

    const competitorSnap = makeSnapshot({
      extensionId: 'comp1',
      title: 'Feature Rich Extension',
      shortDescription: 'Many features for productivity and security and privacy and more.',
      fullDescription: 'This extension has productivity tools, security features, privacy protection, content filtering, tracker blocking, download management, password generation, bookmark sync, tab management, and notification control.',
    });

    const result = analyzeKeywordGaps(ownSnap, [competitorSnap], [], 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('handles null own snapshot', () => {
    const competitorSnap = makeSnapshot({
      extensionId: 'comp1',
      title: 'Blocker Extension',
      shortDescription: 'Block content',
      fullDescription: 'Content blocker with filtering features.',
    });

    const result = analyzeKeywordGaps(null, [competitorSnap], []);
    // Should still return results since we can't filter by own keywords
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Keyword difficulty estimate (2.4.4)
// ---------------------------------------------------------------------------

describe('estimateKeywordDifficulty', () => {
  it('returns zero difficulty when no rankings exist', () => {
    const rankings = new Map<string, RankSnapshot[]>([['test', []]]);
    const snapshots = new Map<string, ListingSnapshot>();
    const result = estimateKeywordDifficulty(rankings, snapshots);

    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('test');
    expect(result[0].difficultyScore).toBe(0);
    expect(result[0].sampleSize).toBe(0);
  });

  it('returns zero difficulty when all positions are null', () => {
    const rankings = new Map<string, RankSnapshot[]>([
      ['test', [
        makeRankSnapshot({ extensionId: 'ext1', position: null }),
        makeRankSnapshot({ extensionId: 'ext2', position: null }),
      ]],
    ]);
    const snapshots = new Map<string, ListingSnapshot>();
    const result = estimateKeywordDifficulty(rankings, snapshots);

    expect(result[0].difficultyScore).toBe(0);
    expect(result[0].sampleSize).toBe(0);
  });

  it('correctly averages metrics across top rankers', () => {
    const snap1 = makeSnapshot({
      extensionId: 'ext1',
      rating: 4.8,
      userCountNumeric: 1000000,
      listingQualityScore: 85,
    });
    const snap2 = makeSnapshot({
      extensionId: 'ext2',
      rating: 4.2,
      userCountNumeric: 500000,
      listingQualityScore: 70,
    });

    const rankings = new Map<string, RankSnapshot[]>([
      ['ad blocker', [
        makeRankSnapshot({ extensionId: 'ext1', position: 1 }),
        makeRankSnapshot({ extensionId: 'ext2', position: 2 }),
      ]],
    ]);
    const snapshots = new Map([['ext1', snap1], ['ext2', snap2]]);

    const result = estimateKeywordDifficulty(rankings, snapshots);
    expect(result).toHaveLength(1);

    const difficulty = result[0];
    expect(difficulty.keyword).toBe('ad blocker');
    expect(difficulty.averageRating).toBeCloseTo(4.5, 1);
    expect(difficulty.averageUserCount).toBe(750000);
    expect(difficulty.averageQualityScore).toBeCloseTo(77.5, 1);
    expect(difficulty.sampleSize).toBe(2);
    expect(difficulty.difficultyScore).toBeGreaterThan(0);
    expect(difficulty.difficultyScore).toBeLessThanOrEqual(100);
  });

  it('uses only topN extensions', () => {
    const snaps = new Map<string, ListingSnapshot>();
    const ranks: RankSnapshot[] = [];

    for (let i = 1; i <= 10; i++) {
      const extId = `ext${i}`;
      snaps.set(extId, makeSnapshot({
        extensionId: extId,
        rating: 4.0,
        userCountNumeric: 10000,
      }));
      ranks.push(makeRankSnapshot({ extensionId: extId, position: i }));
    }

    const rankings = new Map<string, RankSnapshot[]>([['test', ranks]]);

    // Default topN is 5
    const result = estimateKeywordDifficulty(rankings, snaps);
    expect(result[0].sampleSize).toBe(5);
  });

  it('handles extensions with no snapshot data', () => {
    const rankings = new Map<string, RankSnapshot[]>([
      ['test', [
        makeRankSnapshot({ extensionId: 'ext_no_snap', position: 1 }),
      ]],
    ]);
    const snapshots = new Map<string, ListingSnapshot>(); // empty

    const result = estimateKeywordDifficulty(rankings, snapshots);
    expect(result[0].sampleSize).toBe(0);
    expect(result[0].difficultyScore).toBe(0);
  });

  it('handles null rating in snapshot', () => {
    const snap = makeSnapshot({
      extensionId: 'ext1',
      rating: null,
      userCountNumeric: 50000,
    });

    const rankings = new Map<string, RankSnapshot[]>([
      ['test', [
        makeRankSnapshot({ extensionId: 'ext1', position: 1 }),
      ]],
    ]);
    const snapshots = new Map([['ext1', snap]]);

    const result = estimateKeywordDifficulty(rankings, snapshots);
    expect(result[0].averageRating).toBe(0);
    expect(result[0].sampleSize).toBe(1);
    // Difficulty should still be non-zero due to user count
    expect(result[0].difficultyScore).toBeGreaterThanOrEqual(0);
  });

  it('handles null quality score', () => {
    const snap = makeSnapshot({
      extensionId: 'ext1',
      rating: 4.5,
      userCountNumeric: 100000,
      listingQualityScore: null,
    });

    const rankings = new Map<string, RankSnapshot[]>([
      ['test', [
        makeRankSnapshot({ extensionId: 'ext1', position: 1 }),
      ]],
    ]);
    const snapshots = new Map([['ext1', snap]]);

    const result = estimateKeywordDifficulty(rankings, snapshots);
    expect(result[0].averageQualityScore).toBeNull();
    // Should still produce a valid difficulty score
    expect(result[0].difficultyScore).toBeGreaterThan(0);
  });

  it('produces higher difficulty for popular keywords', () => {
    // Popular keyword: high ratings, high user counts
    const popularSnap = makeSnapshot({
      extensionId: 'ext1',
      rating: 4.9,
      userCountNumeric: 5000000,
      listingQualityScore: 95,
    });

    // Niche keyword: lower ratings, lower user counts
    const nicheSnap = makeSnapshot({
      extensionId: 'ext2',
      rating: 3.5,
      userCountNumeric: 500,
      listingQualityScore: 40,
    });

    const popularRankings = new Map<string, RankSnapshot[]>([
      ['popular keyword', [
        makeRankSnapshot({ extensionId: 'ext1', position: 1 }),
      ]],
    ]);
    const nicheRankings = new Map<string, RankSnapshot[]>([
      ['niche keyword', [
        makeRankSnapshot({ extensionId: 'ext2', position: 1 }),
      ]],
    ]);

    const popularResult = estimateKeywordDifficulty(
      popularRankings,
      new Map([['ext1', popularSnap]])
    );
    const nicheResult = estimateKeywordDifficulty(
      nicheRankings,
      new Map([['ext2', nicheSnap]])
    );

    expect(popularResult[0].difficultyScore).toBeGreaterThan(nicheResult[0].difficultyScore);
  });

  it('handles multiple keywords', () => {
    const snap = makeSnapshot({
      extensionId: 'ext1',
      rating: 4.0,
      userCountNumeric: 10000,
    });

    const rankings = new Map<string, RankSnapshot[]>([
      ['keyword1', [makeRankSnapshot({ extensionId: 'ext1', position: 1 })]],
      ['keyword2', [makeRankSnapshot({ extensionId: 'ext1', position: 5 })]],
    ]);
    const snapshots = new Map([['ext1', snap]]);

    const result = estimateKeywordDifficulty(rankings, snapshots);
    expect(result).toHaveLength(2);
    expect(result[0].keyword).toBe('keyword1');
    expect(result[1].keyword).toBe('keyword2');
  });

  it('difficulty score is clamped to 0-100', () => {
    const snap = makeSnapshot({
      extensionId: 'ext1',
      rating: 5.0,
      userCountNumeric: 100000000, // very high
      listingQualityScore: 100,
    });

    const rankings = new Map<string, RankSnapshot[]>([
      ['test', [makeRankSnapshot({ extensionId: 'ext1', position: 1 })]],
    ]);
    const snapshots = new Map([['ext1', snap]]);

    const result = estimateKeywordDifficulty(rankings, snapshots);
    expect(result[0].difficultyScore).toBeGreaterThanOrEqual(0);
    expect(result[0].difficultyScore).toBeLessThanOrEqual(100);
  });
});
