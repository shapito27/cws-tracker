/**
 * Phase 5.2 - reviews table: change-detecting upsert + queries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/shared/db/database';
import type { Review } from '@/shared/types';

const EXT = 'extaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeReview(over: Partial<Review>): Review {
  return {
    reviewId: 'r1',
    extensionId: EXT,
    reviewerName: 'Alice',
    reviewerAvatar: null,
    rating: 5,
    text: 'nice',
    postedDate: '2026-01-01',
    updatedDate: '2026-01-01',
    postedAtEpoch: 1,
    updatedAtEpoch: 1,
    helpfulCount: 0,
    devReplyAuthor: null,
    devReplyText: null,
    devReplyDate: null,
    hasText: true,
    versionReviewed: null,
    language: 'en',
    contentHash: '',
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    lastChangedAt: null,
    isDeleted: false,
    ...over,
  };
}

describe('reviews db', () => {
  beforeEach(async () => {
    await db.reviews.clear();
  });

  it('inserts new reviews and reports them as new', async () => {
    const res = await db.saveReviews([makeReview({ reviewId: 'r1' }), makeReview({ reviewId: 'r2' })]);
    expect(res.new.sort()).toEqual(['r1', 'r2']);
    expect(res.edited).toEqual([]);
    expect(await db.reviews.count()).toBe(2);
  });

  it('is idempotent — identical content re-saved is neither new nor edited', async () => {
    await db.saveReviews([makeReview({ reviewId: 'r1' })]);
    const res = await db.saveReviews([makeReview({ reviewId: 'r1' })]);
    expect(res.new).toEqual([]);
    expect(res.edited).toEqual([]);
    expect(await db.reviews.count()).toBe(1);
  });

  it('detects an edited review by content change', async () => {
    await db.saveReviews([makeReview({ reviewId: 'r1', text: 'old' })]);
    const res = await db.saveReviews([makeReview({ reviewId: 'r1', text: 'new text' })]);
    expect(res.edited).toEqual(['r1']);
    expect(res.new).toEqual([]);
    const stored = await db.reviews.where('reviewId').equals('r1').first();
    expect(stored!.text).toBe('new text');
    expect(stored!.lastChangedAt).not.toBeNull();
  });

  it('detects a rating change as an edit', async () => {
    await db.saveReviews([makeReview({ reviewId: 'r1', rating: 5 })]);
    const res = await db.saveReviews([makeReview({ reviewId: 'r1', rating: 1 })]);
    expect(res.edited).toEqual(['r1']);
  });

  it('detects a newly added developer reply', async () => {
    await db.saveReviews([makeReview({ reviewId: 'r1', devReplyText: null })]);
    const res = await db.saveReviews([makeReview({ reviewId: 'r1', devReplyText: 'thanks!' })]);
    expect(res.replied).toEqual(['r1']);
    expect(res.edited).toEqual(['r1']);
  });

  it('preserves firstSeenAt across updates', async () => {
    await db.saveReviews([makeReview({ reviewId: 'r1', firstSeenAt: new Date('2026-01-01T00:00:00Z') })]);
    await db.saveReviews([makeReview({ reviewId: 'r1', text: 'edited', firstSeenAt: new Date('2099-01-01T00:00:00Z') })]);
    const stored = await db.reviews.where('reviewId').equals('r1').first();
    expect(stored!.firstSeenAt.getUTCFullYear()).toBe(2026);
  });

  it('queries stored review ids and by range', async () => {
    await db.saveReviews([
      makeReview({ reviewId: 'r1', postedDate: '2026-01-01' }),
      makeReview({ reviewId: 'r2', postedDate: '2026-02-01' }),
    ]);
    const ids = await db.getStoredReviewIds(EXT);
    expect(ids.has('r1')).toBe(true);
    expect(ids.has('r2')).toBe(true);
    const inRange = await db.getReviewsInRange(EXT, '2026-01-15', '2026-03-01');
    expect(inRange.map((r) => r.reviewId)).toEqual(['r2']);
  });

  it('deleteExtensionData removes reviews for the extension', async () => {
    await db.saveReviews([makeReview({ reviewId: 'r1' })]);
    await db.deleteExtensionData(EXT);
    expect(await db.reviews.count()).toBe(0);
  });

  it('pruneOldSnapshots removes reviews posted before the cutoff', async () => {
    await db.saveReviews([
      makeReview({ reviewId: 'old', postedDate: '2025-01-01' }),
      makeReview({ reviewId: 'new', postedDate: '2026-06-01' }),
    ]);
    await db.pruneOldSnapshots('2026-01-01');
    const remaining = await db.reviews.toArray();
    expect(remaining.map((r) => r.reviewId)).toEqual(['new']);
  });
});
