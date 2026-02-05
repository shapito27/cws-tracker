/**
 * Tests for Queue Processor (Phase 1.6.2).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { CWSDatabase } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import '../../mocks/chrome';
import { resetChromeMock } from '../../mocks/chrome';

// Mock parser modules before importing the processor
vi.mock('@/background/parsers/index', () => {
  class MockParserError extends Error {
    constructor(
      message: string,
      public readonly parserVersion: string,
      public readonly field?: string,
    ) {
      super(`[Parser ${parserVersion}] ${message}${field ? ` (field: ${field})` : ''}`);
      this.name = 'ParserError';
    }
  }

  return {
    getListingParser: () => ({
      version: 'v1',
      parse: (html: string) => {
        if (html === 'parser-error-html') {
          throw new MockParserError('Parse failed', 'v1', 'name');
        }
        return {
          extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          name: 'Test Extension',
          shortDescription: 'A test extension',
          fullDescription: 'Full description here',
          rating: 4.5,
          ratingCount: 100,
          reviewCount: 100,
          userCount: '10,000+',
          userCountNumeric: 10000,
          version: '1.0.0',
          lastUpdated: '2026-01-15',
          size: '1.5MiB',
          permissions: ['storage'],
          hostPermissions: [],
          screenshotCount: 3,
          screenshotUrls: [],
          hasPromoVideo: false,
          translationCount: 5,
          availableLocales: ['en', 'es', 'fr', 'de', 'ja'],
          languages: ['English'],
          category: 'productivity',
          categoryId: null,
          developerName: 'Test Dev',
          developerVerified: false,
          badgeFlags: {},
          iconUrl: 'https://example.com/icon.png',
          websiteUrl: null,
          privacyPolicyUrl: null,
          supportUrl: null,
          manifestJson: null,
          developerEmail: null,
          developerId: null,
          browserMinVersion: null,
        };
      },
    }),
    getSearchParser: () => ({
      version: 'v1',
      parse: () => ({
        results: [
          {
            extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            name: 'Test Extension',
            iconUrl: 'https://example.com/icon.png',
            rating: 4.5,
            ratingCount: 100,
            shortDescription: 'A test',
            userCount: 10000,
            category: 'productivity',
            isFeatured: false,
            position: 3,
          },
          {
            extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            name: 'Other Extension',
            iconUrl: 'https://example.com/icon2.png',
            rating: 4.0,
            ratingCount: 50,
            shortDescription: 'Another test',
            userCount: 5000,
            category: 'productivity',
            isFeatured: false,
            position: 15,
          },
        ],
        totalCount: 120,
        nextPageToken: null,
      }),
    }),
    ParserError: MockParserError,
  };
});

// Mock the database module to allow swapping per test
vi.mock('@/shared/db/database', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/shared/db/database')>();
  const dbRef: { current: InstanceType<typeof mod.CWSDatabase> | null } = { current: null };

  return {
    ...mod,
    get db() {
      return dbRef.current!;
    },
    _setTestDb(newDb: InstanceType<typeof mod.CWSDatabase>) {
      dbRef.current = newDb;
    },
  };
});

// Import after mocks are set up
import type { ProcessorDeps } from '@/background/queue-processor';
import type { QueueJob } from '@/shared/types';

// ---------------------------------------------------------------------------
// Test database (fresh instance per test)
// ---------------------------------------------------------------------------

let testDb: CWSDatabase;

const MOCK_LISTING_HTML = 'mock-listing-html';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDeps(overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
  return {
    fetchPage: vi.fn().mockResolvedValue(new Response(MOCK_LISTING_HTML, { status: 200 })),
    sendMessage: vi.fn(),
    settings: new SettingsManager(),
    ...overrides,
  };
}

function makeListingJob(
  extensionId: string = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  overrides: Partial<QueueJob> = {}
): QueueJob {
  return {
    type: 'listing_scan',
    payload: { extensionId },
    status: 'pending',
    priority: 10,
    retryCount: 0,
    maxRetries: 3,
    scheduledAt: new Date(Date.now() - 1000),
    startedAt: null,
    completedAt: null,
    error: null,
    ...overrides,
  };
}

function makeKeywordJob(
  keywordId: number = 1,
  keyword: string = 'ad blocker',
  overrides: Partial<QueueJob> = {}
): QueueJob {
  return {
    type: 'keyword_scan',
    payload: { keywordId, keyword },
    status: 'pending',
    priority: 30,
    retryCount: 0,
    maxRetries: 3,
    scheduledAt: new Date(Date.now() - 1000),
    startedAt: null,
    completedAt: null,
    error: null,
    ...overrides,
  };
}

async function seedProject(): Promise<void> {
  await testDb.saveProject({
    id: 1,
    name: 'Test Project',
    ownExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    competitorIds: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccccc'],
    keywordIds: [1],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await testDb.saveExtension({
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Test Extension',
    iconUrl: null,
    addedAt: new Date(),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
  });

  await testDb.saveExtension({
    id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    name: 'Competitor 1',
    iconUrl: null,
    addedAt: new Date(),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
  });

  await testDb.saveExtension({
    id: 'cccccccccccccccccccccccccccccccccc',
    name: 'Competitor 2',
    iconUrl: null,
    addedAt: new Date(),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
  });

  await testDb.saveKeyword({
    id: 1,
    text: 'ad blocker',
    projectId: 1,
    createdAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue Processor', () => {
  beforeEach(async () => {
    resetChromeMock();

    const name = 'test-processor-' + Date.now() + '-' + Math.random();
    testDb = new CWSDatabase(name);
    await testDb.open();

    const dbMod = await import('@/shared/db/database');
    (dbMod as unknown as { _setTestDb: (db: CWSDatabase) => void })._setTestDb(testDb);
  });

  describe('processNextJob', () => {
    it('no pending jobs → returns hasMore=false', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      const deps = createDeps();
      const result = await processNextJob(deps);
      expect(result.hasMore).toBe(false);
      expect(result.delayMs).toBe(0);
    });

    it('listing_scan: fetches, parses, saves snapshot, returns with delay', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeListingJob()]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response(MOCK_LISTING_HTML, { status: 200 })
      );
      const deps = createDeps({ fetchPage });

      const result = await processNextJob(deps);

      expect(result.hasMore).toBe(false);
      expect(result.delayMs).toBeGreaterThan(0);

      // Verify fetch was called with correct URL
      expect(fetchPage).toHaveBeenCalledOnce();
      const calledUrl = fetchPage.mock.calls[0][0] as string;
      expect(calledUrl).toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      // Verify snapshot was saved
      const snapshots = await testDb.listing_snapshots.toArray();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].title).toBe('Test Extension');
      expect(snapshots[0].permissionRiskScore).toBeGreaterThanOrEqual(0);

      // Verify job is completed
      const jobs = await testDb.queue.toArray();
      expect(jobs[0].status).toBe('completed');
    });

    it('keyword_scan: saves rank snapshots for all tracked extensions', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeKeywordJob()]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response('mock-search', { status: 200 })
      );
      const deps = createDeps({ fetchPage });

      const result = await processNextJob(deps);

      expect(result.hasMore).toBe(false);

      const rankSnapshots = await testDb.rank_snapshots.toArray();
      expect(rankSnapshots).toHaveLength(3);

      // Extension A found at position 3
      const snapA = rankSnapshots.find(
        (s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      );
      expect(snapA!.position).toBe(3);

      // Extension B found at position 15
      const snapB = rankSnapshots.find(
        (s) => s.extensionId === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );
      expect(snapB!.position).toBe(15);

      // Extension C NOT found → position=null
      const snapC = rankSnapshots.find(
        (s) => s.extensionId === 'cccccccccccccccccccccccccccccccccc'
      );
      expect(snapC!.position).toBeNull();
    });

    it('HTTP 429: job retried, retryCount incremented', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeListingJob()]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response('', { status: 429, statusText: 'Too Many Requests' })
      );
      const deps = createDeps({ fetchPage });

      await processNextJob(deps);

      const jobs = await testDb.queue.toArray();
      expect(jobs[0].status).toBe('pending');
      expect(jobs[0].retryCount).toBe(1);
      expect(jobs[0].error).toContain('429');

      expect(deps.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCAN_ERROR',
          retriesLeft: 2,
        })
      );
    });

    it('HTTP 404 on listing_scan: extension marked removed, job completed', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeListingJob()]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response('', { status: 404, statusText: 'Not Found' })
      );
      const deps = createDeps({ fetchPage });

      await processNextJob(deps);

      const jobs = await testDb.queue.toArray();
      expect(jobs[0].status).toBe('completed');

      const ext = await testDb.getExtension('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(ext!.status).toBe('removed');
    });

    it('HTTP 500: job retried with backoff', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeListingJob()]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response('', { status: 500, statusText: 'Internal Server Error' })
      );
      const deps = createDeps({ fetchPage });

      await processNextJob(deps);

      const jobs = await testDb.queue.toArray();
      expect(jobs[0].status).toBe('pending');
      expect(jobs[0].retryCount).toBe(1);
      expect(jobs[0].scheduledAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('network error (fetch throws): job retried', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeListingJob()]);

      const fetchPage = vi.fn().mockRejectedValue(
        new TypeError('Failed to fetch')
      );
      const deps = createDeps({ fetchPage });

      await processNextJob(deps);

      const jobs = await testDb.queue.toArray();
      expect(jobs[0].status).toBe('pending');
      expect(jobs[0].retryCount).toBe(1);
    });

    it('ParserError: job retried', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeListingJob()]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response('parser-error-html', { status: 200 })
      );
      const deps = createDeps({ fetchPage });

      await processNextJob(deps);

      const jobs = await testDb.queue.toArray();
      expect(jobs[0].status).toBe('pending');
      expect(jobs[0].retryCount).toBe(1);
      expect(jobs[0].error).toContain('Parse failed');
    });

    it('max retries exceeded: job marked failed terminal', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([
        makeListingJob('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
          retryCount: 3,
          maxRetries: 3,
        }),
      ]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response('', { status: 500, statusText: 'Internal Server Error' })
      );
      const deps = createDeps({ fetchPage });

      await processNextJob(deps);

      const jobs = await testDb.queue.toArray();
      expect(jobs[0].status).toBe('failed');
      expect(jobs[0].error).toContain('500');

      expect(deps.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCAN_ERROR',
          retriesLeft: 0,
        })
      );
    });

    it('listing_scan sends progress message after success', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeListingJob()]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response(MOCK_LISTING_HTML, { status: 200 })
      );
      const sendMessage = vi.fn();
      const deps = createDeps({ fetchPage, sendMessage });

      await processNextJob(deps);

      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SCAN_PROGRESS',
        })
      );
    });

    it('listing_scan updates extension metadata after success', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeListingJob()]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response(MOCK_LISTING_HTML, { status: 200 })
      );
      const deps = createDeps({ fetchPage });

      await processNextJob(deps);

      const ext = await testDb.getExtension('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(ext!.name).toBe('Test Extension');
      expect(ext!.lastScannedAt).not.toBeNull();
      expect(ext!.iconUrl).toBe('https://example.com/icon.png');
    });

    it('job with scheduledAt in the future: skipped', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([
        makeListingJob('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
          scheduledAt: new Date(Date.now() + 600_000),
        }),
      ]);

      const deps = createDeps();
      const result = await processNextJob(deps);

      expect(result.hasMore).toBe(false);
      expect(result.delayMs).toBe(0);
    });
  });

  describe('calculateRetryDelay', () => {
    it('retry 1 → 2 minutes', async () => {
      const { calculateRetryDelay } = await import('@/background/queue-processor');
      expect(calculateRetryDelay(1)).toBe(120_000);
    });

    it('retry 2 → 4 minutes', async () => {
      const { calculateRetryDelay } = await import('@/background/queue-processor');
      expect(calculateRetryDelay(2)).toBe(240_000);
    });

    it('retry 3 → 8 minutes', async () => {
      const { calculateRetryDelay } = await import('@/background/queue-processor');
      expect(calculateRetryDelay(3)).toBe(480_000);
    });

    it('delay never exceeds 10 minutes (600000ms)', async () => {
      const { calculateRetryDelay } = await import('@/background/queue-processor');
      expect(calculateRetryDelay(10)).toBe(600_000);
      expect(calculateRetryDelay(20)).toBe(600_000);
    });
  });

  describe('classifyError', () => {
    it('HttpError 429 → retriable', async () => {
      const { classifyError, HttpError } = await import('@/background/queue-processor');
      expect(classifyError(new HttpError(429, 'Too Many Requests'))).toBe('retriable');
    });

    it('HttpError 500 → retriable', async () => {
      const { classifyError, HttpError } = await import('@/background/queue-processor');
      expect(classifyError(new HttpError(500, 'Internal Server Error'))).toBe('retriable');
    });

    it('network error → retriable', async () => {
      const { classifyError } = await import('@/background/queue-processor');
      expect(classifyError(new TypeError('Failed to fetch'))).toBe('retriable');
    });

    it('unknown error → retriable', async () => {
      const { classifyError } = await import('@/background/queue-processor');
      expect(classifyError(new Error('Something went wrong'))).toBe('retriable');
    });
  });

  describe('normal delay', () => {
    it('delay is within expected range (base +/- jitter)', async () => {
      const { processNextJob } = await import('@/background/queue-processor');
      await seedProject();
      await testDb.enqueueJobs([makeListingJob()]);

      const fetchPage = vi.fn().mockResolvedValue(
        new Response(MOCK_LISTING_HTML, { status: 200 })
      );
      const deps = createDeps({ fetchPage });

      const result = await processNextJob(deps);

      // Default: 60000ms base +/- 10000ms jitter → [50000, 70000]
      expect(result.delayMs).toBeGreaterThanOrEqual(50_000);
      expect(result.delayMs).toBeLessThanOrEqual(70_000);
    });
  });
});
