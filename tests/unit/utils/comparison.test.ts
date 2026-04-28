/**
 * Tests for comparison utilities (Phase 2.2).
 *
 * Covers keyword highlighting, permission diffing, keyword density matrix,
 * readability scoring, and text metrics.
 */

import { describe, it, expect } from 'vitest';
import {
  highlightKeywords,
  computePermissionDiff,
  computeKeywordDensityMatrix,
  computeTextMetrics,
  fleschReadingEase,
  readabilityLabel,
  countSyllables,
  countSentences,
  type HighlightSegment,
} from '../../../src/shared/utils/comparison';
import type { ListingSnapshot } from '../../../src/shared/types/index';

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
    availableLocales: ['en', 'es', 'fr', 'de', 'ja', 'zh_CN', 'ko', 'ru', 'pt_BR', 'it', 'nl', 'pl', 'tr', 'ar', 'hi'],
    category: 'Productivity',
    developerName: 'Dev Inc.',
    developerEmail: null,
    developerVerified: true,
    listingQualityScore: null,
    scannedAt: new Date('2026-02-05T12:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Keyword highlighting
// ---------------------------------------------------------------------------

describe('highlightKeywords', () => {
  it('returns empty array for empty text', () => {
    expect(highlightKeywords('', ['test'])).toEqual([]);
  });

  it('returns single unhighlighted segment when no keywords provided', () => {
    const result = highlightKeywords('Hello world', []);
    expect(result).toEqual([{ text: 'Hello world', highlighted: false }]);
  });

  it('returns single unhighlighted segment when no keywords match', () => {
    const result = highlightKeywords('Hello world', ['xyz']);
    expect(result).toEqual([{ text: 'Hello world', highlighted: false }]);
  });

  it('highlights a single keyword', () => {
    const result = highlightKeywords('The ad blocker works great', ['ad']);
    expect(result).toEqual([
      { text: 'The ', highlighted: false },
      { text: 'ad', highlighted: true },
      { text: ' blocker works great', highlighted: false },
    ]);
  });

  it('highlights keyword case-insensitively', () => {
    const result = highlightKeywords('The Ad Blocker works', ['ad']);
    expect(result).toEqual([
      { text: 'The ', highlighted: false },
      { text: 'Ad', highlighted: true },
      { text: ' Blocker works', highlighted: false },
    ]);
  });

  it('highlights multiple occurrences of same keyword', () => {
    const result = highlightKeywords('ad blocker blocks ad popups', ['ad']);
    expect(result).toEqual([
      { text: 'ad', highlighted: true },
      { text: ' blocker blocks ', highlighted: false },
      { text: 'ad', highlighted: true },
      { text: ' popups', highlighted: false },
    ]);
  });

  it('highlights multiple different keywords', () => {
    const result = highlightKeywords('ad blocker with vpn', ['ad', 'vpn']);
    expect(result).toEqual([
      { text: 'ad', highlighted: true },
      { text: ' blocker with ', highlighted: false },
      { text: 'vpn', highlighted: true },
    ]);
  });

  it('matches whole words only (does not match "ad" in "ads")', () => {
    const result = highlightKeywords('blocks ads efficiently', ['ad']);
    expect(result).toEqual([{ text: 'blocks ads efficiently', highlighted: false }]);
  });

  it('handles keyword at start of text', () => {
    const result = highlightKeywords('vpn service is great', ['vpn']);
    expect(result).toEqual([
      { text: 'vpn', highlighted: true },
      { text: ' service is great', highlighted: false },
    ]);
  });

  it('handles keyword at end of text', () => {
    const result = highlightKeywords('best free vpn', ['vpn']);
    expect(result).toEqual([
      { text: 'best free ', highlighted: false },
      { text: 'vpn', highlighted: true },
    ]);
  });

  it('handles multi-word keywords', () => {
    const result = highlightKeywords('the ad blocker extension', ['ad blocker']);
    expect(result).toEqual([
      { text: 'the ', highlighted: false },
      { text: 'ad blocker', highlighted: true },
      { text: ' extension', highlighted: false },
    ]);
  });

  it('handles empty keyword in array gracefully', () => {
    const result = highlightKeywords('hello world', ['', 'hello']);
    expect(result).toEqual([
      { text: 'hello', highlighted: true },
      { text: ' world', highlighted: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Permission diff
// ---------------------------------------------------------------------------

describe('computePermissionDiff', () => {
  it('returns empty results for no extensions', () => {
    const result = computePermissionDiff(new Map());
    expect(result.shared).toEqual([]);
    expect(result.uniquePerExtension.size).toBe(0);
  });

  it('returns all permissions as unique for single extension', () => {
    const result = computePermissionDiff(new Map([
      ['ext1', ['storage', 'tabs', 'webRequest']],
    ]));
    expect(result.shared).toEqual([]);
    expect(result.uniquePerExtension.get('ext1')).toEqual(['storage', 'tabs', 'webRequest']);
  });

  it('correctly identifies shared permissions between 2 extensions', () => {
    const result = computePermissionDiff(new Map([
      ['ext1', ['storage', 'tabs', 'webRequest']],
      ['ext2', ['storage', 'tabs', 'cookies']],
    ]));
    expect(result.shared).toEqual(['storage', 'tabs']);
    expect(result.uniquePerExtension.get('ext1')).toEqual(['webRequest']);
    expect(result.uniquePerExtension.get('ext2')).toEqual(['cookies']);
  });

  it('correctly identifies shared permissions among 3 extensions', () => {
    const result = computePermissionDiff(new Map([
      ['ext1', ['storage', 'tabs']],
      ['ext2', ['storage', 'tabs', 'cookies']],
      ['ext3', ['storage', 'bookmarks']],
    ]));
    expect(result.shared).toEqual(['storage']);
    expect(result.uniquePerExtension.get('ext1')).toEqual(['tabs']);
    expect(result.uniquePerExtension.get('ext2')).toEqual(['cookies', 'tabs']);
    expect(result.uniquePerExtension.get('ext3')).toEqual(['bookmarks']);
  });

  it('handles extensions with identical permissions', () => {
    const result = computePermissionDiff(new Map([
      ['ext1', ['storage', 'tabs']],
      ['ext2', ['storage', 'tabs']],
    ]));
    expect(result.shared).toEqual(['storage', 'tabs']);
    expect(result.uniquePerExtension.get('ext1')).toEqual([]);
    expect(result.uniquePerExtension.get('ext2')).toEqual([]);
  });

  it('handles extensions with no overlapping permissions', () => {
    const result = computePermissionDiff(new Map([
      ['ext1', ['storage']],
      ['ext2', ['cookies']],
    ]));
    expect(result.shared).toEqual([]);
    expect(result.uniquePerExtension.get('ext1')).toEqual(['storage']);
    expect(result.uniquePerExtension.get('ext2')).toEqual(['cookies']);
  });

  it('handles extensions with empty permissions', () => {
    const result = computePermissionDiff(new Map([
      ['ext1', []],
      ['ext2', ['storage']],
    ]));
    expect(result.shared).toEqual([]);
    expect(result.uniquePerExtension.get('ext1')).toEqual([]);
    expect(result.uniquePerExtension.get('ext2')).toEqual(['storage']);
  });

  it('handles duplicate permissions within same extension', () => {
    const result = computePermissionDiff(new Map([
      ['ext1', ['storage', 'storage', 'tabs']],
      ['ext2', ['storage']],
    ]));
    expect(result.shared).toEqual(['storage']);
    expect(result.uniquePerExtension.get('ext1')).toEqual(['tabs']);
  });
});

// ---------------------------------------------------------------------------
// Keyword density matrix
// ---------------------------------------------------------------------------

describe('computeKeywordDensityMatrix', () => {
  it('returns empty array for no keywords', () => {
    const snap = makeSnapshot();
    const result = computeKeywordDensityMatrix([], new Map([['ext1', snap]]));
    expect(result).toEqual([]);
  });

  it('returns rows with zero counts when keyword not found', () => {
    const snap = makeSnapshot({ title: 'Hello', shortDescription: 'World', fullDescription: 'Goodbye' });
    const result = computeKeywordDensityMatrix(['xyz'], new Map([['ext1', snap]]));
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('xyz');
    expect(result[0].extensions).toHaveLength(1);
    expect(result[0].extensions[0].titleCount).toBe(0);
    expect(result[0].extensions[0].shortDescCount).toBe(0);
    expect(result[0].extensions[0].fullDescCount).toBe(0);
    expect(result[0].extensions[0].totalCount).toBe(0);
  });

  it('correctly counts keyword occurrences in title, short desc, and full desc', () => {
    const snap = makeSnapshot();
    const result = computeKeywordDensityMatrix(['ad'], new Map([['ext1', snap]]));
    expect(result).toHaveLength(1);
    const cell = result[0].extensions[0];
    expect(cell.extensionId).toBe('ext1');
    // "Ad Blocker - Block Ads Fast" - "ad" as whole word = 1 match ("Ad")
    expect(cell.titleCount).toBe(1);
    // "Block annoying ads on every website. Fast and lightweight ad blocker."
    expect(cell.shortDescCount).toBe(1);
    // Full description: "Ad Blocker is the best ad blocking..." -> 2 whole-word matches
    expect(cell.fullDescCount).toBe(2);
  });

  it('works with multiple keywords and multiple extensions', () => {
    const snap1 = makeSnapshot({ extensionId: 'ext1' });
    const snap2 = makeSnapshot({
      extensionId: 'ext2',
      title: 'VPN Proxy Extension',
      shortDescription: 'A fast vpn proxy for browsing.',
      fullDescription: 'This vpn proxy helps you browse securely.',
    });

    const result = computeKeywordDensityMatrix(
      ['ad', 'vpn'],
      new Map([['ext1', snap1], ['ext2', snap2]])
    );

    expect(result).toHaveLength(2);

    // "ad" keyword
    const adRow = result[0];
    expect(adRow.keyword).toBe('ad');
    expect(adRow.extensions).toHaveLength(2);
    expect(adRow.extensions[0].extensionId).toBe('ext1');
    expect(adRow.extensions[0].titleCount).toBeGreaterThan(0); // "Ad" in title
    expect(adRow.extensions[1].extensionId).toBe('ext2');
    expect(adRow.extensions[1].titleCount).toBe(0); // no "ad" in VPN title

    // "vpn" keyword
    const vpnRow = result[1];
    expect(vpnRow.keyword).toBe('vpn');
    expect(vpnRow.extensions[0].totalCount).toBe(0); // no "vpn" in ad blocker
    expect(vpnRow.extensions[1].totalCount).toBeGreaterThan(0); // "vpn" in vpn extension
  });

  it('handles empty snapshots map', () => {
    const result = computeKeywordDensityMatrix(['ad'], new Map());
    expect(result).toHaveLength(1);
    expect(result[0].extensions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Syllable counting
// ---------------------------------------------------------------------------

describe('countSyllables', () => {
  it('counts single-syllable words', () => {
    expect(countSyllables('the')).toBe(1);
    expect(countSyllables('cat')).toBe(1);
    expect(countSyllables('dog')).toBe(1);
  });

  it('counts multi-syllable words', () => {
    expect(countSyllables('hello')).toBe(2);
    expect(countSyllables('beautiful')).toBe(3);
  });

  it('handles short words', () => {
    expect(countSyllables('a')).toBe(1);
    expect(countSyllables('I')).toBe(1);
    expect(countSyllables('go')).toBe(1);
  });

  it('returns at least 1 for any non-empty word', () => {
    expect(countSyllables('rhythm')).toBeGreaterThanOrEqual(1);
    expect(countSyllables('xyz')).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Sentence counting
// ---------------------------------------------------------------------------

describe('countSentences', () => {
  it('returns 0 for empty text', () => {
    expect(countSentences('')).toBe(0);
    expect(countSentences('   ')).toBe(0);
  });

  it('counts single sentence', () => {
    expect(countSentences('Hello world.')).toBe(1);
  });

  it('counts multiple sentences', () => {
    expect(countSentences('Hello world. How are you? Great!')).toBe(3);
  });

  it('returns 1 for text without sentence-ending punctuation', () => {
    expect(countSentences('Hello world')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Flesch Reading Ease
// ---------------------------------------------------------------------------

describe('fleschReadingEase', () => {
  it('returns 0 for empty text', () => {
    expect(fleschReadingEase('')).toBe(0);
    expect(fleschReadingEase('   ')).toBe(0);
  });

  it('returns a score between 0 and 100 for normal text', () => {
    const text = 'The cat sat on the mat. It was a sunny day. Birds were singing.';
    const score = fleschReadingEase(text);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scores simple text higher than complex text', () => {
    const simple = 'The cat sat. The dog ran. Birds sang.';
    const complex = 'The implementation of sophisticated algorithmic methodologies necessitates comprehensive understanding of computational paradigms and architectural considerations.';
    expect(fleschReadingEase(simple)).toBeGreaterThan(fleschReadingEase(complex));
  });

  it('is clamped to 0-100 range', () => {
    // Very long single word might produce extreme scores
    const score = fleschReadingEase('a');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Readability label
// ---------------------------------------------------------------------------

describe('readabilityLabel', () => {
  it('returns correct labels for score ranges', () => {
    expect(readabilityLabel(95)).toBe('Very Easy');
    expect(readabilityLabel(85)).toBe('Easy');
    expect(readabilityLabel(75)).toBe('Fairly Easy');
    expect(readabilityLabel(65)).toBe('Standard');
    expect(readabilityLabel(55)).toBe('Fairly Difficult');
    expect(readabilityLabel(35)).toBe('Difficult');
    expect(readabilityLabel(15)).toBe('Very Difficult');
  });

  it('returns correct label at boundary values', () => {
    expect(readabilityLabel(90)).toBe('Very Easy');
    expect(readabilityLabel(80)).toBe('Easy');
    expect(readabilityLabel(70)).toBe('Fairly Easy');
    expect(readabilityLabel(60)).toBe('Standard');
    expect(readabilityLabel(50)).toBe('Fairly Difficult');
    expect(readabilityLabel(30)).toBe('Difficult');
    expect(readabilityLabel(0)).toBe('Very Difficult');
  });
});

// ---------------------------------------------------------------------------
// Text metrics
// ---------------------------------------------------------------------------

describe('computeTextMetrics', () => {
  it('returns zeros for empty text', () => {
    const metrics = computeTextMetrics('');
    expect(metrics.charCount).toBe(0);
    expect(metrics.wordCount).toBe(0);
    expect(metrics.readabilityScore).toBe(0);
  });

  it('returns correct character count', () => {
    const metrics = computeTextMetrics('Hello world');
    expect(metrics.charCount).toBe(11);
  });

  it('returns correct word count', () => {
    const metrics = computeTextMetrics('Hello world test');
    expect(metrics.wordCount).toBe(3);
  });

  it('handles whitespace-only text', () => {
    const metrics = computeTextMetrics('   ');
    expect(metrics.wordCount).toBe(0);
    expect(metrics.charCount).toBe(3);
  });

  it('includes readability score', () => {
    const text = 'The cat sat on the mat. It was a good day.';
    const metrics = computeTextMetrics(text);
    expect(metrics.readabilityScore).toBeGreaterThan(0);
    expect(metrics.readabilityScore).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Integration-style comparison tests (from TODO)
// ---------------------------------------------------------------------------

describe('comparison integration', () => {
  it('comparing 2 extensions: all fields are computed', () => {
    const snap1 = makeSnapshot({ extensionId: 'ext1', title: 'Ad Blocker Pro' });
    const snap2 = makeSnapshot({
      extensionId: 'ext2',
      title: 'Privacy Guard',
      permissions: ['storage', 'cookies'],
      hostPermissions: [],
    });

    const snapshotMap = new Map([['ext1', snap1], ['ext2', snap2]]);

    // Keyword highlighting works for both
    const highlight1 = highlightKeywords(snap1.title, ['ad']);
    expect(highlight1.some(s => s.highlighted)).toBe(true);

    const highlight2 = highlightKeywords(snap2.title, ['ad']);
    expect(highlight2.every(s => !s.highlighted)).toBe(true);

    // Permission diff correctly identifies shared and unique
    const permDiff = computePermissionDiff(new Map([
      ['ext1', [...snap1.permissions, ...snap1.hostPermissions]],
      ['ext2', [...snap2.permissions, ...snap2.hostPermissions]],
    ]));
    expect(permDiff.shared).toContain('storage');
    expect(permDiff.uniquePerExtension.get('ext1')).toContain('webRequest');
    expect(permDiff.uniquePerExtension.get('ext1')).toContain('tabs');
    expect(permDiff.uniquePerExtension.get('ext1')).toContain('<all_urls>');
    expect(permDiff.uniquePerExtension.get('ext2')).toContain('cookies');

    // Text metrics computed for both
    const metrics1 = computeTextMetrics(snap1.fullDescription);
    const metrics2 = computeTextMetrics(snap2.fullDescription);
    expect(metrics1.wordCount).toBeGreaterThan(0);
    expect(metrics2.wordCount).toBeGreaterThan(0);

    // Keyword density matrix works
    const matrix = computeKeywordDensityMatrix(['ad', 'privacy'], snapshotMap);
    expect(matrix).toHaveLength(2);
    expect(matrix[0].extensions).toHaveLength(2);
    expect(matrix[1].extensions).toHaveLength(2);
  });

  it('compare extension with itself: all values equal, no diff', () => {
    const snap = makeSnapshot({ extensionId: 'ext1' });
    const snapshotMap = new Map([['ext1', snap], ['ext1_copy', snap]]);

    // Permission diff: all shared, no unique
    const permDiff = computePermissionDiff(new Map([
      ['ext1', [...snap.permissions, ...snap.hostPermissions]],
      ['ext1_copy', [...snap.permissions, ...snap.hostPermissions]],
    ]));
    const allPerms = [...snap.permissions, ...snap.hostPermissions].sort();
    expect(permDiff.shared).toEqual(allPerms);
    expect(permDiff.uniquePerExtension.get('ext1')).toEqual([]);
    expect(permDiff.uniquePerExtension.get('ext1_copy')).toEqual([]);

    // Text metrics should be identical
    const metrics1 = computeTextMetrics(snap.fullDescription);
    const metrics2 = computeTextMetrics(snap.fullDescription);
    expect(metrics1).toEqual(metrics2);

    // Keyword highlighting should produce same result
    const h1 = highlightKeywords(snap.title, ['ad']);
    const h2 = highlightKeywords(snap.title, ['ad']);
    expect(h1).toEqual(h2);
  });

  it('compare with missing data: handles null/empty fields gracefully', () => {
    const emptySnap: ListingSnapshot = {
      extensionId: 'ext_empty',
      date: '2026-02-05',
      title: '',
      shortDescription: '',
      fullDescription: '',
      rating: null,
      ratingCount: 0,
      reviewCount: 0,
      userCount: '0',
      userCountNumeric: 0,
      version: '',
      lastUpdated: '',
      size: '',
      permissions: [],
      hostPermissions: [],
      permissionRiskScore: 0,
      badgeFlags: {},
      screenshotCount: 0,
      hasPromoVideo: false,
      translationCount: 0,
      availableLocales: [],
      category: '',
      developerName: '',
      developerEmail: null,
      developerVerified: false,
      listingQualityScore: null,
      scannedAt: new Date('2026-02-05T12:00:00Z'),
    };

    const normalSnap = makeSnapshot({ extensionId: 'ext_normal' });

    // Keyword highlighting on empty text
    const emptyHighlight = highlightKeywords(emptySnap.title, ['ad']);
    expect(emptyHighlight).toEqual([]);

    // Permission diff with empty permissions
    const permDiff = computePermissionDiff(new Map([
      ['ext_empty', []],
      ['ext_normal', [...normalSnap.permissions, ...normalSnap.hostPermissions]],
    ]));
    expect(permDiff.shared).toEqual([]);
    expect(permDiff.uniquePerExtension.get('ext_empty')).toEqual([]);
    expect(permDiff.uniquePerExtension.get('ext_normal')!.length).toBeGreaterThan(0);

    // Text metrics on empty text
    const emptyMetrics = computeTextMetrics('');
    expect(emptyMetrics.charCount).toBe(0);
    expect(emptyMetrics.wordCount).toBe(0);
    expect(emptyMetrics.readabilityScore).toBe(0);

    // Keyword density matrix with empty snapshot
    const matrix = computeKeywordDensityMatrix(
      ['ad'],
      new Map([['ext_empty', emptySnap], ['ext_normal', normalSnap]])
    );
    expect(matrix).toHaveLength(1);
    const emptyCell = matrix[0].extensions.find(e => e.extensionId === 'ext_empty');
    expect(emptyCell!.totalCount).toBe(0);
    expect(emptyCell!.density).toBe(0);
  });
});
