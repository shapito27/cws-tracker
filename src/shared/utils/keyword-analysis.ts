/**
 * Keyword analysis utilities (Phase 2.4).
 *
 * Provides keyword frequency matrix, gap analysis, and keyword difficulty
 * estimation for competitive keyword intelligence.
 */

import type { ListingSnapshot, RankSnapshot } from '../types/index';
import { countKeywordOccurrences } from './text-analysis';
import { extractKeywords } from './text-analysis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Keyword frequency counts for a single extension. */
export interface KeywordFrequencyCell {
  extensionId: string;
  titleCount: number;
  shortDescCount: number;
  fullDescCount: number;
  totalCount: number;
}

/** One row in the keyword frequency matrix. */
export interface KeywordFrequencyRow {
  keyword: string;
  cells: KeywordFrequencyCell[];
}

/** A keyword gap suggestion - a keyword competitors use but the user doesn't. */
export interface KeywordGapSuggestion {
  keyword: string;
  /** Number of competitor extensions that use this keyword. */
  competitorCount: number;
  /** Total frequency across all competitor descriptions. */
  totalFrequency: number;
}

/** Keyword difficulty estimate for a single keyword. */
export interface KeywordDifficultyResult {
  keyword: string;
  /** Average rating of the top-ranking extensions for this keyword. */
  averageRating: number;
  /** Average user count of the top-ranking extensions. */
  averageUserCount: number;
  /** Average listing quality score (only from extensions that have one). */
  averageQualityScore: number | null;
  /** 0-100 difficulty score (higher = harder). */
  difficultyScore: number;
  /** Number of extensions used to compute the averages. */
  sampleSize: number;
}

// ---------------------------------------------------------------------------
// Keyword frequency matrix (2.4.2)
// ---------------------------------------------------------------------------

/**
 * Build a keyword frequency matrix showing how often each tracked keyword
 * appears in each extension's title, short description, and full description.
 *
 * @param keywords - Array of keyword strings to analyze
 * @param snapshots - Map of extensionId -> latest ListingSnapshot
 * @returns One row per keyword, each containing frequency cells per extension
 */
export function buildKeywordFrequencyMatrix(
  keywords: string[],
  snapshots: Map<string, ListingSnapshot>
): KeywordFrequencyRow[] {
  return keywords.map(keyword => {
    const cells: KeywordFrequencyCell[] = [];

    for (const [extensionId, snapshot] of snapshots) {
      const titleCount = countKeywordOccurrences(snapshot.title, keyword);
      const shortDescCount = countKeywordOccurrences(snapshot.shortDescription, keyword);
      const fullDescCount = countKeywordOccurrences(snapshot.fullDescription, keyword);
      const totalCount = titleCount + shortDescCount + fullDescCount;

      cells.push({
        extensionId,
        titleCount,
        shortDescCount,
        fullDescCount,
        totalCount,
      });
    }

    return { keyword, cells };
  });
}

/**
 * Check whether the user's extension has lower keyword density than any
 * competitor for a given keyword row.
 *
 * @param row - A keyword frequency row
 * @param ownExtensionId - The user's own extension ID
 * @returns true if any competitor has a higher total count than the user's extension
 */
export function hasLowerDensity(
  row: KeywordFrequencyRow,
  ownExtensionId: string
): boolean {
  const ownCell = row.cells.find(c => c.extensionId === ownExtensionId);
  if (!ownCell) return false;

  return row.cells.some(
    c => c.extensionId !== ownExtensionId && c.totalCount > ownCell.totalCount
  );
}

// ---------------------------------------------------------------------------
// Keyword gap analysis (2.4.3)
// ---------------------------------------------------------------------------

/**
 * Identify keywords that competitors use but the user's extension doesn't.
 *
 * Extracts top keywords from all competitor descriptions, filters out
 * keywords already being tracked, and returns suggestions sorted by
 * frequency across competitors.
 *
 * @param ownSnapshot - The user's own extension listing snapshot
 * @param competitorSnapshots - Array of competitor listing snapshots
 * @param trackedKeywords - Keywords already being tracked (excluded from results)
 * @param maxResults - Maximum number of suggestions to return (default 20)
 * @returns Array of keyword gap suggestions sorted by total frequency descending
 */
