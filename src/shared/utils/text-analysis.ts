/**
 * Text analysis utilities (Phase 1.5.2).
 *
 * Provides Levenshtein distance/similarity, keyword occurrence counting,
 * keyword density calculation, and keyword extraction with stop-word filtering.
 */

// ---------------------------------------------------------------------------
// Stop words (common English words to exclude from keyword extraction)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'its', 'as', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall',
  'can', 'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'that',
  'this', 'these', 'those', 'what', 'which', 'who', 'whom', 'how',
  'when', 'where', 'why', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
  'too', 'very', 'just', 'about', 'above', 'after', 'again', 'also',
  'any', 'because', 'before', 'between', 'during', 'into', 'out',
  'over', 'under', 'until', 'up', 'you', 'your', 'yours', 'we',
  'our', 'ours', 'they', 'their', 'theirs', 'he', 'she', 'his',
  'her', 'him', 'my', 'me', 'i',
]);

// ---------------------------------------------------------------------------
// Levenshtein distance & similarity
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses the classic dynamic-programming approach with O(min(m,n)) space.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space efficiency.
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;

  // Previous and current row of the DP matrix.
  let prev = new Array<number>(aLen + 1);
  let curr = new Array<number>(aLen + 1);

  for (let i = 0; i <= aLen; i++) {
    prev[i] = i;
  }

  for (let j = 1; j <= bLen; j++) {
    curr[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,      // insertion
        prev[i] + 1,           // deletion
        prev[i - 1] + cost     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[aLen];
}

/**
 * Compute 0-1 normalized Levenshtein similarity.
 *
 * Returns 1.0 for identical strings (including both empty).
 * Returns 0.0 for maximally different strings.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// ---------------------------------------------------------------------------
// Keyword occurrence & density
// ---------------------------------------------------------------------------

/**
 * Count whole-word, case-insensitive occurrences of `keyword` in `text`.
 *
 * A "whole word" match means the keyword is surrounded by word boundaries.
 * Multi-word keywords (e.g. "ad blocker") are matched as a phrase.
 */
export function countKeywordOccurrences(text: string, keyword: string): number {
  if (text.length === 0 || keyword.length === 0) return 0;

  // Escape regex special characters in the keyword.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'gi');
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

/**
 * Calculate keyword density: occurrences of `keyword` / total words in `text`.
 *
 * Returns 0 for empty text (avoids division by zero).
 */
export function keywordDensity(text: string, keyword: string): number {
  if (text.length === 0) return 0;
  const words = text.trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && words[0] === '')) return 0;
  const occurrences = countKeywordOccurrences(text, keyword);
  return occurrences / words.length;
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

/**
 * Extract words from text with their frequencies, excluding stop words.
 *
 * Words are lowercased and must meet `minLength` (default 3).
 * Returns a Map of word -> frequency, sorted by frequency descending.
 */
export function extractKeywords(
  text: string,
  minLength: number = 3
): Map<string, number> {
  if (text.length === 0) return new Map();

  const words = text.toLowerCase().match(/[a-z0-9]+/g);
  if (!words) return new Map();

  const freq = new Map<string, number>();
  for (const word of words) {
    if (word.length < minLength) continue;
    if (STOP_WORDS.has(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  // Sort by frequency descending.
  const sorted = new Map(
    [...freq.entries()].sort((a, b) => b[1] - a[1])
  );

  return sorted;
}
