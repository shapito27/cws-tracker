/**
 * Tests for review-analysis (audit review signals).
 */
import { describe, it, expect } from 'vitest';
import {
  computeReviewSignals,
  renderReviewBlock,
  reviewSetFingerprint,
  type ReviewSignals,
} from '../../../src/shared/utils/review-analysis';
import type { Review, ListingSnapshot } from '../../../src/shared/types';

const REF = '2026-07-06';

function makeReview(overrides: Partial<Review> = {}): Review {
  const posted = overrides.postedDate ?? '2026-07-01';
  return {
    reviewId: 'r-' + Math.abs(hash(posted + (overrides.text ?? '') + (overrides.rating ?? 5))),
    extensionId: 'ext-own-id-12345678901234567890',
    reviewerName: 'Alice',
    reviewerAvatar: null,
    rating: 5,
    text: 'Great extension',
    postedDate: posted,
    updatedDate: posted,
    postedAtEpoch: Date.parse(posted + 'T00:00:00') / 1000,
    updatedAtEpoch: Date.parse(posted + 'T00:00:00') / 1000,
    helpfulCount: 0,
    devReplyAuthor: null,
    devReplyText: null,
    devReplyDate: null,
    hasText: (overrides.text ?? 'Great extension').trim().length > 0,
    versionReviewed: '1.0.0',
    language: 'en',
    contentHash: 'h',
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    lastChangedAt: null,
    isDeleted: false,
    ...overrides,
  };
}

// tiny deterministic hash so reviewId is stable without Math.random
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function makeListing(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    extensionId: 'ext-own-id-12345678901234567890',
    date: '2026-07-05',
    title: 'My Extension',
    shortDescription: 'short',
    fullDescription: 'full',
    rating: 4.2,
    ratingCount: 150,
    reviewCount: 150,
    userCount: '50,000+',
    userCountNumeric: 50000,
    version: '1.5.0',
    lastUpdated: '2026-06-15',
    size: '2.5MiB',
    permissions: [],
    hostPermissions: [],
    permissionRiskScore: 20,
    badgeFlags: {},
    screenshotCount: 3,
    hasPromoVideo: false,
    translationCount: 5,
    availableLocales: ['en'],
    category: 'Productivity',
    developerName: 'Dev Inc',
    developerEmail: null,
    developerVerified: false,
    listingQualityScore: 72,
    scannedAt: new Date(),
    ...overrides,
  };
}

describe('computeReviewSignals()', () => {
  it('counts captured reviews and averages ratings', () => {
    const reviews = [makeReview({ rating: 5 }), makeReview({ rating: 3 })];
    const s = computeReviewSignals(reviews, makeListing(), [], { referenceDate: REF });
    expect(s.capturedCount).toBe(2);
    expect(s.capturedAvgRating).toBe(4);
    expect(s.lifetimeAvgRating).toBe(4.2);
    expect(s.totalRatings).toBe(150);
  });

  it('splits recent vs prior 30-day windows by postedDate', () => {
    const reviews = [
      makeReview({ postedDate: '2026-07-01' }), // 5 days ago -> recent
      makeReview({ postedDate: '2026-06-20' }), // 16 days -> recent
      makeReview({ postedDate: '2026-06-01' }), // 35 days -> prior
      makeReview({ postedDate: '2026-04-01' }), // 96 days -> neither
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF });
    expect(s.recentCount).toBe(2);
    expect(s.priorCount).toBe(1);
  });

  it('computes recent-average from the most recent sample', () => {
    const reviews = [
      makeReview({ postedDate: '2026-07-05', rating: 2 }),
      makeReview({ postedDate: '2026-07-04', rating: 2 }),
      makeReview({ postedDate: '2026-01-01', rating: 5 }),
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF, recentSampleSize: 2 });
    expect(s.recentAvgRating).toBe(2);
  });

  it('computes dev-reply rates overall and for low (<=3) reviews', () => {
    const reviews = [
      makeReview({ rating: 5, devReplyText: 'thanks' }),
      makeReview({ rating: 2, devReplyText: 'sorry, fixing' }),
      makeReview({ rating: 1, devReplyText: null }),
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF });
    expect(s.devReplyRatePct).toBe(67);
    expect(s.devReplyRateLowPct).toBe(50);
  });

  it('collects distinct languages sorted', () => {
    const reviews = [
      makeReview({ language: 'es' }),
      makeReview({ language: 'en' }),
      makeReview({ language: 'en' }),
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF });
    expect(s.languages).toEqual(['en', 'es']);
  });

  it('groups version ratings, newest version first, max 2', () => {
    const reviews = [
      makeReview({ versionReviewed: '2.0.0', rating: 3, postedDate: '2026-07-05' }),
      makeReview({ versionReviewed: '2.0.0', rating: 3, postedDate: '2026-07-04' }),
      makeReview({ versionReviewed: '1.0.0', rating: 5, postedDate: '2026-06-01' }),
      makeReview({ versionReviewed: '0.9.0', rating: 4, postedDate: '2026-05-01' }),
    ];
    const s = computeReviewSignals(reviews, null, [], { referenceDate: REF });
    expect(s.versionRatings).toEqual([
      { version: '2.0.0', count: 2, avgRating: 3 },
      { version: '1.0.0', count: 1, avgRating: 5 },
    ]);
  });

  it('counts keyword full-word vs partial (substring) review hits', () => {
    const reviews = [
      makeReview({ text: 'best password manager ever' }),
      makeReview({ text: 'the passwords sync well' }), // partial only
      makeReview({ text: 'no mention here' }),
    ];
    const s = computeReviewSignals(reviews, null, ['password'], { referenceDate: REF });
    expect(s.keywordHits).toEqual([{ keyword: 'password', fullWord: 1, partial: 2 }]);
  });

  it('handles empty reviews without throwing', () => {
    const s = computeReviewSignals([], makeListing(), ['x'], { referenceDate: REF });
    expect(s.capturedCount).toBe(0);
    expect(s.capturedAvgRating).toBeNull();
    expect(s.devReplyRatePct).toBe(0);
    expect(s.devReplyRateLowPct).toBeNull();
  });
});

