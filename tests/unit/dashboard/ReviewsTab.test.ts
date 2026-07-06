// @vitest-environment jsdom

/**
 * Render tests for ReviewsTab — verifies the empty state and the populated
 * summary + review list render from seeded db data.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { db } from '@/shared/db/database';

/** Drain the onMounted load plus the watcher-triggered reload. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await flushPromises();
}
import '../../mocks/chrome';
import { resetChromeMock } from '../../mocks/chrome';
import type { Project, Review, Extension, ListingSnapshot } from '@/shared/types';

const { default: ReviewsTab } = await import('@/dashboard/components/project/ReviewsTab.vue');

const EXT = 'extaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeProject(): Project {
  return {
    id: 1, name: 'P', ownExtensionId: EXT, competitorIds: [], keywordIds: [],
    createdAt: new Date(), updatedAt: new Date(),
  };
}
function makeExtension(): Extension {
  return { id: EXT, name: 'My Ext', iconUrl: null, addedAt: new Date(), lastScannedAt: null, status: 'active', projectRefs: [1], reviewTextCount: 2 };
}
function makeReview(over: Partial<Review>): Review {
  return {
    reviewId: 'r', extensionId: EXT, reviewerName: 'Jane Doe', reviewerAvatar: null,
    rating: 5, text: 'great tool', postedDate: '2026-03-01', updatedDate: '2026-03-01',
    postedAtEpoch: 1_700_000_000, updatedAtEpoch: 1_700_000_000, helpfulCount: 2,
    devReplyAuthor: null, devReplyText: null, devReplyDate: null, hasText: true,
    versionReviewed: '1.0', language: 'en', contentHash: '', firstSeenAt: new Date(),
    lastSeenAt: new Date(), lastChangedAt: null, isDeleted: false, ...over,
  };
}
function makeListing(): ListingSnapshot {
  return {
    extensionId: EXT, date: '2026-03-01', title: 'T', shortDescription: '', fullDescription: '',
    rating: 4.8, ratingCount: 3, reviewCount: 3, userCount: '1,000+', userCountNumeric: 1000,
    version: '1.0', lastUpdated: '2026-03-01', size: '1MiB', permissions: [], hostPermissions: [],
    permissionRiskScore: 0, badgeFlags: {}, screenshotCount: 0, hasPromoVideo: false,
    translationCount: 0, availableLocales: [], category: '', developerName: '',
    developerVerified: false, listingQualityScore: null, scannedAt: new Date(),
  };
}

describe('ReviewsTab', () => {
  beforeEach(async () => {
    resetChromeMock();
    await db.reviews.clear();
    await db.extensions.clear();
    await db.listing_snapshots.clear();
    await db.projects.clear();
    await db.projects.put(makeProject());
    await db.saveExtension(makeExtension());
  });

  it('shows the empty state when no reviews are stored', async () => {
    const wrapper = mount(ReviewsTab, { props: { project: makeProject() } });
    await settle();
    expect(wrapper.text()).toContain('No reviews captured yet');
  });

  it('renders summary metrics and the review list from stored data', async () => {
    await db.saveReviews([
      makeReview({ reviewId: 'r1', reviewerName: 'Jane Doe', rating: 5, text: 'love this extension' }),
      makeReview({ reviewId: 'r2', reviewerName: 'Bob', rating: 4, text: 'pretty good tool', devReplyAuthor: 'Dev', devReplyText: 'Thanks Bob!', devReplyDate: '2026-03-02' }),
    ]);
    await db.saveListingSnapshot(makeListing());

    const wrapper = mount(ReviewsTab, { props: { project: makeProject() } });
    await settle();

    const text = wrapper.text();
    expect(text).toContain('Jane Doe');
    expect(text).toContain('love this extension');
    expect(text).toContain('Total ratings');
    // Developer reply renders.
    expect(text).toContain('Thanks Bob!');
    // Text vs empty: reviewTextCount=2, totalRatings=3 → 1 empty.
    expect(text).toContain('Rating-only (empty)');
  });

  it('triggers a reviews scan when Refresh is clicked', async () => {
    await db.saveReviews([makeReview({ reviewId: 'r1' })]);
    await db.saveListingSnapshot(makeListing());
    const sendMessage = vi.spyOn(chrome.runtime, 'sendMessage');

    const wrapper = mount(ReviewsTab, { props: { project: makeProject() } });
    await settle();

    const btn = wrapper.findAll('button').find((b) => b.text().includes('Refresh reviews'));
    expect(btn).toBeTruthy();
    await btn!.trigger('click');
    await settle();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TRIGGER_REFRESH', projectId: 1, scanType: 'reviews' }),
    );
  });
});
