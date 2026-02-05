/**
 * Comparison utilities for listing side-by-side analysis (Phase 2.2).
 *
 * Provides keyword highlighting, permission diffing, keyword density matrix,
 * and readability scoring for extension listing comparison views.
 */

import type { ListingSnapshot } from '../types/index';
import { countKeywordOccurrences, keywordDensity } from './text-analysis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A segment of text with optional keyword highlighting. */
export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/** Result of comparing permissions between extensions. */
export interface PermissionDiffResult {
  shared: string[];
  uniquePerExtension: Map<string, string[]>;
}

/** Keyword density data for a single keyword across extensions. */
export interface KeywordDensityRow {
  keyword: string;
  extensions: KeywordDensityCell[];
}

/** Density data for one keyword in one extension. */
export interface KeywordDensityCell {
  extensionId: string;
  titleCount: number;
  shortDescCount: number;
  fullDescCount: number;
  totalCount: number;
  density: number;
}

/** Text metrics for comparison display. */
export interface TextMetrics {
  charCount: number;
  wordCount: number;
  readabilityScore: number;
}

// ---------------------------------------------------------------------------
// Keyword highlighting
// ---------------------------------------------------------------------------

/**
 * Split text into segments with keywords highlighted.
 *
 * Keywords are matched case-insensitively as whole words.
 * Overlapping matches are merged. Returns segments in order.
 */
export function highlightKeywords(
  text: string,
  keywords: string[]
): HighlightSegment[] {
  if (text.length === 0 || keywords.length === 0) {
    return text.length > 0 ? [{ text, highlighted: false }] : [];
  }

  // Find all match ranges
  const ranges: Array<{ start: number; end: number }> = [];

  for (const keyword of keywords) {
    if (keyword.length === 0) continue;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  if (ranges.length === 0) {
    return [{ text, highlighted: false }];
  }

  // Sort by start position, then merge overlapping ranges
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i].start <= last.end) {
      last.end = Math.max(last.end, ranges[i].end);
    } else {
      merged.push(ranges[i]);
    }
  }

  // Build segments
  const segments: HighlightSegment[] = [];
  let pos = 0;
  for (const range of merged) {
    if (pos < range.start) {
      segments.push({ text: text.slice(pos, range.start), highlighted: false });
    }
    segments.push({ text: text.slice(range.start, range.end), highlighted: true });
    pos = range.end;
  }
  if (pos < text.length) {
    segments.push({ text: text.slice(pos), highlighted: false });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Permission diff
// ---------------------------------------------------------------------------

/**
 * Compute the permission diff between multiple extensions.
 *
 * Returns shared permissions (present in all) and unique permissions per extension.
 * Permissions are compared as sorted sets (order doesn't matter).
 */
export function computePermissionDiff(
  extensionPermissions: Map<string, string[]>
): PermissionDiffResult {
  const entries = Array.from(extensionPermissions.entries());

  if (entries.length === 0) {
    return { shared: [], uniquePerExtension: new Map() };
  }

  if (entries.length === 1) {
    const [id, perms] = entries[0];
    return {
      shared: [],
      uniquePerExtension: new Map([[id, [...perms].sort()]]),
    };
  }

  // Collect all permissions and count how many extensions have each
  const permCounts = new Map<string, number>();
  for (const [, perms] of entries) {
    const unique = new Set(perms);
    for (const p of unique) {
      permCounts.set(p, (permCounts.get(p) ?? 0) + 1);
    }
  }

  const totalExtensions = entries.length;
  const shared: string[] = [];
  for (const [perm, count] of permCounts) {
    if (count === totalExtensions) {
      shared.push(perm);
    }
  }
  shared.sort();

  const sharedSet = new Set(shared);
  const uniquePerExtension = new Map<string, string[]>();
  for (const [id, perms] of entries) {
    const unique = [...new Set(perms)]
      .filter(p => !sharedSet.has(p))
      .sort();
    uniquePerExtension.set(id, unique);
  }

  return { shared, uniquePerExtension };
}

// ---------------------------------------------------------------------------
// Keyword density matrix
// ---------------------------------------------------------------------------

/**
 * Compute keyword density data for each keyword across multiple snapshots.
 *
 * Returns one row per keyword with occurrence counts and density for each extension.
 */
export function computeKeywordDensityMatrix(
  keywords: string[],
  snapshots: Map<string, ListingSnapshot>
): KeywordDensityRow[] {
  return keywords.map(keyword => {
    const extensions: KeywordDensityCell[] = [];

    for (const [extensionId, snapshot] of snapshots) {
      const titleCount = countKeywordOccurrences(snapshot.title, keyword);
      const shortDescCount = countKeywordOccurrences(snapshot.shortDescription, keyword);
      const fullDescCount = countKeywordOccurrences(snapshot.fullDescription, keyword);
      const totalCount = titleCount + shortDescCount + fullDescCount;

      // Density based on full description (most significant text body)
      const density = keywordDensity(snapshot.fullDescription, keyword);

      extensions.push({
        extensionId,
        titleCount,
        shortDescCount,
        fullDescCount,
        totalCount,
        density,
      });
    }

    return { keyword, extensions };
  });
}

// ---------------------------------------------------------------------------
// Readability score (Flesch Reading Ease)
// ---------------------------------------------------------------------------

/**
 * Count syllables in a word using a vowel-group heuristic.
 *
 * This is an approximation - English syllable counting is inherently fuzzy.
 * Handles common patterns like silent 'e' and common suffixes.
 */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 2) return 1;

  // Count vowel groups
  const vowelGroups = w.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;

  // Silent 'e' at end
  if (w.endsWith('e') && !w.endsWith('le') && count > 1) {
    count--;
  }

  // Common suffixes that don't add syllables
  if (w.endsWith('ed') && !w.endsWith('ted') && !w.endsWith('ded')) {
    count = Math.max(count - 1, 1);
  }

  return Math.max(count, 1);
}

