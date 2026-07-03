/**
 * Composable for review analytics in the dashboard.
 *
 * Pure async loader functions (matching the useAutocomplete style) that read
 * directly from the db. Analytics are computed live from stored reviews plus
 * the latest listing snapshot's rating count.
 */

import { db } from '@/shared/db/database';
import { extractKeywords } from '@/shared/utils/text-analysis';
import type { Review } from '@/shared/types';

export interface ReviewSummary {
  /** Average star rating across captured reviews (falls back to listing rating). */
  avgRating: number | null;
  /** Total ratings for the extension (from the latest listing snapshot). */
  totalRatings: number;
  /** Number of reviews with text (CWS-reported count, else captured text count). */
  textReviews: number;
  /** Ratings without text = totalRatings − textReviews (never negative). */
  emptyReviews: number;
  /** Count of reviews per star: index 0 = 1★ … index 4 = 5★ (captured reviews). */
  ratingDistribution: number[];
  /** Number of reviews actually captured/stored locally. */
  capturedCount: number;
}

export interface ReviewListOptions {
  sort?: 'date' | 'rating' | 'helpful';
  minRating?: number;
  maxRating?: number;
  /** When set, filter to reviews with (true) or without (false) text. */
  hasText?: boolean;
}

export interface ReviewKeyword {
  term: string;
  count: number;
}

/**
 * Compute the summary card metrics for an extension's reviews.
 */
export async function loadReviewSummary(extensionId: string): Promise<ReviewSummary> {
  const [reviews, listing, ext] = await Promise.all([
    db.getReviews(extensionId),
    db.getLatestListingSnapshot(extensionId),
    db.getExtension(extensionId),
  ]);

  const ratingDistribution = [0, 0, 0, 0, 0];
  let sum = 0;
  let rated = 0;
  for (const r of reviews) {
    if (r.rating >= 1 && r.rating <= 5) {
      ratingDistribution[r.rating - 1] += 1;
      sum += r.rating;
      rated += 1;
    }
  }

  const capturedTextReviews = reviews.filter((r) => r.hasText).length;
  // Prefer the CWS-reported text-review count (accurate even when capped);
  // fall back to the captured text-review count.
  const textReviews =
    typeof ext?.reviewTextCount === 'number' && ext.reviewTextCount !== null
      ? ext.reviewTextCount
      : capturedTextReviews;
  const totalRatings = listing?.ratingCount ?? reviews.length;
  const emptyReviews = Math.max(0, totalRatings - textReviews);

  const avgRating = rated > 0 ? sum / rated : (listing?.rating ?? null);

  return {
    avgRating,
    totalRatings,
    textReviews,
    emptyReviews,
    ratingDistribution,
    capturedCount: reviews.length,
  };
}

/**
 * Load stored reviews for an extension, filtered and sorted.
 */
export async function loadReviewList(
  extensionId: string,
  opts: ReviewListOptions = {}
): Promise<Review[]> {
  let reviews = await db.getReviews(extensionId);

  if (typeof opts.minRating === 'number') {
    reviews = reviews.filter((r) => r.rating >= opts.minRating!);
  }
  if (typeof opts.maxRating === 'number') {
    reviews = reviews.filter((r) => r.rating <= opts.maxRating!);
  }
  if (typeof opts.hasText === 'boolean') {
    reviews = reviews.filter((r) => r.hasText === opts.hasText);
  }

  const sort = opts.sort ?? 'date';
  reviews.sort((a, b) => {
    if (sort === 'rating') return b.rating - a.rating;
    if (sort === 'helpful') return b.helpfulCount - a.helpfulCount;
    // date: newest first by posted epoch
    return b.postedAtEpoch - a.postedAtEpoch;
  });

  return reviews;
}

/**
 * Extract the most frequent keywords from an extension's review text,
 * optionally filtered by star-rating band.
 */
export async function loadReviewKeywords(
  extensionId: string,
  opts: { minRating?: number; maxRating?: number; limit?: number } = {}
): Promise<ReviewKeyword[]> {
  let reviews = await db.getReviews(extensionId);
  if (typeof opts.minRating === 'number') {
    reviews = reviews.filter((r) => r.rating >= opts.minRating!);
  }
  if (typeof opts.maxRating === 'number') {
    reviews = reviews.filter((r) => r.rating <= opts.maxRating!);
  }

  const combined = reviews
    .filter((r) => r.hasText)
    .map((r) => r.text)
    .join(' ');

  const freq = extractKeywords(combined);
  const limit = opts.limit ?? 30;
  return [...freq.entries()].slice(0, limit).map(([term, count]) => ({ term, count }));
}

export function useReviews() {
  return {
    loadReviewSummary,
    loadReviewList,
    loadReviewKeywords,
  };
}
