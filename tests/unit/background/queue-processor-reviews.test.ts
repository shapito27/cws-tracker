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
import type { QueueJob } from '@/shared/types';

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
  return { fetchPage, sendMessage: vi.fn(), settings: new SettingsManager() };
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

    // One proxy call to /reviews with the extension id.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0][0]).toContain('/reviews');
    expect(fetchPage.mock.calls[0][0]).toContain(`id=${EXT}`);

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
});
