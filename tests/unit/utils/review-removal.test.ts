import { describe, it, expect } from 'vitest';
import type { Review } from '@/shared/types';
import { findRemovedReviews } from '@/shared/utils/review-removal';

function review(id: string, posted: number, updated = posted, extra: Partial<Review> = {}): Review {
  return {
    reviewId: id, extensionId: 'e'.repeat(32), reviewerName: 'A', reviewerAvatar: null,
    rating: 5, text: 't', postedDate: '2026-01-01', updatedDate: '2026-01-01',
    postedAtEpoch: posted, updatedAtEpoch: updated, helpfulCount: 0,
    devReplyAuthor: null, devReplyText: null, devReplyDate: null, hasText: true,
    versionReviewed: null, language: null, contentHash: 'h',
    firstSeenAt: new Date(), lastSeenAt: new Date(), lastChangedAt: null, isDeleted: false,
    ...extra,
  };
}

const ids = (rs: Review[]): string[] => rs.map((r) => r.reviewId).sort();

describe('findRemovedReviews', () => {
  it('flags nothing when the fetch is empty (could be an upstream failure)', () => {
    expect(findRemovedReviews({ stored: [review('a', 100)], fetched: [], limit: 50, moreAvailable: false })).toEqual([]);
  });

  it('a short fetch is the complete list: every unseen stored review is removed', () => {
    const stored = [review('a', 100), review('b', 50), review('c', 10)];
    const fetched = [review('a', 100), review('c', 10)];
    expect(ids(findRemovedReviews({ stored, fetched, limit: 50, moreAvailable: false }))).toEqual(['b']);
  });

  it('a full fetch is a window: an older stored review outside it is not flagged', () => {
    const fetched = [review('n1', 300), review('n2', 250), review('n3', 200)]; // limit 3
    const stored = [...fetched, review('old', 50), review('gone', 260)];
    expect(ids(findRemovedReviews({ stored, fetched, limit: 3, moreAvailable: false }))).toEqual(['gone']);
  });

  it('requires BOTH timestamps inside the window (edited-recently but posted long ago)', () => {
    const fetched = [review('n1', 300), review('n2', 250), review('n3', 200)];
    const editedOld = review('x', 10, 290); // posted outside the window, updated inside
    expect(findRemovedReviews({ stored: [...fetched, editedOld], fetched, limit: 3, moreAvailable: false })).toEqual([]);
  });

  it('ignores reviews already marked removed', () => {
    const stored = [review('a', 100), review('b', 50, 50, { removedAt: new Date() })];
    expect(findRemovedReviews({ stored, fetched: [review('a', 100)], limit: 50, moreAvailable: false })).toEqual([]);
  });

  it('treats a mass disappearance as a fetch anomaly', () => {
    const stored = Array.from({ length: 10 }, (_, i) => review(`r${i}`, 100 + i));
    const fetched = [stored[0]]; // 9 of 10 "gone"
    expect(findRemovedReviews({ stored, fetched, limit: 50, moreAvailable: false })).toEqual([]);
  });

  it('still flags a few removals out of many', () => {
    const stored = Array.from({ length: 20 }, (_, i) => review(`r${i}`, 100 + i));
    const fetched = stored.slice(4); // 4 gone of 20
    expect(ids(findRemovedReviews({ stored, fetched, limit: 50, moreAvailable: false }))).toEqual(['r0', 'r1', 'r2', 'r3']);
  });

  it('a short fetch with a continuation token is a window, not the complete list', () => {
    const fetched = [review('n1', 300), review('n2', 250)]; // 2 < limit 50, but CWS says more exist
    const stored = [...fetched, review('old', 50), review('gone', 260)];
    expect(
      ids(findRemovedReviews({ stored, fetched, limit: 50, moreAvailable: true }))
    ).toEqual(['gone']);
  });

  it('flags nothing from a window fetch containing an unparseable (0) timestamp', () => {
    const fetched = [review('n1', 300), review('n2', 0, 0), review('n3', 200)];
    const stored = [...fetched, review('a', 100), review('b', 150), review('c', 160), review('d', 170)];
    expect(findRemovedReviews({ stored, fetched, limit: 3, moreAvailable: false })).toEqual([]);
  });
});