describe('renderReviewBlock()', () => {
  const own: ReviewSignals = computeReviewSignals(
    [makeReview({ rating: 4, text: 'good vpn', devReplyText: 'thanks' })],
    makeListing(),
    ['vpn'],
    { referenceDate: REF, textReviewCount: 60 },
  );

  it('returns empty string when both sides are null', () => {
    expect(renderReviewBlock(null, null)).toBe('');
  });

  it('returns empty string when both sides have zero captured reviews', () => {
    const empty = computeReviewSignals([], makeListing(), [], { referenceDate: REF });
    expect(renderReviewBlock(empty, empty)).toBe('');
  });

  it('renders a labeled block with an own column when data exists', () => {
    const block = renderReviewBlock(own, null);
    expect(block).toContain('Review Signals');
    expect(block).toContain('sample'); // sample-labeling guardrail
    expect(block).toContain('No review scan yet'); // competitor side missing
    expect(block).toContain('vpn');
  });
});

describe('recency guard + cell escaping + fingerprint', () => {
  it('does not count a future-dated review as recent', () => {
    const s = computeReviewSignals(
      [makeReview({ postedDate: '2026-07-20' })], // after REF (2026-07-06)
      null, [], { referenceDate: REF },
    );
    expect(s.recentCount).toBe(0);
    expect(s.priorCount).toBe(0);
  });

  it('escapes pipe characters in rendered cells', () => {
    const s = computeReviewSignals(
      [makeReview({ text: 'a|b review', rating: 5 })],
      null, ['a|b'], { referenceDate: REF },
    );
    const block = renderReviewBlock(s, null);
    // the keyword "a|b" must appear escaped, never as a raw table delimiter
    expect(block).toContain('a\\|b');
    expect(block).not.toMatch(/\| a\|b:/);
  });

  it('fingerprints a review set by count and content; empty => 0', () => {
    expect(reviewSetFingerprint(undefined)).toBe('0');
    expect(reviewSetFingerprint([])).toBe('0');
    const a = reviewSetFingerprint([makeReview({ postedDate: '2026-07-01' })]);
    const b = reviewSetFingerprint([
      makeReview({ postedDate: '2026-07-01' }),
      makeReview({ postedDate: '2026-07-02' }),
    ]);
    expect(a).not.toBe(b); // different count => different fingerprint
  });

  it('fingerprint reacts to content changes and is order-independent', () => {
    const a = reviewSetFingerprint([makeReview({ reviewId: 'x', contentHash: 'h1' })]);
    const b = reviewSetFingerprint([makeReview({ reviewId: 'x', contentHash: 'h2' })]);
    expect(a).not.toBe(b); // content change with same id/count still busts
    const p = reviewSetFingerprint([makeReview({ reviewId: 'x' }), makeReview({ reviewId: 'y' })]);
    const q = reviewSetFingerprint([makeReview({ reviewId: 'y' }), makeReview({ reviewId: 'x' })]);
    expect(p).toBe(q); // order-independent
  });

  it('excludes a future-dated review from the recent-average sample', () => {
    const s = computeReviewSignals(
      [makeReview({ postedDate: '2026-07-20', rating: 1 }), makeReview({ postedDate: '2026-07-01', rating: 5 })],
      null, [], { referenceDate: REF, recentSampleSize: 1 },
    );
    expect(s.recentAvgRating).toBe(5); // future 1★ excluded; newest valid is the 5★
  });
});
