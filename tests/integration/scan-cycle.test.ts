/**
 * Integration Tests (Phase 1.10).
 *
 * End-to-end flows tested with mock fetch responses (no real CWS requests).
 * Tests the full pipeline: project setup → queue building → job processing →
 * snapshot saving → event detection → scheduler coordination.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import 'fake-indexeddb/auto';
import { CWSDatabase } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import '../mocks/chrome';
import { resetChromeMock } from '../mocks/chrome';
import type {
  Project,
  Extension,
  Keyword,
  QueueJob,
  ListingSnapshot,
} from '@/shared/types';
import type { ProcessorDeps } from '@/background/queue-processor';
import type { SchedulerDeps } from '@/background/scheduler';

// ---------------------------------------------------------------------------
// Mock parsers - configurable per test
// ---------------------------------------------------------------------------

let mockListingParse: Mock;
let mockSearchParse: Mock;
// eslint-disable-next-line prefer-const
let mockAutocompleteParse: Mock | undefined;

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
        if (mockListingParse) return mockListingParse(html);
        return createDefaultListingData();
      },
    }),
    getSearchParser: () => ({
      version: 'v1',
      parse: (html: string) => {
        if (mockSearchParse) return mockSearchParse(html);
        return createDefaultSearchData();
      },
    }),
    getAutocompleteParser: () => ({
      version: 'v1',
      parse: (json: string) => {
        if (mockAutocompleteParse) return mockAutocompleteParse(json);
        return createDefaultAutocompleteData();
      },
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

// ---------------------------------------------------------------------------
// Default mock data factories
// ---------------------------------------------------------------------------

function createDefaultListingData(overrides: Record<string, unknown> = {}) {
  return {
    extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Test Extension',
    shortDescription: 'A test extension for tracking',
    fullDescription: 'Full description of the test extension with features and details',
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
    ...overrides,
  };
}

function createDefaultSearchData(overrides: Record<string, unknown> = {}) {
  return {
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
        name: 'Competitor 1',
        iconUrl: 'https://example.com/icon2.png',
        rating: 4.0,
        ratingCount: 50,
        shortDescription: 'A competitor',
        userCount: 5000,
        category: 'productivity',
        isFeatured: false,
        position: 7,
      },
    ],
    totalCount: 120,
    nextPageToken: null,
    ...overrides,
  };
}

function createDefaultAutocompleteData() {
  return {
    suggestions: [
      {
        type: 'extension' as const,
        name: 'Test Extension',
        extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        iconUrl: 'https://example.com/icon.png',
        position: 1,
      },
      {
        type: 'text' as const,
        text: 'ad blocker free',
        position: 2,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDb: CWSDatabase;

function createProcessorDeps(overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
  return {
    fetchPage: vi.fn().mockResolvedValue(new Response('mock-html', { status: 200 })),
    sendMessage: vi.fn(),
    settings: new SettingsManager(),
    ...overrides,
  };
}

function createSchedulerDeps(processorDeps?: ProcessorDeps): SchedulerDeps {
  return {
    settings: new SettingsManager(),
    processorDeps,
  };
}

async function seedSingleProject(): Promise<{
  project: Project;
  ownExt: Extension;
  competitor1: Extension;
  competitor2: Extension;
  keyword: Keyword;
}> {
  const project: Project = {
    id: 1,
    name: 'My Project',
    ownExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    competitorIds: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccccc'],
    keywordIds: [1],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await testDb.saveProject(project);

  const ownExt: Extension = {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Test Extension',
    iconUrl: null,
    addedAt: new Date(),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
  };
  await testDb.saveExtension(ownExt);

  const competitor1: Extension = {
    id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    name: 'Competitor 1',
    iconUrl: null,
    addedAt: new Date(),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
  };
  await testDb.saveExtension(competitor1);

  const competitor2: Extension = {
    id: 'cccccccccccccccccccccccccccccccccc',
    name: 'Competitor 2',
    iconUrl: null,
    addedAt: new Date(),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
  };
  await testDb.saveExtension(competitor2);

  const keyword: Keyword = {
    id: 1,
    text: 'ad blocker',
    projectId: 1,
    createdAt: new Date(),
  };
  await testDb.saveKeyword(keyword);

  return { project, ownExt, competitor1, competitor2, keyword };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  resetChromeMock();

  const name = 'test-integration-' + Date.now() + '-' + Math.random();
  testDb = new CWSDatabase(name);
  await testDb.open();

  const dbMod = await import('@/shared/db/database');
  (dbMod as unknown as { _setTestDb: (db: CWSDatabase) => void })._setTestDb(testDb);

  // Reset parser mocks to defaults
  mockListingParse = vi.fn().mockImplementation((html: string) => {
    if (html.includes('ext-aaa')) {
      return createDefaultListingData({
        extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Test Extension',
      });
    }
    if (html.includes('ext-bbb')) {
      return createDefaultListingData({
        extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        name: 'Competitor 1',
        rating: 4.0,
        ratingCount: 50,
        userCount: '5,000+',
        userCountNumeric: 5000,
        version: '2.0.0',
        permissions: ['storage', 'tabs'],
      });
    }
    if (html.includes('ext-ccc')) {
      return createDefaultListingData({
        extensionId: 'cccccccccccccccccccccccccccccccccc',
        name: 'Competitor 2',
        rating: 3.5,
        ratingCount: 20,
        userCount: '1,000+',
        userCountNumeric: 1000,
        version: '0.5.0',
      });
    }
    // Default
    return createDefaultListingData();
  });

  mockSearchParse = vi.fn().mockReturnValue(createDefaultSearchData());
});

// ===========================================================================
// 1.10.1 Full scan cycle
// ===========================================================================

describe('1.10.1 Full scan cycle', () => {
  it('create project → add extension → add keywords → trigger scan → verify snapshots and events', async () => {
    const { buildDailyScanJobs } = await import('@/background/queue-builder');
    const { processNextJob } = await import('@/background/queue-processor');

    // 1. Seed the project with extensions and keywords
    const { project, ownExt, competitor1, competitor2, keyword } = await seedSingleProject();

    // 2. Build scan jobs
    const allProjects = await testDb.getAllProjects();
    const allExtensions = await testDb.extensions.toArray();
    const allKeywords = await testDb.keywords.toArray();
    const jobs = buildDailyScanJobs(allProjects, allExtensions, allKeywords);

    // Expect 3 listing_scan + 1 keyword_scan + 1 autocomplete_scan = 5 jobs
    expect(jobs).toHaveLength(5);
    const listingJobs = jobs.filter((j) => j.type === 'listing_scan');
    const keywordJobs = jobs.filter((j) => j.type === 'keyword_scan');
    const autocompleteJobs = jobs.filter((j) => j.type === 'autocomplete_scan');
    expect(listingJobs).toHaveLength(3);
    expect(keywordJobs).toHaveLength(1);
    expect(autocompleteJobs).toHaveLength(1);

    // 3. Enqueue jobs
    await testDb.enqueueJobs(jobs);

    // 4. Create a fetchPage mock that responds based on extensionId in URL
    const fetchPage = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')) {
        return new Response('ext-aaa', { status: 200 });
      }
      if (url.includes('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')) {
        return new Response('ext-bbb', { status: 200 });
      }
      if (url.includes('cccccccccccccccccccccccccccccccccc')) {
        return new Response('ext-ccc', { status: 200 });
      }
      // Search URL
      return new Response('search-results', { status: 200 });
    });

    const sendMessage = vi.fn();
    const deps = createProcessorDeps({ fetchPage, sendMessage });

    // 5. Process all 5 jobs one at a time (3 listing + 1 keyword + 1 autocomplete)
    // autocomplete_scan will fail because no proxyUrl is configured - that's OK,
    // it will be retried and eventually fail permanently
    for (let i = 0; i < 5; i++) {
      await processNextJob(deps);
    }

    // Verify exactly 4 fetch calls were made (autocomplete doesn't fetch without proxy)
    expect(fetchPage.mock.calls.length).toBe(4);

    // 6. Verify listing_snapshots saved (1 per extension)
    const listingSnapshots = await testDb.listing_snapshots.toArray();
    expect(listingSnapshots).toHaveLength(3);

    const snapshotExtIds = listingSnapshots.map((s) => s.extensionId).sort();
    expect(snapshotExtIds).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccccccccccccc',
    ]);

    // Verify snapshot content
    const ownSnapshot = listingSnapshots.find(
      (s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )!;
    expect(ownSnapshot.title).toBe('Test Extension');
    expect(ownSnapshot.rating).toBe(4.5);
    expect(ownSnapshot.permissionRiskScore).toBeGreaterThanOrEqual(0);

    // 7. Verify rank_snapshots saved (1 per tracked extension per keyword)
    const rankSnapshots = await testDb.rank_snapshots.toArray();
    expect(rankSnapshots).toHaveLength(3); // 3 extensions × 1 keyword

    const extArank = rankSnapshots.find(
      (s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )!;
    expect(extArank.position).toBe(3);
    expect(extArank.keywordId).toBe(1);

    const extBrank = rankSnapshots.find(
      (s) => s.extensionId === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )!;
    expect(extBrank.position).toBe(7);

    const extCrank = rankSnapshots.find(
      (s) => s.extensionId === 'cccccccccccccccccccccccccccccccccc'
    )!;
    expect(extCrank.position).toBeNull(); // Not in search results

    // 8. Verify events: first scan → no events (no previous snapshot to compare)
    const events = await testDb.events.toArray();
    expect(events).toHaveLength(0);

    // 9. Verify listing/keyword jobs completed, autocomplete retried (no proxy configured)
    const finalStats = await testDb.getQueueStats();
    expect(finalStats.completed).toBe(4); // 3 listing + 1 keyword
    expect(finalStats.pending).toBe(1); // 1 autocomplete (retry pending)
    expect(finalStats.running).toBe(0);
    expect(finalStats.failed).toBe(0);

    // 10. Verify extension metadata was updated
    const updatedExt = await testDb.getExtension('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(updatedExt!.lastScannedAt).not.toBeNull();
    expect(updatedExt!.iconUrl).toBe('https://example.com/icon.png');
  });
});

// ===========================================================================
// 1.10.2 Second scan cycle
// ===========================================================================

describe('1.10.2 Second scan cycle', () => {
  it('second scan detects changes and generates events', async () => {
    const { buildDailyScanJobs } = await import('@/background/queue-builder');
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    // --- First scan ---
    const allProjects = await testDb.getAllProjects();
    const allExtensions = await testDb.extensions.toArray();
    const allKeywords = await testDb.keywords.toArray();
    const jobs1 = buildDailyScanJobs(allProjects, allExtensions, allKeywords);
    await testDb.enqueueJobs(jobs1);

    const fetchPage = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')) return new Response('ext-aaa', { status: 200 });
      if (url.includes('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')) return new Response('ext-bbb', { status: 200 });
      if (url.includes('cccccccccccccccccccccccccccccccccc')) return new Response('ext-ccc', { status: 200 });
      return new Response('search-results', { status: 200 });
    });
    const sendMessage = vi.fn();
    const deps = createProcessorDeps({ fetchPage, sendMessage });

    // Process all first-scan jobs
    for (let i = 0; i < 4; i++) {
      await processNextJob(deps);
    }

    const firstSnapshots = await testDb.listing_snapshots.toArray();
    expect(firstSnapshots).toHaveLength(3);
    expect(await testDb.events.toArray()).toHaveLength(0);

    // --- Second scan: change title and version for ext-aaa ---
    mockListingParse.mockImplementation((html: string) => {
      if (html.includes('ext-aaa')) {
        return createDefaultListingData({
          extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          name: 'Test Extension v2', // title changed
          version: '2.0.0', // version changed
          userCountNumeric: 50000, // crossed 50K milestone (was 10K)
          userCount: '50,000+',
        });
      }
      if (html.includes('ext-bbb')) {
        return createDefaultListingData({
          extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          name: 'Competitor 1',
          rating: 4.0,
          ratingCount: 50,
          userCount: '5,000+',
          userCountNumeric: 5000,
          version: '2.0.0',
          permissions: ['storage', 'tabs'],
        });
      }
      if (html.includes('ext-ccc')) {
        return createDefaultListingData({
          extensionId: 'cccccccccccccccccccccccccccccccccc',
          name: 'Competitor 2',
          rating: 3.5,
          ratingCount: 20,
          userCount: '1,000+',
          userCountNumeric: 1000,
          version: '0.5.0',
        });
      }
      return createDefaultListingData();
    });

    // Update search results: ext-aaa moved from position 3 to 1
    mockSearchParse.mockReturnValue(
      createDefaultSearchData({
        results: [
          {
            extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            name: 'Test Extension v2',
            iconUrl: 'https://example.com/icon.png',
            rating: 4.5,
            ratingCount: 100,
            shortDescription: 'A test',
            userCount: 50000,
            category: 'productivity',
            isFeatured: false,
            position: 1, // improved from 3
          },
          {
            extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            name: 'Competitor 1',
            iconUrl: 'https://example.com/icon2.png',
            rating: 4.0,
            ratingCount: 50,
            shortDescription: 'A competitor',
            userCount: 5000,
            category: 'productivity',
            isFeatured: false,
            position: 7,
          },
        ],
        totalCount: 120,
        nextPageToken: null,
      })
    );

    // Build and enqueue second scan jobs
    const jobs2 = buildDailyScanJobs(
      await testDb.getAllProjects(),
      await testDb.extensions.toArray(),
      await testDb.keywords.toArray()
    );
    await testDb.enqueueJobs(jobs2);

    // Process all second-scan jobs
    for (let i = 0; i < 4; i++) {
      await processNextJob(deps);
    }

    // Verify listing snapshots (3 total: same-day scans overwrite previous)
    const allListingSnapshots = await testDb.listing_snapshots.toArray();
    expect(allListingSnapshots).toHaveLength(3);

    // Verify rank snapshots (3 total: same-day scans overwrite previous)
    const allRankSnapshots = await testDb.rank_snapshots.toArray();
    expect(allRankSnapshots).toHaveLength(3);

    // Verify change events were detected for ext-aaa
    const events = await testDb.events.toArray();
    expect(events.length).toBeGreaterThan(0);

    const titleChangeEvent = events.find(
      (e) => e.type === 'title_change' && e.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    expect(titleChangeEvent).toBeDefined();
    expect(titleChangeEvent!.oldValue).toBe('Test Extension');
    expect(titleChangeEvent!.newValue).toBe('Test Extension v2');

    const versionChangeEvent = events.find(
      (e) => e.type === 'version_change' && e.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    expect(versionChangeEvent).toBeDefined();
    expect(versionChangeEvent!.oldValue).toBe('1.0.0');
    expect(versionChangeEvent!.newValue).toBe('2.0.0');

    // Verify user milestone event (crossed 50K)
    const userMilestoneEvent = events.find(
      (e) => e.type === 'user_milestone' && e.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    expect(userMilestoneEvent).toBeDefined();
    expect(userMilestoneEvent!.note).toContain('50K');

    // Verify new rank snapshot for ext-aaa shows position 1
    const secondRankA = allRankSnapshots
      .filter((s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime())[0];
    expect(secondRankA.position).toBe(1);
  });
});

// ===========================================================================
// 1.10.3 Queue resilience
// ===========================================================================

describe('1.10.3 Queue resilience', () => {
  it('simulates service worker restart mid-scan: running jobs reset to pending, scan resumes', async () => {
    const { processNextJob } = await import('@/background/queue-processor');
    const { handleProcessQueueAlarm } = await import('@/background/scheduler');

    await seedSingleProject();

    // Manually create jobs with one marked as 'running' (simulating SW killed mid-job)
    const jobs: QueueJob[] = [
      {
        type: 'listing_scan',
        payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        status: 'running', // Was running when SW died
        priority: 10,
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(Date.now() - 60000),
        startedAt: new Date(Date.now() - 30000),
        completedAt: null,
        error: null,
      },
      {
        type: 'listing_scan',
        payload: { extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
        status: 'pending',
        priority: 20,
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(Date.now() - 60000),
        startedAt: null,
        completedAt: null,
        error: null,
      },
    ];
    await testDb.enqueueJobs(jobs);

    // Verify running job exists before reset
    const runningBefore = await testDb.getRunningJobs();
    expect(runningBefore).toHaveLength(1);

    // Simulate SW restart by calling handleProcessQueueAlarm (which calls resetRunningJobs)
    const fetchPage = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')) return new Response('ext-aaa', { status: 200 });
      if (url.includes('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')) return new Response('ext-bbb', { status: 200 });
      return new Response('mock', { status: 200 });
    });
    const sendMessage = vi.fn();
    const processorDeps = createProcessorDeps({ fetchPage, sendMessage });
    const schedulerDeps = createSchedulerDeps(processorDeps);

    // handleProcessQueueAlarm resets running → pending, then processes one job
    await handleProcessQueueAlarm(schedulerDeps);

    // After first alarm: one job should be completed, one still pending
    const statsAfterFirst = await testDb.getQueueStats();
    expect(statsAfterFirst.completed).toBe(1);
    expect(statsAfterFirst.running).toBe(0);
    // The formerly-running job should now be completed (was reset to pending, then processed)
    // OR the other pending job was processed (depending on priority)

    // Process remaining job
    await handleProcessQueueAlarm(schedulerDeps);

    const statsAfterSecond = await testDb.getQueueStats();
    expect(statsAfterSecond.completed).toBe(2);
    expect(statsAfterSecond.pending).toBe(0);
    expect(statsAfterSecond.running).toBe(0);

    // Verify snapshots were saved for both extensions
    const snapshots = await testDb.listing_snapshots.toArray();
    expect(snapshots).toHaveLength(2);
  });

  it('resetRunningJobs resets status and clears startedAt', async () => {
    // Create a running job
    await testDb.enqueueJobs([{
      type: 'listing_scan',
      payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      status: 'running',
      priority: 10,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 60000),
      startedAt: new Date(Date.now() - 30000),
      completedAt: null,
      error: null,
    }]);

    const count = await testDb.resetRunningJobs();
    expect(count).toBe(1);

    const allJobs = await testDb.queue.toArray();
    expect(allJobs[0].status).toBe('pending');
    expect(allJobs[0].startedAt).toBeNull();
  });
});

// ===========================================================================
// 1.10.4 Error handling
// ===========================================================================

describe('1.10.4 Error handling', () => {
  it('simulates fetch failures with retry and eventual terminal failure', async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    // Enqueue a single job
    await testDb.enqueueJobs([{
      type: 'listing_scan',
      payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      status: 'pending',
      priority: 10,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null,
      completedAt: null,
      error: null,
    }]);

    // Fetch always fails with 500
    const fetchPage = vi.fn().mockResolvedValue(
      new Response('', { status: 500, statusText: 'Internal Server Error' })
    );
    const sendMessage = vi.fn();
    const deps = createProcessorDeps({ fetchPage, sendMessage });

    // Retry 1: retryCount goes from 0 → 1
    await processNextJob(deps);
    let job = (await testDb.queue.toArray())[0];
    expect(job.status).toBe('pending');
    expect(job.retryCount).toBe(1);
    expect(job.error).toContain('500');

    // Move scheduledAt to the past so it can be dequeued
    await testDb.queue.update(job.id!, { scheduledAt: new Date(Date.now() - 1000) });

    // Retry 2: retryCount goes from 1 → 2
    await processNextJob(deps);
    job = (await testDb.queue.toArray())[0];
    expect(job.status).toBe('pending');
    expect(job.retryCount).toBe(2);
    await testDb.queue.update(job.id!, { scheduledAt: new Date(Date.now() - 1000) });

    // Retry 3: retryCount goes from 2 → 3
    await processNextJob(deps);
    job = (await testDb.queue.toArray())[0];
    expect(job.status).toBe('pending');
    expect(job.retryCount).toBe(3);
    await testDb.queue.update(job.id!, { scheduledAt: new Date(Date.now() - 1000) });

    // Retry 4: maxRetries (3) exceeded → terminal failure
    await processNextJob(deps);
    job = (await testDb.queue.toArray())[0];
    expect(job.status).toBe('failed');
    expect(job.error).toContain('500');

    // Verify SCAN_ERROR messages were sent
    const errorMessages = sendMessage.mock.calls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === 'SCAN_ERROR'
    );
    expect(errorMessages.length).toBe(4); // 3 retries + 1 terminal

    // Last error message should have retriesLeft = 0
    const lastError = errorMessages[errorMessages.length - 1][0] as {
      type: string;
      retriesLeft: number;
    };
    expect(lastError.retriesLeft).toBe(0);
  });

  it('network error (TypeError) is retriable', async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();
    await testDb.enqueueJobs([{
      type: 'listing_scan',
      payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      status: 'pending',
      priority: 10,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null,
      completedAt: null,
      error: null,
    }]);

    const fetchPage = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    const job = (await testDb.queue.toArray())[0];
    expect(job.status).toBe('pending');
    expect(job.retryCount).toBe(1);
    expect(job.error).toContain('fetch');
  });
});

// ===========================================================================
// 1.10.5 Extension removal
// ===========================================================================

describe('1.10.5 Extension removal', () => {
  it('404 response marks extension as removed, job completes, data preserved', async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    // First do a successful scan to create some data
    await testDb.enqueueJobs([{
      type: 'listing_scan',
      payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      status: 'pending',
      priority: 10,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null,
      completedAt: null,
      error: null,
    }]);

    const fetchPage = vi.fn()
      .mockResolvedValueOnce(new Response('ext-aaa', { status: 200 })) // First scan succeeds
      .mockResolvedValueOnce(new Response('', { status: 404, statusText: 'Not Found' })); // Second scan 404

    const deps = createProcessorDeps({ fetchPage });

    // First scan - success
    await processNextJob(deps);

    const snapshotsBefore = await testDb.listing_snapshots.toArray();
    expect(snapshotsBefore).toHaveLength(1);

    let ext = await testDb.getExtension('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(ext!.status).toBe('active');

    // Now enqueue second scan that will get 404
    await testDb.enqueueJobs([{
      type: 'listing_scan',
      payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      status: 'pending',
      priority: 10,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null,
      completedAt: null,
      error: null,
    }]);

    // Second scan - 404
    await processNextJob(deps);

    // Extension marked as 'removed'
    ext = await testDb.getExtension('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(ext!.status).toBe('removed');

    // Job completed (not failed)
    const stats = await testDb.getQueueStats();
    expect(stats.completed).toBe(2);
    expect(stats.failed).toBe(0);

    // Data preserved - snapshot from first scan still exists
    const snapshotsAfter = await testDb.listing_snapshots.toArray();
    expect(snapshotsAfter).toHaveLength(1);
    expect(snapshotsAfter[0].title).toBe('Test Extension');
  });
});

// ===========================================================================
// 1.10.6 Data retention
// ===========================================================================

describe('1.10.6 Data retention', () => {
  it('pruning deletes old snapshots, preserves recent ones', async () => {
    await seedSingleProject();

    const extId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    // Insert old snapshots (400 days ago)
    const oldSnapshot: ListingSnapshot = {
      extensionId: extId,
      date: '2025-01-01',
      title: 'Old Title',
      shortDescription: 'Old desc',
      fullDescription: 'Old full desc',
      rating: 4.0,
      ratingCount: 80,
      reviewCount: 80,
      userCount: '8,000+',
      userCountNumeric: 8000,
      version: '0.9.0',
      lastUpdated: '2024-12-31',
      size: '1.0MiB',
      permissions: ['storage'],
      hostPermissions: [],
      permissionRiskScore: 0,
      badgeFlags: {},
      screenshotCount: 2,
      hasPromoVideo: false,
      translationCount: 3,
      availableLocales: ['en', 'es', 'fr'],
      category: 'productivity',
      developerName: 'Test Dev',
      developerVerified: false,
      listingQualityScore: null,
      scannedAt: new Date('2025-01-01'),
    };
    await testDb.saveListingSnapshot(oldSnapshot);

    // Insert recent snapshot (today) - must not spread oldSnapshot's auto-generated id
    const recentSnapshot: ListingSnapshot = {
      extensionId: extId,
      date: '2026-02-05',
      title: 'Recent Title',
      shortDescription: 'Old desc',
      fullDescription: 'Old full desc',
      rating: 4.0,
      ratingCount: 80,
      reviewCount: 80,
      userCount: '8,000+',
      userCountNumeric: 8000,
      version: '0.9.0',
      lastUpdated: '2024-12-31',
      size: '1.0MiB',
      permissions: ['storage'],
      hostPermissions: [],
      permissionRiskScore: 0,
      badgeFlags: {},
      screenshotCount: 2,
      hasPromoVideo: false,
      translationCount: 3,
      availableLocales: ['en', 'es', 'fr'],
      category: 'productivity',
      developerName: 'Test Dev',
      developerVerified: false,
      listingQualityScore: null,
      scannedAt: new Date(),
    };
    await testDb.saveListingSnapshot(recentSnapshot);

    // Insert old rank snapshot
    await testDb.saveRankSnapshots([{
      keywordId: 1,
      extensionId: extId,
      date: '2025-01-01',
      position: 5,
      totalResults: 100,
      scannedAt: new Date('2025-01-01'),
    }]);

    // Insert recent rank snapshot
    await testDb.saveRankSnapshots([{
      keywordId: 1,
      extensionId: extId,
      date: '2026-02-05',
      position: 3,
      totalResults: 120,
      scannedAt: new Date(),
    }]);

    // Verify counts before pruning
    expect(await testDb.listing_snapshots.count()).toBe(2);
    expect(await testDb.rank_snapshots.count()).toBe(2);

    // Prune data older than 2025-06-01
    await testDb.pruneOldSnapshots('2025-06-01');

    // Old snapshots deleted
    const remainingListings = await testDb.listing_snapshots.toArray();
    expect(remainingListings).toHaveLength(1);
    expect(remainingListings[0].title).toBe('Recent Title');

    const remainingRanks = await testDb.rank_snapshots.toArray();
    expect(remainingRanks).toHaveLength(1);
    expect(remainingRanks[0].date).toBe('2026-02-05');
  });

  it('cleanupOldJobs removes old completed/failed jobs', async () => {
    // Insert completed job from 10 days ago
    await testDb.enqueueJobs([{
      type: 'listing_scan',
      payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      status: 'completed',
      priority: 10,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      startedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      error: null,
    }]);

    // Insert failed job from 40 days ago
    await testDb.enqueueJobs([{
      type: 'listing_scan',
      payload: { extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      status: 'failed',
      priority: 10,
      retryCount: 3,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      startedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      error: 'HTTP 500',
    }]);

    // Insert recent completed job (1 day ago)
    await testDb.enqueueJobs([{
      type: 'listing_scan',
      payload: { extensionId: 'cccccccccccccccccccccccccccccccccc' },
      status: 'completed',
      priority: 10,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      startedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      error: null,
    }]);

    expect(await testDb.queue.count()).toBe(3);

    // Cleanup: completed > 7 days, failed > 30 days
    const completedBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const failedBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const removed = await testDb.cleanupOldJobs(completedBefore, failedBefore);

    expect(removed).toBe(2); // old completed + old failed
    expect(await testDb.queue.count()).toBe(1); // only recent completed remains
  });
});

// ===========================================================================
// 1.10.7 Multiple projects sharing a competitor
// ===========================================================================

describe('1.10.7 Multiple projects with shared competitor', () => {
  it('shared extension gets only 1 listing_scan job (deduplicated)', async () => {
    const { buildDailyScanJobs } = await import('@/background/queue-builder');
    const { processNextJob } = await import('@/background/queue-processor');

    // Create Project 1
    await testDb.saveProject({
      id: 1,
      name: 'Project A',
      ownExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      competitorIds: ['cccccccccccccccccccccccccccccccccc'], // shared competitor
      keywordIds: [1],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create Project 2
    await testDb.saveProject({
      id: 2,
      name: 'Project B',
      ownExtensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      competitorIds: ['cccccccccccccccccccccccccccccccccc'], // same shared competitor
      keywordIds: [2],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Extensions
    await testDb.saveExtension({
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'Own A', iconUrl: null, addedAt: new Date(),
      lastScannedAt: null, status: 'active', projectRefs: [1],
    });
    await testDb.saveExtension({
      id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      name: 'Own B', iconUrl: null, addedAt: new Date(),
      lastScannedAt: null, status: 'active', projectRefs: [2],
    });
    await testDb.saveExtension({
      id: 'cccccccccccccccccccccccccccccccccc',
      name: 'Shared Competitor', iconUrl: null, addedAt: new Date(),
      lastScannedAt: null, status: 'active', projectRefs: [1, 2],
    });

    // Keywords
    await testDb.saveKeyword({ id: 1, text: 'ad blocker', projectId: 1, createdAt: new Date() });
    await testDb.saveKeyword({ id: 2, text: 'privacy tool', projectId: 2, createdAt: new Date() });

    // Build jobs
    const allProjects = await testDb.getAllProjects();
    const allExtensions = await testDb.extensions.toArray();
    const allKeywords = await testDb.keywords.toArray();
    const jobs = buildDailyScanJobs(allProjects, allExtensions, allKeywords);

    // Verify deduplication: 3 listing_scans (not 4) + 2 keyword_scans
    const listingJobs = jobs.filter((j) => j.type === 'listing_scan');
    const keywordJobs = jobs.filter((j) => j.type === 'keyword_scan');

    expect(listingJobs).toHaveLength(3); // ext-aaa, ext-bbb, ext-ccc (only 1 for shared)
    expect(keywordJobs).toHaveLength(2);
    expect(jobs).toHaveLength(7); // 3 listings + 2 keywords + 2 autocomplete

    // Verify shared competitor has only one listing_scan
    const sharedCompetitorJobs = listingJobs.filter((j) => {
      const payload = j.payload as { extensionId: string };
      return payload.extensionId === 'cccccccccccccccccccccccccccccccccc';
    });
    expect(sharedCompetitorJobs).toHaveLength(1);

    // Enqueue and process all jobs
    await testDb.enqueueJobs(jobs);

    const fetchPage = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')) return new Response('ext-aaa', { status: 200 });
      if (url.includes('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')) return new Response('ext-bbb', { status: 200 });
      if (url.includes('cccccccccccccccccccccccccccccccccc')) return new Response('ext-ccc', { status: 200 });
      return new Response('search-results', { status: 200 });
    });
    const deps = createProcessorDeps({ fetchPage });

    for (let i = 0; i < 5; i++) {
      await processNextJob(deps);
    }

    // Verify only 1 listing snapshot for shared competitor
    const sharedSnapshots = await testDb.listing_snapshots
      .where('extensionId')
      .equals('cccccccccccccccccccccccccccccccccc')
      .toArray();
    expect(sharedSnapshots).toHaveLength(1);

    // All jobs completed
    const stats = await testDb.getQueueStats();
    expect(stats.completed).toBe(5);
    expect(stats.failed).toBe(0);
  });
});

// ===========================================================================
// 1.10.8 Manual refresh while scan running
// ===========================================================================

describe('1.10.8 Manual refresh while scan running', () => {
  it('clears pending jobs, enqueues new jobs', async () => {
    const { triggerManualRefresh } = await import('@/background/scheduler');

    await seedSingleProject();

    // Enqueue some initial jobs
    await testDb.enqueueJobs([
      {
        type: 'listing_scan',
        payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        status: 'pending',
        priority: 10,
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(Date.now() - 1000),
        startedAt: null,
        completedAt: null,
        error: null,
      },
      {
        type: 'listing_scan',
        payload: { extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
        status: 'pending',
        priority: 20,
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(Date.now() - 1000),
        startedAt: null,
        completedAt: null,
        error: null,
      },
      {
        type: 'keyword_scan',
        payload: { keywordId: 1, keyword: 'ad blocker' },
        status: 'pending',
        priority: 30,
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(Date.now() - 1000),
        startedAt: null,
        completedAt: null,
        error: null,
      },
    ]);

    const pendingBefore = await testDb.getPendingCount();
    expect(pendingBefore).toBe(3);

    // Trigger manual refresh
    await triggerManualRefresh(undefined, createSchedulerDeps());

    // Old pending jobs should be cleared, new jobs enqueued
    const pendingAfter = await testDb.getPendingCount();
    // Should have new jobs: 3 listing_scans + 1 keyword_scan + 1 autocomplete_scan = 5
    expect(pendingAfter).toBe(5);

    // Verify the queue has fresh jobs (retryCount = 0)
    const allJobs = await testDb.queue.where('status').equals('pending').toArray();
    for (const job of allJobs) {
      expect(job.retryCount).toBe(0);
    }
  });

  it('manual refresh for specific project only builds that project\'s jobs', async () => {
    const { triggerManualRefresh } = await import('@/background/scheduler');

    // Seed two projects
    await testDb.saveProject({
      id: 1,
      name: 'Project A',
      ownExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      competitorIds: [],
      keywordIds: [1],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await testDb.saveProject({
      id: 2,
      name: 'Project B',
      ownExtensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      competitorIds: [],
      keywordIds: [2],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await testDb.saveExtension({
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'Ext A', iconUrl: null, addedAt: new Date(),
      lastScannedAt: null, status: 'active', projectRefs: [1],
    });
    await testDb.saveExtension({
      id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      name: 'Ext B', iconUrl: null, addedAt: new Date(),
      lastScannedAt: null, status: 'active', projectRefs: [2],
    });
    await testDb.saveKeyword({ id: 1, text: 'keyword A', projectId: 1, createdAt: new Date() });
    await testDb.saveKeyword({ id: 2, text: 'keyword B', projectId: 2, createdAt: new Date() });

    // Refresh only project 1
    await triggerManualRefresh(1, createSchedulerDeps());

    const pendingJobs = await testDb.queue.where('status').equals('pending').toArray();
    // Should only have jobs for project 1: 1 listing_scan + 1 keyword_scan + 1 autocomplete_scan
    expect(pendingJobs).toHaveLength(3);

    const listingJobs = pendingJobs.filter((j) => j.type === 'listing_scan');
    const keywordJobs = pendingJobs.filter((j) => j.type === 'keyword_scan');

    expect(listingJobs).toHaveLength(1);
    expect((listingJobs[0].payload as { extensionId: string }).extensionId).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );

    expect(keywordJobs).toHaveLength(1);
    expect((keywordJobs[0].payload as { keywordId: number }).keywordId).toBe(1);
  });
});

// ===========================================================================
// Search pagination (keyword scan fetches multiple pages)
// ===========================================================================

describe('keyword_scan pagination', () => {
  it('fetches page 2 when competitors not found on page 1', { timeout: 15_000 }, async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    // Page 1: only ext-aaa at position 3 (ext-bbb and ext-ccc not found)
    // Page 2: ext-bbb at position 2 (overall position 12)
    let callCount = 0;
    mockSearchParse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Page 1: 10 results, only ext-aaa found
        return {
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
          ],
          totalCount: 120,
          nextPageToken: 'page2token',
        };
      }
      if (callCount === 2) {
        // Page 2: ext-bbb found at position 2 within page
        return {
          results: [
            {
              extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              name: 'Competitor 1',
              iconUrl: 'https://example.com/icon2.png',
              rating: 4.0,
              ratingCount: 50,
              shortDescription: 'A competitor',
              userCount: 5000,
              category: 'productivity',
              isFeatured: false,
              position: 2,
            },
          ],
          totalCount: 120,
          nextPageToken: 'page3token',
        };
      }
      // Page 3: ext-ccc found at position 5 within page
      return {
        results: [
          {
            extensionId: 'cccccccccccccccccccccccccccccccccc',
            name: 'Competitor 2',
            iconUrl: 'https://example.com/icon3.png',
            rating: 3.5,
            ratingCount: 20,
            shortDescription: 'Another competitor',
            userCount: 1000,
            category: 'productivity',
            isFeatured: false,
            position: 5,
          },
        ],
        totalCount: 120,
        nextPageToken: 'page4token',
      };
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending',
      priority: 30,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null,
      completedAt: null,
      error: null,
    }]);

    const fetchPage = vi.fn().mockImplementation(
      async () => new Response('search-results', { status: 200 })
    );
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    // Should have made 3 fetch calls (3 pages)
    expect(fetchPage).toHaveBeenCalledTimes(3);

    const rankSnapshots = await testDb.rank_snapshots.toArray();
    expect(rankSnapshots).toHaveLength(3);

    // ext-aaa: page 1, position 3 (offset 0 + 3 = 3)
    const snapA = rankSnapshots.find(
      (s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )!;
    expect(snapA.position).toBe(3);

    // ext-bbb: page 2, position 2 within page (offset 1 + 2 = 3)
    // offset = number of results from page 1 = 1
    const snapB = rankSnapshots.find(
      (s) => s.extensionId === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )!;
    expect(snapB.position).toBe(3); // 1 (page1 results) + 2

    // ext-ccc: page 3, position 5 within page (offset 1+1 + 5 = 7)
    const snapC = rankSnapshots.find(
      (s) => s.extensionId === 'cccccccccccccccccccccccccccccccccc'
    )!;
    expect(snapC.position).toBe(7); // 2 (page1+page2 results) + 5
  });

  it('stops pagination early when all tracked extensions found', async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    let callCount = 0;
    mockSearchParse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Page 1: all 3 extensions found
        return {
          results: [
            {
              extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              name: 'Test Extension',
              iconUrl: '',
              rating: 4.5,
              ratingCount: 100,
              shortDescription: '',
              userCount: 10000,
              category: 'productivity',
              isFeatured: false,
              position: 1,
            },
            {
              extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              name: 'Competitor 1',
              iconUrl: '',
              rating: 4.0,
              ratingCount: 50,
              shortDescription: '',
              userCount: 5000,
              category: 'productivity',
              isFeatured: false,
              position: 5,
            },
            {
              extensionId: 'cccccccccccccccccccccccccccccccccc',
              name: 'Competitor 2',
              iconUrl: '',
              rating: 3.5,
              ratingCount: 20,
              shortDescription: '',
              userCount: 1000,
              category: 'productivity',
              isFeatured: false,
              position: 8,
            },
          ],
          totalCount: 120,
          nextPageToken: 'page2token',
        };
      }
      throw new Error('Should not fetch page 2');
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending',
      priority: 30,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null,
      completedAt: null,
      error: null,
    }]);

    const fetchPage = vi.fn().mockImplementation(
      async () => new Response('search-results', { status: 200 })
    );
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    // Only 1 fetch call - stopped after page 1 since all extensions found
    expect(fetchPage).toHaveBeenCalledTimes(1);

    const rankSnapshots = await testDb.rank_snapshots.toArray();
    expect(rankSnapshots).toHaveLength(3);
    expect(rankSnapshots.every((s) => s.position !== null)).toBe(true);
  });

  it('stops pagination when no nextPageToken', async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    mockSearchParse.mockReturnValue({
      results: [
        {
          extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          name: 'Test Extension',
          iconUrl: '',
          rating: 4.5,
          ratingCount: 100,
          shortDescription: '',
          userCount: 10000,
          category: 'productivity',
          isFeatured: false,
          position: 1,
        },
      ],
      totalCount: 5,
      nextPageToken: null, // No more pages
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending',
      priority: 30,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null,
      completedAt: null,
      error: null,
    }]);

    const fetchPage = vi.fn().mockImplementation(
      async () => new Response('search-results', { status: 200 })
    );
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    // Only 1 fetch - no pagination since nextPageToken is null
    expect(fetchPage).toHaveBeenCalledTimes(1);

    const rankSnapshots = await testDb.rank_snapshots.toArray();
    expect(rankSnapshots).toHaveLength(3);

    // ext-aaa found at position 1
    const snapA = rankSnapshots.find(
      (s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )!;
    expect(snapA.position).toBe(1);

    // ext-bbb and ext-ccc not found -> null
    const snapB = rankSnapshots.find(
      (s) => s.extensionId === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )!;
    expect(snapB.position).toBeNull();
  });

  it('does not exceed MAX_SEARCH_PAGES (3 pages)', { timeout: 15_000 }, async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    // Always return results with a nextPageToken but never include ext-ccc
    let callCount = 0;
    mockSearchParse.mockImplementation(() => {
      callCount++;
      return {
        results: [
          {
            extensionId: `filler${callCount}aaaaaaaaaaaaaaaaaaaaaaaaa`.slice(0, 32),
            name: `Filler ${callCount}`,
            iconUrl: '',
            rating: 3.0,
            ratingCount: 10,
            shortDescription: '',
            userCount: 100,
            category: 'productivity',
            isFeatured: false,
            position: 1,
          },
        ],
        totalCount: 500,
        nextPageToken: `page${callCount + 1}token`,
      };
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending',
      priority: 30,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null,
      completedAt: null,
      error: null,
    }]);

    const fetchPage = vi.fn().mockImplementation(
      async () => new Response('search-results', { status: 200 })
    );
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    // Should stop at 3 pages (MAX_SEARCH_PAGES) even though there are more
    expect(fetchPage).toHaveBeenCalledTimes(3);

    const rankSnapshots = await testDb.rank_snapshots.toArray();
    expect(rankSnapshots).toHaveLength(3);

    // All tracked extensions should have position: null since none were found
    for (const snap of rankSnapshots) {
      expect(snap.position).toBeNull();
    }
  });

  it('correctly offsets positions across pages with varying result counts', async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    let callCount = 0;
    mockSearchParse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Page 1: 10 results, ext-aaa at position 3
        return {
          results: Array.from({ length: 10 }, (_, i) => ({
            extensionId: i === 2
              ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
              : `fill${String(i).padStart(28, 'a')}`.slice(0, 32),
            name: i === 2 ? 'Test Extension' : `Filler ${i}`,
            iconUrl: '',
            rating: 4.0,
            ratingCount: 50,
            shortDescription: '',
            userCount: 5000,
            category: 'productivity',
            isFeatured: false,
            position: i + 1,
          })),
          totalCount: 200,
          nextPageToken: 'page2token',
        };
      }
      // Page 2: 10 results, ext-bbb at position 7
      return {
        results: Array.from({ length: 10 }, (_, i) => ({
          extensionId: i === 6
            ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
            : `xill${String(i).padStart(28, 'b')}`.slice(0, 32),
          name: i === 6 ? 'Competitor 1' : `Filler Page2 ${i}`,
          iconUrl: '',
          rating: 4.0,
          ratingCount: 50,
          shortDescription: '',
          userCount: 5000,
          category: 'productivity',
          isFeatured: false,
          position: i + 1,
        })),
        totalCount: 200,
        nextPageToken: null, // no more pages
      };
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending',
      priority: 30,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null,
      completedAt: null,
      error: null,
    }]);

    const fetchPage = vi.fn().mockImplementation(
      async () => new Response('search-results', { status: 200 })
    );
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    expect(fetchPage).toHaveBeenCalledTimes(2);

    const rankSnapshots = await testDb.rank_snapshots.toArray();

    // ext-aaa: page 1, position 3 (offset 0 + 3 = 3)
    const snapA = rankSnapshots.find(
      (s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )!;
    expect(snapA.position).toBe(3);

    // ext-bbb: page 2, position 7 within page (offset 10 + 7 = 17)
    const snapB = rankSnapshots.find(
      (s) => s.extensionId === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )!;
    expect(snapB.position).toBe(17);

    // ext-ccc: not found on either page -> null
    const snapC = rankSnapshots.find(
      (s) => s.extensionId === 'cccccccccccccccccccccccccccccccccc'
    )!;
    expect(snapC.position).toBeNull();
  });

  it('passes pagination token in fetch URLs', { timeout: 15_000 }, async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    let callCount = 0;
    mockSearchParse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          results: [{
            extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            name: 'Test', iconUrl: '', rating: 4.5, ratingCount: 100,
            shortDescription: '', userCount: 10000,
            category: 'productivity', isFeatured: false, position: 1,
          }],
          totalCount: 120,
          nextPageToken: 'TOKEN_FOR_PAGE_2',
        };
      }
      // Page 2: all found so pagination stops
      return {
        results: [
          {
            extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            name: 'Comp1', iconUrl: '', rating: 4.0, ratingCount: 50,
            shortDescription: '', userCount: 5000,
            category: 'productivity', isFeatured: false, position: 3,
          },
          {
            extensionId: 'cccccccccccccccccccccccccccccccccc',
            name: 'Comp2', iconUrl: '', rating: 3.5, ratingCount: 20,
            shortDescription: '', userCount: 1000,
            category: 'productivity', isFeatured: false, position: 7,
          },
        ],
        totalCount: 120,
        nextPageToken: null,
      };
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending', priority: 30, retryCount: 0, maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null, completedAt: null, error: null,
    }]);

    const fetchPage = vi.fn().mockImplementation(
      async () => new Response('search-results', { status: 200 })
    );
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    expect(fetchPage).toHaveBeenCalledTimes(2);

    // Page 1 URL should NOT contain token
    const url1 = fetchPage.mock.calls[0][0] as string;
    expect(url1).toContain('ad%20blocker');
    expect(url1).not.toContain('token');

    // Page 2 URL SHOULD contain the token from page 1
    const url2 = fetchPage.mock.calls[1][0] as string;
    expect(url2).toContain('ad%20blocker');
    expect(url2).toContain('TOKEN_FOR_PAGE_2');
  });

  it('saves partial results when page 2 returns HTTP error', { timeout: 15_000 }, async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    let callCount = 0;
    mockSearchParse.mockImplementation(() => {
      callCount++;
      // Only page 1 succeeds - page 2 will get HTTP 500
      return {
        results: [{
          extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          name: 'Test', iconUrl: '', rating: 4.5, ratingCount: 100,
          shortDescription: '', userCount: 10000,
          category: 'productivity', isFeatured: false, position: 3,
        }],
        totalCount: 120,
        nextPageToken: 'page2token',
      };
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending', priority: 30, retryCount: 0, maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null, completedAt: null, error: null,
    }]);

    // Page 1 succeeds, page 2 returns HTTP 500
    let fetchCallCount = 0;
    const fetchPage = vi.fn().mockImplementation(async () => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return new Response('search-page-1', { status: 200 });
      }
      return new Response('', { status: 500, statusText: 'Internal Server Error' });
    });
    const deps = createProcessorDeps({ fetchPage });

    const result = await processNextJob(deps);

    // Job should complete (not fail) since page 1 data was saved
    const jobs = await testDb.queue.toArray();
    expect(jobs[0].status).toBe('completed');

    // Rank snapshots should be saved with page 1 data
    const rankSnapshots = await testDb.rank_snapshots.toArray();
    expect(rankSnapshots).toHaveLength(3);

    // ext-aaa found on page 1
    const snapA = rankSnapshots.find(
      (s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )!;
    expect(snapA.position).toBe(3);

    // ext-bbb and ext-ccc not found (page 2 failed) -> null
    const snapB = rankSnapshots.find(
      (s) => s.extensionId === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )!;
    expect(snapB.position).toBeNull();
  });

  it('saves partial results when page 2 has parser error', { timeout: 15_000 }, async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    let callCount = 0;
    mockSearchParse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          results: [{
            extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            name: 'Test', iconUrl: '', rating: 4.5, ratingCount: 100,
            shortDescription: '', userCount: 10000,
            category: 'productivity', isFeatured: false, position: 1,
          }],
          totalCount: 80,
          nextPageToken: 'page2token',
        };
      }
      // Page 2 parser fails
      throw new Error('ds:1 callback not found in search results');
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending', priority: 30, retryCount: 0, maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null, completedAt: null, error: null,
    }]);

    const fetchPage = vi.fn().mockImplementation(
      async () => new Response('search-results', { status: 200 })
    );
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    // Job should complete (not retry) since page 1 data was saved
    const jobs = await testDb.queue.toArray();
    expect(jobs[0].status).toBe('completed');

    // Rank snapshots saved with page 1 partial data
    const rankSnapshots = await testDb.rank_snapshots.toArray();
    expect(rankSnapshots).toHaveLength(3);

    const snapA = rankSnapshots.find(
      (s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )!;
    expect(snapA.position).toBe(1);
    expect(snapA.totalResults).toBe(80);
  });

  it('propagates errors when page 1 fails (no partial data)', async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    mockSearchParse.mockImplementation(() => {
      throw new Error('Parse failed on page 1');
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending', priority: 30, retryCount: 0, maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null, completedAt: null, error: null,
    }]);

    const fetchPage = vi.fn().mockImplementation(
      async () => new Response('bad-html', { status: 200 })
    );
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    // Job should be retried (not completed) since page 1 failed
    const jobs = await testDb.queue.toArray();
    expect(jobs[0].status).toBe('pending');
    expect(jobs[0].retryCount).toBe(1);
    expect(jobs[0].error).toContain('Parse failed');

    // No rank snapshots saved
    const rankSnapshots = await testDb.rank_snapshots.toArray();
    expect(rankSnapshots).toHaveLength(0);
  });

  it('saves partial results when page 2 has network error', { timeout: 15_000 }, async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    let callCount = 0;
    mockSearchParse.mockImplementation(() => {
      callCount++;
      return {
        results: [{
          extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          name: 'Test', iconUrl: '', rating: 4.5, ratingCount: 100,
          shortDescription: '', userCount: 10000,
          category: 'productivity', isFeatured: false, position: 5,
        }],
        totalCount: 200,
        nextPageToken: 'page2token',
      };
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending', priority: 30, retryCount: 0, maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null, completedAt: null, error: null,
    }]);

    // Page 1 succeeds, page 2 throws network error
    let fetchCallCount = 0;
    const fetchPage = vi.fn().mockImplementation(async () => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return new Response('search-page-1', { status: 200 });
      }
      throw new TypeError('Failed to fetch');
    });
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    // Job completes (partial page 1 data saved)
    const jobs = await testDb.queue.toArray();
    expect(jobs[0].status).toBe('completed');

    const rankSnapshots = await testDb.rank_snapshots.toArray();
    expect(rankSnapshots).toHaveLength(3);

    const snapA = rankSnapshots.find(
      (s) => s.extensionId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )!;
    expect(snapA.position).toBe(5);
    expect(snapA.totalResults).toBe(200);
  });

  it('captures totalResults from page 1 only', { timeout: 15_000 }, async () => {
    const { processNextJob } = await import('@/background/queue-processor');

    await seedSingleProject();

    let callCount = 0;
    mockSearchParse.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          results: [{
            extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            name: 'Test', iconUrl: '', rating: 4.5, ratingCount: 100,
            shortDescription: '', userCount: 10000,
            category: 'productivity', isFeatured: false, position: 1,
          }],
          totalCount: 342, // Page 1 totalCount
          nextPageToken: 'page2token',
        };
      }
      // Page 2 returns different totalCount (CWS can do this)
      return {
        results: [
          {
            extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            name: 'Comp1', iconUrl: '', rating: 4.0, ratingCount: 50,
            shortDescription: '', userCount: 5000,
            category: 'productivity', isFeatured: false, position: 3,
          },
          {
            extensionId: 'cccccccccccccccccccccccccccccccccc',
            name: 'Comp2', iconUrl: '', rating: 3.5, ratingCount: 20,
            shortDescription: '', userCount: 1000,
            category: 'productivity', isFeatured: false, position: 7,
          },
        ],
        totalCount: 999, // Different totalCount on page 2
        nextPageToken: null,
      };
    });

    await testDb.enqueueJobs([{
      type: 'keyword_scan',
      payload: { keywordId: 1, keyword: 'ad blocker' },
      status: 'pending', priority: 30, retryCount: 0, maxRetries: 3,
      scheduledAt: new Date(Date.now() - 1000),
      startedAt: null, completedAt: null, error: null,
    }]);

    const fetchPage = vi.fn().mockImplementation(
      async () => new Response('search-results', { status: 200 })
    );
    const deps = createProcessorDeps({ fetchPage });

    await processNextJob(deps);

    const rankSnapshots = await testDb.rank_snapshots.toArray();

    // All snapshots should have totalResults from page 1 (342), not page 2 (999)
    for (const snap of rankSnapshots) {
      expect(snap.totalResults).toBe(342);
    }
  });
});