export function analyzeKeywordGaps(
  ownSnapshot: ListingSnapshot | null,
  competitorSnapshots: ListingSnapshot[],
  trackedKeywords: string[],
  maxResults: number = 20
): KeywordGapSuggestion[] {
  if (competitorSnapshots.length === 0) return [];

  // Normalize tracked keywords to lowercase for comparison
  const trackedSet = new Set(trackedKeywords.map(k => k.toLowerCase()));

  // Extract keywords from own extension's description for filtering
  const ownKeywords = new Set<string>();
  if (ownSnapshot) {
    const ownText = [
      ownSnapshot.title,
      ownSnapshot.shortDescription,
      ownSnapshot.fullDescription,
    ].join(' ');
    const ownExtracted = extractKeywords(ownText);
    for (const [word] of ownExtracted) {
      ownKeywords.add(word);
    }
  }

  // Aggregate keyword frequencies across competitors
  const competitorKeywordFreqs = new Map<string, { count: number; frequency: number }>();

  for (const snapshot of competitorSnapshots) {
    const text = [
      snapshot.title,
      snapshot.shortDescription,
      snapshot.fullDescription,
    ].join(' ');

    const extracted = extractKeywords(text);
    const seenInThisCompetitor = new Set<string>();

    for (const [word, freq] of extracted) {
      if (!seenInThisCompetitor.has(word)) {
        seenInThisCompetitor.add(word);
        const existing = competitorKeywordFreqs.get(word) ?? { count: 0, frequency: 0 };
        existing.count++;
        existing.frequency += freq;
        competitorKeywordFreqs.set(word, existing);
      } else {
        const existing = competitorKeywordFreqs.get(word);
        if (existing) {
          existing.frequency += freq;
        }
      }
    }
  }

  // Filter: remove keywords the user already has and tracked keywords
  const suggestions: KeywordGapSuggestion[] = [];

  for (const [word, data] of competitorKeywordFreqs) {
    // Skip if already tracked
    if (trackedSet.has(word)) continue;
    // Skip if the user's extension already uses this keyword
    if (ownKeywords.has(word)) continue;

    suggestions.push({
      keyword: word,
      competitorCount: data.count,
      totalFrequency: data.frequency,
    });
  }

  // Sort by competitor count descending, then by total frequency descending
  suggestions.sort((a, b) => {
    if (b.competitorCount !== a.competitorCount) {
      return b.competitorCount - a.competitorCount;
    }
    return b.totalFrequency - a.totalFrequency;
  });

  return suggestions.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Keyword difficulty estimate (2.4.4)
// ---------------------------------------------------------------------------

/**
 * Estimate keyword difficulty based on the metrics of top-ranking extensions.
 *
 * For each keyword, looks at the top N ranking extensions and calculates
 * average rating, user count, and quality score. Higher averages mean
 * a more competitive (harder) keyword.
 *
 * Difficulty score formula (0-100):
 *   - 40% from average rating (normalized: rating/5 * 100)
 *   - 40% from average user count (log-scaled, capped at 10M)
 *   - 20% from average quality score (if available)
 *
 * @param keywordRankings - Map of keyword text -> array of RankSnapshot for that keyword
 * @param snapshots - Map of extensionId -> latest ListingSnapshot
 * @param topN - Number of top-ranking extensions to consider (default 5)
 * @returns Array of difficulty results, one per keyword
 */
export function estimateKeywordDifficulty(
  keywordRankings: Map<string, RankSnapshot[]>,
  snapshots: Map<string, ListingSnapshot>,
  topN: number = 5
): KeywordDifficultyResult[] {
  const results: KeywordDifficultyResult[] = [];

  for (const [keyword, rankings] of keywordRankings) {
    // Get top N ranked extensions (lowest position = best rank)
    // Filter out null positions (not in top 30)
    const ranked = rankings
      .filter(r => r.position !== null)
      .sort((a, b) => a.position! - b.position!)
      .slice(0, topN);

    if (ranked.length === 0) {
      results.push({
        keyword,
        averageRating: 0,
        averageUserCount: 0,
        averageQualityScore: null,
        difficultyScore: 0,
        sampleSize: 0,
      });
      continue;
    }

    // Collect metrics from snapshots of top-ranked extensions
    let totalRating = 0;
    let ratingCount = 0;
    let totalUserCount = 0;
    let totalQualityScore = 0;
    let qualityCount = 0;
    let sampleSize = 0;

    for (const rank of ranked) {
      const snapshot = snapshots.get(rank.extensionId);
      if (!snapshot) continue;

      sampleSize++;

      if (snapshot.rating !== null) {
        totalRating += snapshot.rating;
        ratingCount++;
      }

      totalUserCount += snapshot.userCountNumeric;

      if (snapshot.listingQualityScore !== null) {
        totalQualityScore += snapshot.listingQualityScore;
        qualityCount++;
      }
    }

    if (sampleSize === 0) {
      results.push({
        keyword,
        averageRating: 0,
        averageUserCount: 0,
        averageQualityScore: null,
        difficultyScore: 0,
        sampleSize: 0,
      });
      continue;
    }

    const averageRating = ratingCount > 0 ? totalRating / ratingCount : 0;
    const averageUserCount = totalUserCount / sampleSize;
    const averageQualityScore = qualityCount > 0 ? totalQualityScore / qualityCount : null;

    // Calculate difficulty score (0-100)
    // Rating component (40%): rating/5 * 100
    const ratingDifficulty = ratingCount > 0 ? (averageRating / 5) * 100 : 0;

    // User count component (40%): log-scaled, capped at 10M
    // log10(userCount) / log10(10_000_000) * 100, clamped to [0, 100]
    const userDifficulty = averageUserCount > 0
      ? Math.min((Math.log10(averageUserCount) / Math.log10(10_000_000)) * 100, 100)
      : 0;

    // Quality score component (20%): direct if available
    const qualityDifficulty = averageQualityScore !== null ? averageQualityScore : 50;

    // Weight: 40% rating, 40% user count, 20% quality
    const hasQuality = averageQualityScore !== null;
    let difficultyScore: number;
    if (hasQuality) {
      difficultyScore = ratingDifficulty * 0.4 + userDifficulty * 0.4 + qualityDifficulty * 0.2;
    } else {
      // Without quality scores, split between rating and user count
      difficultyScore = ratingDifficulty * 0.5 + userDifficulty * 0.5;
    }

    difficultyScore = Math.round(Math.min(Math.max(difficultyScore, 0), 100));

    results.push({
      keyword,
      averageRating: Math.round(averageRating * 100) / 100,
      averageUserCount: Math.round(averageUserCount),
      averageQualityScore: averageQualityScore !== null
        ? Math.round(averageQualityScore * 10) / 10
        : null,
      difficultyScore,
      sampleSize,
    });
  }

  return results;
}
