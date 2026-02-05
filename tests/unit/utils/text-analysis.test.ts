/**
 * Tests for text analysis utilities (Phase 1.5.2).
 */

import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  levenshteinSimilarity,
  countKeywordOccurrences,
  keywordDensity,
  extractKeywords,
} from '../../../src/shared/utils/text-analysis';

// ---------------------------------------------------------------------------
// levenshteinDistance
// ---------------------------------------------------------------------------

describe('levenshteinDistance()', () => {
  it('returns 3 for "kitten" vs "sitting"', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('returns 3 for "" vs "abc"', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('returns 3 for "abc" vs ""', () => {
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('returns correct distance for single character difference', () => {
    expect(levenshteinDistance('cat', 'car')).toBe(1);
  });

  it('is symmetric (a,b) === (b,a)', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(
      levenshteinDistance('xyz', 'abc')
    );
  });

  it('handles longer strings correctly', () => {
    // "saturday" -> "sunday" requires 3 edits
    expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// levenshteinSimilarity
// ---------------------------------------------------------------------------

describe('levenshteinSimilarity()', () => {
  it('returns 1.0 for identical strings', () => {
    expect(levenshteinSimilarity('abc', 'abc')).toBe(1.0);
  });

  it('returns 1.0 for both empty strings', () => {
    expect(levenshteinSimilarity('', '')).toBe(1.0);
  });

  it('returns 0.0 for maximally different single-char strings', () => {
    expect(levenshteinSimilarity('a', 'b')).toBe(0.0);
  });

  it('returns value between 0 and 1 for partially similar strings', () => {
    const sim = levenshteinSimilarity('kitten', 'sitting');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
    // 1 - 3/7 ≈ 0.571
    expect(sim).toBeCloseTo(1 - 3 / 7, 3);
  });

  it('returns 0.0 when one string is empty and other is not', () => {
    expect(levenshteinSimilarity('', 'abc')).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// countKeywordOccurrences
// ---------------------------------------------------------------------------

describe('countKeywordOccurrences()', () => {
  it('counts whole-word occurrences only (not partial matches)', () => {
    // "ad" should match as whole word, not "ads"
    expect(countKeywordOccurrences('ad blocker blocks ads', 'ad')).toBe(1);
  });

  it('returns 0 for empty text', () => {
    expect(countKeywordOccurrences('', 'test')).toBe(0);
  });

  it('returns 0 for empty keyword', () => {
    expect(countKeywordOccurrences('some text', '')).toBe(0);
  });

  it('is case insensitive', () => {
    expect(countKeywordOccurrences('test test TEST', 'test')).toBe(3);
  });

  it('counts multiple occurrences in a sentence', () => {
    expect(
      countKeywordOccurrences('the quick brown fox jumps over the lazy fox', 'fox')
    ).toBe(2);
  });

  it('handles multi-word keywords as phrases', () => {
    expect(
      countKeywordOccurrences(
        'ad blocker is the best ad blocker extension',
        'ad blocker'
      )
    ).toBe(2);
  });

  it('does not match keyword as substring of another word', () => {
    expect(countKeywordOccurrences('blockchain technology', 'block')).toBe(0);
  });

  it('handles special regex characters in keyword', () => {
    expect(countKeywordOccurrences('version 1.0 released', '1.0')).toBe(1);
  });

  it('handles keyword at start and end of text', () => {
    expect(countKeywordOccurrences('fox fox', 'fox')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// keywordDensity
// ---------------------------------------------------------------------------

describe('keywordDensity()', () => {
  it('returns correct ratio for known text', () => {
    // "test" appears 2 times in 5 words -> 2/5 = 0.4
    const density = keywordDensity('test one two test three', 'test');
    expect(density).toBeCloseTo(0.4, 5);
  });

  it('returns 0 for empty text (no division by zero)', () => {
    expect(keywordDensity('', 'test')).toBe(0);
  });

  it('returns 0 when keyword is not found', () => {
    expect(keywordDensity('hello world', 'missing')).toBe(0);
  });

  it('returns correct density for single-word text matching keyword', () => {
    expect(keywordDensity('test', 'test')).toBe(1.0);
  });

  it('handles whitespace-only text', () => {
    expect(keywordDensity('   ', 'test')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------

describe('extractKeywords()', () => {
  it('returns correct frequency map for simple text', () => {
    const result = extractKeywords('blocker blocker extension fast extension extension');
    expect(result.get('blocker')).toBe(2);
    expect(result.get('extension')).toBe(3);
    expect(result.get('fast')).toBe(1);
  });

  it('ignores common stop words', () => {
    const result = extractKeywords('the best ad blocker for your browser');
    expect(result.has('the')).toBe(false);
    expect(result.has('for')).toBe(false);
    expect(result.has('your')).toBe(false);
    expect(result.get('blocker')).toBe(1);
    expect(result.get('browser')).toBe(1);
  });

  it('lowercases all words', () => {
    const result = extractKeywords('Blocker BLOCKER blocker');
    expect(result.get('blocker')).toBe(3);
  });

  it('excludes words shorter than minLength', () => {
    const result = extractKeywords('ad is a blocker', 3);
    expect(result.has('ad')).toBe(false);
    expect(result.get('blocker')).toBe(1);
  });

  it('respects custom minLength parameter', () => {
    const result = extractKeywords('ad blocker extension manager', 5);
    expect(result.has('blocker')).toBe(true);
    expect(result.has('extension')).toBe(true);
    expect(result.has('manager')).toBe(true);
    // "ad" is only 2 chars, excluded
    expect(result.has('ad')).toBe(false);
  });

  it('returns empty map for empty string', () => {
    const result = extractKeywords('');
    expect(result.size).toBe(0);
  });

  it('returns empty map for text with only stop words', () => {
    const result = extractKeywords('the and for with');
    expect(result.size).toBe(0);
  });

  it('sorts results by frequency descending', () => {
    const result = extractKeywords(
      'extension blocker extension blocker extension'
    );
    const entries = [...result.entries()];
    expect(entries[0]).toEqual(['extension', 3]);
    expect(entries[1]).toEqual(['blocker', 2]);
  });

  it('extracts only alphanumeric words (strips punctuation)', () => {
    const result = extractKeywords('fast, reliable; extension!');
    expect(result.get('fast')).toBe(1);
    expect(result.get('reliable')).toBe(1);
    expect(result.get('extension')).toBe(1);
  });
});