/**
 * Count sentences in text.
 *
 * Splits on sentence-ending punctuation (. ! ?), filtering empty results.
 */
export function countSentences(text: string): number {
  if (text.trim().length === 0) return 0;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return Math.max(sentences.length, 1);
}

/**
 * Calculate Flesch Reading Ease score for a text.
 *
 * Formula: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)
 *
 * Returns a value typically between 0 (very difficult) and 100 (very easy).
 * Can exceed 100 for very simple text or go below 0 for very complex text;
 * the result is clamped to [0, 100].
 *
 * Returns 0 for empty text.
 */
export function fleschReadingEase(text: string): number {
  if (text.trim().length === 0) return 0;

  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  if (wordCount === 0) return 0;

  const sentenceCount = countSentences(text);
  const totalSyllables = words.reduce(
    (sum, word) => sum + countSyllables(word),
    0
  );

  const score =
    206.835 -
    1.015 * (wordCount / sentenceCount) -
    84.6 * (totalSyllables / wordCount);

  return Math.min(Math.max(Math.round(score * 10) / 10, 0), 100);
}

/**
 * Get a human-readable label for a Flesch Reading Ease score.
 */
export function readabilityLabel(score: number): string {
  if (score >= 90) return 'Very Easy';
  if (score >= 80) return 'Easy';
  if (score >= 70) return 'Fairly Easy';
  if (score >= 60) return 'Standard';
  if (score >= 50) return 'Fairly Difficult';
  if (score >= 30) return 'Difficult';
  return 'Very Difficult';
}

// ---------------------------------------------------------------------------
// Text metrics
// ---------------------------------------------------------------------------

/**
 * Compute text metrics for comparison display.
 */
export function computeTextMetrics(text: string): TextMetrics {
  const charCount = text.length;
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = text.trim().length === 0 ? 0 : words.length;
  const readabilityScore = fleschReadingEase(text);

  return { charCount, wordCount, readabilityScore };
}
