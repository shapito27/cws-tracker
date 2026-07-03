/**
 * Tests for the useReviews composable analytics loaders (Phase 5.2).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import { loadReviewSummary, loadReviewList, loadReviewKeywords } from '@/dashboard/composables/useReviews';
import type { Review, ListingSnapshot, Extension } from '@/shared/types';

const EXT = 'extaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeReview(over: Partial<Review>): Review {
  return {
    reviewId: 'r', extensionId: EXT, reviewerName: 'A', reviewerAvatar: null,
    rating: 5, text: 'good', postedDate: '2026-01-01', updatedDate: '2026-01-01',
    postedAtEpoch: 1_700_000_000, updatedAtEpoch: 1_700_000_000, helpfulCount: 0,
    devReplyAuthor: null, devReplyText: null, devReplyDate: null, hasText: true,
    versionReviewed: null, language: 'en', contentHash: '', firstSeenAt: new Date(),
    lastSeenAt: new Date(), lastChangedAt: null, isDeleted: false, ...over,
  };
}

function makeExtension(over: Partial<Extension> = {}): Extension {
  return {
    id: EXT, name: 'Test Ext', iconUrl: null, addedAt: new Date(),
    lastScannedAt: null, status: 'active', projectRefs: [1], ...over,
  };
}

function makeListing(over: Partial<ListingSnapshot>): ListingSnapshot {
  return {
    extensionId: EXT, date: '2026-01-01', title: 'T', shortDescription: '', fullDescription: '',
    rating: 4.2, ratingCount: 5, reviewCount: 5, userCount: '1,000+', userCountNumeric: 1000,
    version: '1.0', lastUpdated: '2026-01-01', size: '1MiB', permissions: [], hostPermissions: [],
    permissionRiskScore: 0, badgeFlags: {}, screenshotCount: 0, hasPromoVideo: false,
    translationCount: 0, availableLocales: [], category: '', developerName: '',
    developerVerified: false, listingQualityScore: null, scannedAt: new Date(), ...over,
  };
}

describe('useReviews', () => {
  beforeEach(async () => {
    await db.reviews.clear();
    await db.listing_snapshots.clear();
    await db.extensions.clear();
  });

  describe('loadReviewSummary', () => {
    it('computes distribution, average, and exact text/empty split', async () => {
      await db.saveReviews([
        makeReview({ reviewId: 'r1', rating: 5, text: 'love it' }),
        makeReview({ reviewId: 'r2', rating: 4, text: 'pretty good' }),
        makeReview({ reviewId: 'r3', rating: 1, text: 'broke' }),
      ]);
      await db.saveListingSnapshot(makeListing({ ratingCount: 5 }));
      await db.saveExtension(makeExtension({ reviewTextCount: 3 }));

      const s = await loadReviewSummary(EXT);
      expect(s.capturedCount).toBe(3);
      expect(s.ratingDistribution).toEqual([1, 0, 0, 1, 1]); // 1★=1, 4★=1, 5★=1
      expect(s.avgRating).toBeCloseTo((5 + 4 + 1) / 3, 5);
      expect(s.totalRatings).toBe(5);
      expect(s.textReviews).toBe(3);
      expect(s.emptyReviews).toBe(2); // 5 total − 3 text
    });

    it('falls back to captured text count when reviewTextCount is unset', async () => {
      await db.saveReviews([
        makeReview({ reviewId: 'r1', rating: 5, text: 'has text', hasText: true }),
        makeReview({ reviewId: 'r2', rating: 5, text: '', hasText: false }),
      ]);
      await db.saveListingSnapshot(makeListing({ ratingCount: 4 }));
      await db.saveExtension(makeExtension()); // no reviewTextCount

      const s = await loadReviewSummary(EXT);
      expect(s.textReviews).toBe(1); // one captured review has text
      expect(s.emptyReviews).toBe(3); // 4 − 1
    });

    it('handles an extension with no reviews', async () => {
      const s = await loadReviewSummary(EXT);
      expect(s.capturedCount).toBe(0);
      expect(s.avgRating).toBeNull();
      expect(s.totalRatings).toBe(0);
    });
  });

  describe('loadReviewList', () => {
    beforeEach(async () => {
      await db.saveReviews([
        makeReview({ reviewId: 'r1', rating: 5, helpfulCount: 1, postedAtEpoch: 300, text: 'a' }),
        makeReview({ reviewId: 'r2', rating: 2, helpfulCount: 9, postedAtEpoch: 100, text: '' , hasText: false }),
        makeReview({ reviewId: 'r3', rating: 4, helpfulCount: 3, postedAtEpoch: 200, text: 'c' }),
      ]);
    });

    it('sorts by date (newest first) by default', async () => {
      const list = await loadReviewList(EXT);
      expect(list.map((r) => r.reviewId)).toEqual(['r1', 'r3', 'r2']);
    });

    it('sorts by helpful count', async () => {
      const list = await loadReviewList(EXT, { sort: 'helpful' });
      expect(list[0].reviewId).toBe('r2');
    });

    it('filters by minRating and hasText', async () => {
      const highRated = await loadReviewList(EXT, { minRating: 4 });
      expect(highRated.map((r) => r.reviewId).sort()).toEqual(['r1', 'r3']);
      const withText = await loadReviewList(EXT, { hasText: true });
      expect(withText.every((r) => r.hasText)).toBe(true);
    });
  });

  describe('loadReviewKeywords', () => {
    it('returns frequent terms in descending order, filtered by rating', async () => {
      await db.saveReviews([
        makeReview({ reviewId: 'r1', rating: 5, text: 'fast fast reliable extension' }),
        makeReview({ reviewId: 'r2', rating: 5, text: 'fast and reliable' }),
        makeReview({ reviewId: 'r3', rating: 1, text: 'broken crashes crashes' }),
      ]);

      const positive = await loadReviewKeywords(EXT, { minRating: 4 });
      expect(positive[0].term).toBe('fast');
      expect(positive[0].count).toBe(3);
      expect(positive.some((k) => k.term === 'broken')).toBe(false);

      const negative = await loadReviewKeywords(EXT, { maxRating: 2 });
      expect(negative.find((k) => k.term === 'crashes')?.count).toBe(2);
    });
  });
});
