/**
 * Tests for processReviewScan (Phase 5.2).
 *
 * Uses the REAL reviews parser (against the saved fixture) and the REAL db,
 * mocking only fetchPage — per the fixture-based-parser rule.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import { extractCallbackData } from '@/background/parsers/extract';
import { resetChromeMock } from '../../mocks/chrome';
import type { QueueJob, Review } from '@/shared/types';

// Build the proxy-style { data } payload from the saved reviews fixture.
const html = readFileSync(
  resolve(__dirname, '../../fixtures/reviews-website-broken-link-check.html'),
  'utf8',
);
const ds1 = extractCallbackData(html, 'ds:1', 'test');
const DATA_JSON = JSON.stringify(ds1);
const EXT = 'aliiafckfmihheljnphnkpfhlnnjmkgk';

function makeReviewJob(): QueueJob {
  return {
    type: 'review_scan',
    payload: { extensionId: EXT },
    status: 'pending',
    priority: 50,
    retryCount: 0,
    maxRetries: 3,
    scheduledAt: new Date(),
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

function reviewsFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (url.includes('/reviews')) {
      return new Response(JSON.stringify({ data: DATA_JSON }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
}

function makeDeps(fetchPage: ReturnType<typeof vi.fn>) {
  return {
    fetchPage,
    sendMessage: vi.fn(),
    settings: new SettingsManager(),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

describe('processReviewScan', () => {
  beforeEach(async () => {
    resetChromeMock();
    await db.reviews.clear();
    await db.queue.clear();
    await db.events.clear();
    await db.extensions.clear();
    await db.saveExtension({
      id: EXT,
      name: 'Website Broken Link Checker',
      iconUrl: null,
      addedAt: new Date(),
      lastScannedAt: null,
      status: 'active',
      projectRefs: [1],
    });
    await new SettingsManager().set('proxyUrl', 'https://proxy.test');
    await new SettingsManager().set('proxyApiKey', 'test-key');
  });

  it('fetches, parses, and stores all page-1 reviews', async () => {
    const { processNextJob } = await import('@/background/queue-processor');
    await db.enqueueJobs([makeReviewJob()]);
    const fetchPage = reviewsFetch();

    await processNextJob(makeDeps(fetchPage));

    // One proxy call to /reviews with the extension id + the fetch limit.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0][0]).toContain('/reviews');
    expect(fetchPage.mock.calls[0][0]).toContain(`id=${EXT}`);
    expect(fetchPage.mock.calls[0][0]).toContain('limit=');

    const stored = await db.getReviews(EXT);
    expect(stored).toHaveLength(10);
    const first = stored.find((r) => r.reviewId === '0e714621-2985-48ba-827c-fa45cd024c41')!;
    expect(first.reviewerName).toBe('Franklyn Moore');
    expect(first.rating).toBe(5);
    expect(first.hasText).toBe(true);
    expect(first.devReplyAuthor).toBe('Ben');
    expect(first.postedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The CWS-reported text-review count is persisted on the extension.
    const ext = await db.getExtension(EXT);
    expect(ext!.reviewTextCount).toBe(11);
  });

  it('emits a review_new event per review on the first scan', async () => {
    const { processNextJob } = await import('@/background/queue-processor');
    await db.enqueueJobs([makeReviewJob()]);
    const deps = makeDeps(reviewsFetch());

    await processNextJob(deps);

    const events = await db.events.toArray();
    const newEvents = events.filter((e) => e.type === 'review_new');
    expect(newEvents).toHaveLength(10);
    expect(newEvents.every((e) => e.extensionId === EXT)).toBe(true);
    // NEW_EVENT messages broadcast to the UI.
    const newEventMsgs = deps.sendMessage.mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === 'NEW_EVENT',
    );
    expect(newEventMsgs.length).toBe(10);
  });

  it('is idempotent — a second identical scan emits no new events', async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await db.enqueueJobs([makeReviewJob()]);
    await processNextJob(makeDeps(reviewsFetch()));

    await db.events.clear();
    await db.enqueueJobs([makeReviewJob()]);
    const deps2 = makeDeps(reviewsFetch());
    await processNextJob(deps2);

    const events = await db.events.toArray();
    expect(events.filter((e) => e.type.startsWith('review_'))).toHaveLength(0);
    // Still 10 stored reviews (no duplicates).
    expect(await db.getReviews(EXT)).toHaveLength(10);
  });

  it('throws (job fails/retries) when no proxy is configured', async () => {
    const { processNextJob } = await import('@/background/queue-processor');
    await new SettingsManager().set('proxyUrl', '');
    await db.enqueueJobs([makeReviewJob()]);
    const fetchPage = reviewsFetch();

    await processNextJob(makeDeps(fetchPage));

    // No fetch attempted without a proxy; job is retried (still present, not completed).
    expect(fetchPage).not.toHaveBeenCalled();
    const jobs = await db.queue.toArray();
    expect(jobs[0].status).not.toBe('completed');
  });

  describe('removed reviews', () => {
    function extraStored(overrides: Partial<Review> = {}): Review {
      const seen = new Date('2026-01-01T00:00:00Z');
      return {
        reviewId: 'deleted-by-reviewer', extensionId: EXT, reviewerName: 'Jane Doe',
        reviewerAvatar: null, rating: 2, text: 'This stopped working after the update',
        postedDate: '2026-01-01', updatedDate: '2026-01-01',
        postedAtEpoch: 1767225600, updatedAtEpoch: 1767225600, helpfulCount: 0,
        devReplyAuthor: null, devReplyText: null, devReplyDate: null, hasText: true,
        versionReviewed: null, language: 'en', contentHash: 'x',
        firstSeenAt: seen, lastSeenAt: seen, lastChangedAt: null, isDeleted: false,
        ...overrides,
      };
    }

    async function scanOnce(): Promise<ReturnType<typeof makeDeps>> {
      const { processNextJob } = await import('@/background/queue-processor');
      await db.enqueueJobs([makeReviewJob()]);
      const deps = makeDeps(reviewsFetch());
      await processNextJob(deps);
      return deps;
    }

    it('marks a stored review that vanished and emits a review_removed event with its content', async () => {
      await scanOnce(); // stores the 10 fixture reviews
      await db.reviews.put(extraStored());
      await db.events.clear();

      const deps = await scanOnce();

      const gone = (await db.getReviews(EXT)).find((r) => r.reviewId === 'deleted-by-reviewer')!;
      expect(gone.removedAt).toBeInstanceOf(Date);
      expect(gone.text).toBe('This stopped working after the update'); // content kept

      const events = (await db.events.toArray()).filter((e) => e.type === 'review_removed');
      expect(events).toHaveLength(1);
      expect(events[0].oldValue).toBe('deleted-by-reviewer');
      expect(events[0].note).toContain('Jane Doe');
      expect(events[0].note).toContain('This stopped working');
      expect(events[0].lastSeenOldAt).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(events[0].firstSeenNewAt).toBeInstanceOf(Date);
      expect(
        deps.sendMessage.mock.calls.some((c) => (c[0] as { type?: string }).type === 'NEW_EVENT')
      ).toBe(true);
    });

    it('does not re-emit on later scans and keeps the first detection time', async () => {
      await scanOnce();
      await db.reviews.put(extraStored());
      await scanOnce();
      const first = (await db.reviews.where('reviewId').equals('deleted-by-reviewer').first())!.removedAt;
      await db.events.clear();

      await scanOnce();

      expect((await db.events.toArray()).filter((e) => e.type === 'review_removed')).toHaveLength(0);
      const again = (await db.reviews.where('reviewId').equals('deleted-by-reviewer').first())!.removedAt;
      expect(again).toEqual(first);
    });

    it('clears the removed mark when a review comes back', async () => {
      await scanOnce();
      const live = (await db.getReviews(EXT))[0];
      await db.reviews.update(live.id!, { removedAt: new Date() });

      await scanOnce();

      expect((await db.reviews.get(live.id!))!.removedAt ?? null).toBeNull();
    });

    it('flags nothing when the fetch returns no reviews', async () => {
      await scanOnce();
      const { processNextJob } = await import('@/background/queue-processor');
      await db.enqueueJobs([makeReviewJob()]);
      const empty = vi.fn(async () =>
        new Response(JSON.stringify({ data: JSON.stringify([[null], [], null]) }), { status: 200 })
      );
      await processNextJob(makeDeps(empty));

      const rows = await db.getReviews(EXT);
      expect(rows.every((r) => !r.removedAt)).toBe(true);
    });
  });
});
