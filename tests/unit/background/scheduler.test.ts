/**
 * Tests for Scheduler (Phase 1.6.4).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CWSDatabase } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import '../../mocks/chrome';
import { resetChromeMock, getCalls, chromeMock } from '../../mocks/chrome';
import { today } from '@/shared/utils/dates';

// Mock parsers (needed by queue-processor → imported via scheduler)
vi.mock('@/background/parsers/index', () => {
  class MockParserError extends Error {
    constructor(
      message: string,
      public readonly parserVersion: string,
      public readonly field?: string,
    ) {
      super(`[Parser ${parserVersion}] ${message}`);
      this.name = 'ParserError';
    }
  }

  return {
    getListingParser: () => ({
      version: 'v1',
      parse: () => ({
        extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Test Extension',
        shortDescription: 'A test',
        fullDescription: 'Full',
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
        availableLocales: ['en'],
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
      }),
    }),
    getSearchParser: () => ({
      version: 'v1',
      parse: () => ({
        results: [],
        totalCount: 0,
        nextPageToken: null,
      }),
    }),
    ParserError: MockParserError,
  };
});

// Mock db module
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

import type { SchedulerDeps } from '@/background/scheduler';
import type { ProcessorDeps } from '@/background/queue-processor';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let testDb: CWSDatabase;
let settingsManager: SettingsManager;

function createSchedulerDeps(overrides?: Partial<SchedulerDeps>): SchedulerDeps {
  const processorDeps: ProcessorDeps = {
    fetchPage: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })),
    sendMessage: vi.fn(),
    settings: settingsManager,
  };
  return {
    settings: settingsManager,
    processorDeps,
    ...overrides,
  };
}

async function seedProject(): Promise<void> {
  await testDb.saveProject({
    id: 1,
    name: 'Test Project',
    ownExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    competitorIds: [],
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

describe('Scheduler', () => {
  beforeEach(async () => {
    resetChromeMock();

    const name = 'test-scheduler-' + Date.now() + '-' + Math.random();
    testDb = new CWSDatabase(name);
    await testDb.open();

    const dbMod = await import('@/shared/db/database');
    (dbMod as unknown as { _setTestDb: (db: CWSDatabase) => void })._setTestDb(testDb);

    settingsManager = new SettingsManager();
  });

  describe('setupAlarms', () => {
    it('creates dailyScan alarm with delayInMinutes: 1 and periodInMinutes: 1440', async () => {
      const { setupAlarms, ALARM_DAILY_SCAN } = await import('@/background/scheduler');

      setupAlarms();

      const alarmCalls = getCalls('alarms.create');
      expect(alarmCalls).toHaveLength(1);
      expect(alarmCalls[0].args[0]).toBe(ALARM_DAILY_SCAN);
      expect(alarmCalls[0].args[1]).toEqual({
        delayInMinutes: 1,
        periodInMinutes: 1440,
      });
    });
  });

  describe('handleDailyScanAlarm', () => {
    it('skips if dailyScanEnabled is false', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      // Default: dailyScanEnabled = false
      const deps = createSchedulerDeps();

      await handleDailyScanAlarm(deps);

      // No jobs should be created
      const queueCount = await testDb.queue.count();
      expect(queueCount).toBe(0);
    });

    it('skips if lastDailyScanDate is today', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('lastDailyScanDate', today());

      const deps = createSchedulerDeps();
      await handleDailyScanAlarm(deps);

      const queueCount = await testDb.queue.count();
      expect(queueCount).toBe(0);
    });

    it('builds and enqueues jobs when conditions met', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);
      // lastDailyScanDate not set or is yesterday → proceed

      const deps = createSchedulerDeps();
      await handleDailyScanAlarm(deps);

      // Should have created 3 jobs: 1 listing_scan + 1 keyword_scan + 1 autocomplete_scan
      const queueCount = await testDb.queue.count();
      expect(queueCount).toBe(3);

      // Should have created processQueue alarm
      const alarmCalls = getCalls('alarms.create');
      const processQueueAlarm = alarmCalls.find(
        (c) => c.args[0] === 'processQueue'
      );
      expect(processQueueAlarm).toBeDefined();
    });

    it('no projects → no jobs, sets lastDailyScanDate', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await settingsManager.set('dailyScanEnabled', true);

      const deps = createSchedulerDeps();
      await handleDailyScanAlarm(deps);

      const queueCount = await testDb.queue.count();
      expect(queueCount).toBe(0);

      // Should have set lastDailyScanDate to today
      const lastScan = await settingsManager.get('lastDailyScanDate');
      expect(lastScan).toBe(today());
    });
  });

  describe('handleProcessQueueAlarm', () => {
    it('resets running jobs before processing', async () => {
      const { handleProcessQueueAlarm } = await import('@/background/scheduler');

      await seedProject();

      // Add a job with status='running' (simulates SW crash mid-execution)
      await testDb.enqueueJobs([{
        type: 'listing_scan',
        payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        status: 'running',
        priority: 10,
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(Date.now() - 1000),
        startedAt: new Date(),
        completedAt: null,
        error: null,
      }]);

      const deps = createSchedulerDeps();
      await handleProcessQueueAlarm(deps);

      // The running job should have been reset to pending and then processed
      const jobs = await testDb.queue.toArray();
      expect(jobs.length).toBe(1);
      // It was processed (reset → dequeued → processed)
      expect(jobs[0].status).toBe('completed');
    });

    it('schedules next alarm after successful job with more pending', async () => {
      const { handleProcessQueueAlarm } = await import('@/background/scheduler');

      await seedProject();

      // Add 2 jobs
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

      const deps = createSchedulerDeps();
      await handleProcessQueueAlarm(deps);

      // Should have scheduled next processQueue alarm
      const alarmCalls = getCalls('alarms.create');
      const processQueueAlarms = alarmCalls.filter(
        (c) => c.args[0] === 'processQueue'
      );
      expect(processQueueAlarms.length).toBeGreaterThanOrEqual(1);
    });

    it('updates lastDailyScanDate when no more jobs', async () => {
      const { handleProcessQueueAlarm } = await import('@/background/scheduler');

      await seedProject();

      // Add single job
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

      const deps = createSchedulerDeps();
      await handleProcessQueueAlarm(deps);

      // Should have updated lastDailyScanDate
      const lastScan = await settingsManager.get('lastDailyScanDate');
      expect(lastScan).toBe(today());
    });
  });

  describe('triggerManualRefresh', () => {
    it('clears existing pending jobs before enqueueing new ones', async () => {
      const { triggerManualRefresh } = await import('@/background/scheduler');

      await seedProject();

      // Add some existing pending jobs
      await testDb.enqueueJobs([
        {
          type: 'listing_scan',
          payload: { extensionId: 'old-job-ext' },
          status: 'pending',
          priority: 10,
          retryCount: 0,
          maxRetries: 3,
          scheduledAt: new Date(),
          startedAt: null,
          completedAt: null,
          error: null,
        },
      ]);

      const deps = createSchedulerDeps();
      await triggerManualRefresh(undefined, deps);

      // Old pending job should be gone, new ones created
      const jobs = await testDb.queue.toArray();
      const pendingJobs = jobs.filter((j) => j.status === 'pending');

      // Should have 3 new jobs (1 listing + 1 keyword + 1 autocomplete)
      expect(pendingJobs).toHaveLength(3);

      // None should be the old job
      const oldJob = pendingJobs.find(
        (j) => (j.payload as { extensionId?: string }).extensionId === 'old-job-ext'
      );
      expect(oldJob).toBeUndefined();
    });

    it('sends initial progress message with nextProcessingAt', async () => {
      const { triggerManualRefresh } = await import('@/background/scheduler');

      await seedProject();

      const deps = createSchedulerDeps();
      const beforeTime = Date.now();
      await triggerManualRefresh(undefined, deps);

      // chrome.runtime.sendMessage should have been called with nextProcessingAt
      const sendCalls = getCalls('runtime.sendMessage');
      const progressMsg = sendCalls.find(
        (c) => (c.args[0] as { type: string }).type === 'SCAN_PROGRESS'
      );
      expect(progressMsg).toBeDefined();
      const msg = progressMsg!.args[0] as { nextProcessingAt?: string; completed: number };
      expect(msg.completed).toBe(0);
      expect(msg.nextProcessingAt).toBeDefined();
      // Timestamp should be ~1 minute in the future
      const nextTime = new Date(msg.nextProcessingAt!).getTime();
      expect(nextTime).toBeGreaterThanOrEqual(beforeTime + 55_000);
      expect(nextTime).toBeLessThanOrEqual(beforeTime + 65_000);
    });

    it('starts processing immediately by creating processQueue alarm', async () => {
      const { triggerManualRefresh } = await import('@/background/scheduler');

      await seedProject();

      const deps = createSchedulerDeps();
      await triggerManualRefresh(undefined, deps);

      const alarmCalls = getCalls('alarms.create');
      const processQueueAlarm = alarmCalls.find(
        (c) => c.args[0] === 'processQueue'
      );
      expect(processQueueAlarm).toBeDefined();
    });
  });

  describe('pauseScanning / resumeScanning', () => {
    it('pauseScanning sets dailyScanEnabled to false', async () => {
      const { pauseScanning } = await import('@/background/scheduler');

      await settingsManager.set('dailyScanEnabled', true);

      const deps = createSchedulerDeps();
      await pauseScanning(deps);

      const enabled = await settingsManager.get('dailyScanEnabled');
      expect(enabled).toBe(false);
    });

    it('resumeScanning sets dailyScanEnabled to true', async () => {
      const { resumeScanning } = await import('@/background/scheduler');

      const deps = createSchedulerDeps();
      await resumeScanning(deps);

      const enabled = await settingsManager.get('dailyScanEnabled');
      expect(enabled).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('alarm fires but DB has no projects → scan completes immediately', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await settingsManager.set('dailyScanEnabled', true);

      const deps = createSchedulerDeps();
      await handleDailyScanAlarm(deps);

      // No jobs created
      const queueCount = await testDb.queue.count();
      expect(queueCount).toBe(0);

      // lastDailyScanDate should be set
      const lastScan = await settingsManager.get('lastDailyScanDate');
      expect(lastScan).toBe(today());
    });
  });
});
