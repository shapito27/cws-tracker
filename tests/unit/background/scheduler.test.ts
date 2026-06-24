/**
 * Tests for Scheduler (Phase 1.6.4).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CWSDatabase } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import '../../mocks/chrome';
import { resetChromeMock, getCalls, chromeMock } from '../../mocks/chrome';
import { today, toDateString } from '@/shared/utils/dates';

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
    getAutocompleteParser: () => ({
      version: 'v1',
      parse: () => ({
        suggestions: [],
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
    // A proxy is configured in beforeEach, so the processor uses the proxy
    // transport, which expects a JSON `{ html, status }` body (parser is mocked,
    // so the HTML content is irrelevant).
    fetchPage: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ html: '<html></html>', status: 200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ),
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

    // Scans require a configured proxy. Set one by default so the existing
    // scan-trigger tests exercise the happy path; guard tests clear it.
    await settingsManager.set('proxyUrl', 'https://proxy.test');
  });

  describe('setupAlarms', () => {
    it('arms a one-shot dailyScan alarm at the configured time when auto-scan is enabled', async () => {
      const { setupAlarms, ALARM_DAILY_SCAN } = await import('@/background/scheduler');

      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '11:00');

      await setupAlarms(createSchedulerDeps());

      const alarmCalls = getCalls('alarms.create').filter(
        (c) => c.args[0] === ALARM_DAILY_SCAN
      );
      expect(alarmCalls).toHaveLength(1);
      const info = alarmCalls[0].args[1] as { when?: number; periodInMinutes?: number };
      // One-shot (absolute `when`), NOT a fixed 24h period anchored to install time.
      expect(info.when).toBeTypeOf('number');
      expect(info.periodInMinutes).toBeUndefined();
      // Fires at 11:00 (today or tomorrow).
      const scheduled = new Date(info.when!);
      expect(scheduled.getHours()).toBe(11);
      expect(scheduled.getMinutes()).toBe(0);
    });

    it('clears the dailyScan alarm when auto-scan is disabled', async () => {
      const { setupAlarms, ALARM_DAILY_SCAN } = await import('@/background/scheduler');

      // Default dailyScanEnabled = false
      await setupAlarms(createSchedulerDeps());

      const created = getCalls('alarms.create').filter((c) => c.args[0] === ALARM_DAILY_SCAN);
      expect(created).toHaveLength(0);
      const cleared = getCalls('alarms.clear').filter((c) => c.args[0] === ALARM_DAILY_SCAN);
      expect(cleared.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('nextDailyScanTimestamp', () => {
    it('returns today at the scan time when it is still in the future', async () => {
      const { nextDailyScanTimestamp } = await import('@/background/scheduler');
      const now = new Date(2026, 5, 24, 9, 0, 0); // Jun 24 2026, 09:00 local
      expect(nextDailyScanTimestamp('11:00', now)).toBe(
        new Date(2026, 5, 24, 11, 0, 0, 0).getTime()
      );
    });

    it('rolls over to tomorrow when the scan time already passed today', async () => {
      const { nextDailyScanTimestamp } = await import('@/background/scheduler');
      const now = new Date(2026, 5, 24, 13, 0, 0); // 13:00, past 11:00
      expect(nextDailyScanTimestamp('11:00', now)).toBe(
        new Date(2026, 5, 25, 11, 0, 0, 0).getTime()
      );
    });

    it('rolls over to tomorrow when the scan time is exactly now', async () => {
      const { nextDailyScanTimestamp } = await import('@/background/scheduler');
      const now = new Date(2026, 5, 24, 11, 0, 0);
      expect(nextDailyScanTimestamp('11:00', now)).toBe(
        new Date(2026, 5, 25, 11, 0, 0, 0).getTime()
      );
    });
  });

  describe('scheduleNextDailyScan', () => {
    it('arms the dailyScan alarm at the next occurrence when enabled', async () => {
      const { scheduleNextDailyScan, ALARM_DAILY_SCAN } = await import('@/background/scheduler');

      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '08:30');
      const now = new Date(2026, 5, 24, 9, 0, 0); // past 08:30 → tomorrow

      await scheduleNextDailyScan(createSchedulerDeps(), now);

      const calls = getCalls('alarms.create').filter((c) => c.args[0] === ALARM_DAILY_SCAN);
      expect(calls).toHaveLength(1);
      expect((calls[0].args[1] as { when?: number }).when).toBe(
        new Date(2026, 5, 25, 8, 30, 0, 0).getTime()
      );
    });

    it('clears the dailyScan alarm when disabled', async () => {
      const { scheduleNextDailyScan, ALARM_DAILY_SCAN } = await import('@/background/scheduler');

      await scheduleNextDailyScan(createSchedulerDeps()); // default disabled

      expect(getCalls('alarms.create').filter((c) => c.args[0] === ALARM_DAILY_SCAN)).toHaveLength(0);
      expect(
        getCalls('alarms.clear').filter((c) => c.args[0] === ALARM_DAILY_SCAN).length
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isDailyScanDue (catch-up predicate)', () => {
    it('true when enabled, not scanned today, and the scan time has passed', async () => {
      const { isDailyScanDue } = await import('@/background/scheduler');
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '11:00');
      const now = new Date(2026, 5, 24, 13, 0, 0);
      expect(await isDailyScanDue(createSchedulerDeps(), now)).toBe(true);
    });

    it('false before the scan time even if not scanned today', async () => {
      const { isDailyScanDue } = await import('@/background/scheduler');
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '11:00');
      const now = new Date(2026, 5, 24, 9, 0, 0);
      expect(await isDailyScanDue(createSchedulerDeps(), now)).toBe(false);
    });

    it('false when already scanned today', async () => {
      const { isDailyScanDue } = await import('@/background/scheduler');
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '11:00');
      const now = new Date(2026, 5, 24, 13, 0, 0);
      await settingsManager.set('lastDailyScanDate', toDateString(now));
      expect(await isDailyScanDue(createSchedulerDeps(), now)).toBe(false);
    });

    it('false when auto-scan is disabled', async () => {
      const { isDailyScanDue } = await import('@/background/scheduler');
      await settingsManager.set('dailyScanTime', '11:00'); // enabled stays false
      const now = new Date(2026, 5, 24, 13, 0, 0);
      expect(await isDailyScanDue(createSchedulerDeps(), now)).toBe(false);
    });
  });

  describe('handleBrowserStartup (catch-up)', () => {
    it('runs a missed scan when one is due', async () => {
      const { handleBrowserStartup } = await import('@/background/scheduler');
      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '11:00');
      const now = new Date(2026, 5, 24, 13, 0, 0); // past 11:00, not scanned today

      await handleBrowserStartup(createSchedulerDeps(), now);

      // The missed daily scan ran: 1 listing + 1 keyword + 1 autocomplete job.
      expect(await testDb.queue.count()).toBe(3);
    });

    it('does not scan before the scheduled time, but arms the alarm for today', async () => {
      const { handleBrowserStartup, ALARM_DAILY_SCAN } = await import('@/background/scheduler');
      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '11:00');
      const now = new Date(2026, 5, 24, 9, 0, 0); // before 11:00

      await handleBrowserStartup(createSchedulerDeps(), now);

      expect(await testDb.queue.count()).toBe(0);
      const armed = getCalls('alarms.create').filter((c) => c.args[0] === ALARM_DAILY_SCAN);
      expect(armed).toHaveLength(1);
      expect((armed[0].args[1] as { when?: number }).when).toBe(
        new Date(2026, 5, 24, 11, 0, 0, 0).getTime()
      );
    });
  });

  describe('handleSettingsChange', () => {
    it('re-arms the alarm when the scan time changes', async () => {
      const { handleSettingsChange, ALARM_DAILY_SCAN } = await import('@/background/scheduler');
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '14:00');

      await handleSettingsChange(
        { dailyScanTime: '11:00', dailyScanEnabled: true },
        { dailyScanTime: '14:00', dailyScanEnabled: true },
        createSchedulerDeps()
      );

      expect(
        getCalls('alarms.create').filter((c) => c.args[0] === ALARM_DAILY_SCAN).length
      ).toBeGreaterThanOrEqual(1);
    });

    it('clears the alarm when auto-scan is toggled off', async () => {
      const { handleSettingsChange, ALARM_DAILY_SCAN } = await import('@/background/scheduler');
      // Storage reflects the new (disabled) state — default dailyScanEnabled is false.

      await handleSettingsChange(
        { dailyScanEnabled: true },
        { dailyScanEnabled: false },
        createSchedulerDeps()
      );

      expect(
        getCalls('alarms.clear').filter((c) => c.args[0] === ALARM_DAILY_SCAN).length
      ).toBeGreaterThanOrEqual(1);
    });

    it('does nothing when no scheduling-relevant setting changed', async () => {
      const { handleSettingsChange, ALARM_DAILY_SCAN } = await import('@/background/scheduler');

      await handleSettingsChange(
        { dailyScanTime: '11:00', dailyScanEnabled: true, proxyUrl: 'https://a.test' },
        { dailyScanTime: '11:00', dailyScanEnabled: true, proxyUrl: 'https://b.test' },
        createSchedulerDeps()
      );

      expect(getCalls('alarms.create').filter((c) => c.args[0] === ALARM_DAILY_SCAN)).toHaveLength(0);
      expect(getCalls('alarms.clear').filter((c) => c.args[0] === ALARM_DAILY_SCAN)).toHaveLength(0);
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

    it('re-arms the next dailyScan alarm after running (one-shot does not repeat)', async () => {
      const { handleDailyScanAlarm, ALARM_DAILY_SCAN } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);

      const deps = createSchedulerDeps();
      await handleDailyScanAlarm(deps);

      const armed = getCalls('alarms.create').filter((c) => c.args[0] === ALARM_DAILY_SCAN);
      expect(armed.length).toBeGreaterThanOrEqual(1);
      expect((armed[armed.length - 1].args[1] as { when?: number }).when).toBeTypeOf('number');
    });

    it('does not enqueue a second set of jobs when a cycle is already in flight (startup double-fire)', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);

      const deps = createSchedulerDeps();
      // First trigger (e.g. onStartup catch-up) enqueues the day's jobs but does
      // NOT drain them, so lastDailyScanDate is not yet stamped.
      await handleDailyScanAlarm(deps);
      expect(await testDb.queue.count()).toBe(3);

      // Second trigger (the past-due dailyScan alarm firing on the same startup)
      // must NOT duplicate the day's jobs.
      await handleDailyScanAlarm(deps);
      expect(await testDb.queue.count()).toBe(3);
    });

    it('skips enqueuing when a scan cycle is already marked in progress today', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);
      // Simulate a cycle already underway today (e.g. a manual refresh, or the
      // first of two startup triggers).
      await settingsManager.set('scanCycleStartedAt', new Date().toISOString());

      const deps = createSchedulerDeps();
      await handleDailyScanAlarm(deps);

      expect(await testDb.queue.count()).toBe(0);
    });

    it('clears scanCycleStartedAt when there are no projects to scan', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await settingsManager.set('dailyScanEnabled', true);

      const deps = createSchedulerDeps();
      await handleDailyScanAlarm(deps);

      // No jobs → the cycle marker we stamped is cleared so it can't block a
      // later scan, and lastDailyScanDate is set.
      expect(await settingsManager.get('scanCycleStartedAt')).toBeNull();
      expect(await settingsManager.get('lastDailyScanDate')).toBe(today());
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
      await triggerManualRefresh(undefined, 'full', deps);

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
      await triggerManualRefresh(undefined, 'full', deps);

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
      await triggerManualRefresh(undefined, 'full', deps);

      const alarmCalls = getCalls('alarms.create');
      const processQueueAlarm = alarmCalls.find(
        (c) => c.args[0] === 'processQueue'
      );
      expect(processQueueAlarm).toBeDefined();
    });

    it('scanType="keywords" enqueues only keyword_scan jobs for the project', async () => {
      const { triggerManualRefresh } = await import('@/background/scheduler');

      await seedProject();

      const deps = createSchedulerDeps();
      await triggerManualRefresh(1, 'keywords', deps);

      const pendingJobs = await testDb.queue.where('status').equals('pending').toArray();
      expect(pendingJobs.length).toBeGreaterThan(0);
      expect(pendingJobs.every((j) => j.type === 'keyword_scan')).toBe(true);
    });

    it('scanType="autocomplete" enqueues only autocomplete_scan jobs for the project', async () => {
      const { triggerManualRefresh } = await import('@/background/scheduler');

      await seedProject();

      const deps = createSchedulerDeps();
      await triggerManualRefresh(1, 'autocomplete', deps);

      const pendingJobs = await testDb.queue.where('status').equals('pending').toArray();
      expect(pendingJobs.length).toBeGreaterThan(0);
      expect(pendingJobs.every((j) => j.type === 'autocomplete_scan')).toBe(true);
    });

    it('scanType filters keywords by projectId so other projects are not scanned', async () => {
      const { triggerManualRefresh } = await import('@/background/scheduler');

      // Seed project 1 with a keyword
      await seedProject();

      // Seed project 2 with its own keyword
      await testDb.saveProject({
        id: 2,
        name: 'Other Project',
        ownExtensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        competitorIds: [],
        keywordIds: [2],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await testDb.saveKeyword({
        id: 2,
        text: 'privacy tool',
        projectId: 2,
        createdAt: new Date(),
      });

      const deps = createSchedulerDeps();
      await triggerManualRefresh(1, 'keywords', deps);

      const pendingJobs = await testDb.queue.where('status').equals('pending').toArray();
      // Only keyword 1 (project 1) should be enqueued, not keyword 2
      expect(pendingJobs).toHaveLength(1);
      expect(pendingJobs[0].type).toBe('keyword_scan');
      expect((pendingJobs[0].payload as { keywordId: number }).keywordId).toBe(1);
    });
  });

  describe('triggerKeywordRescan', () => {
    it('enqueues exactly one keyword_scan job for the keyword and kicks the processor', async () => {
      const { triggerKeywordRescan } = await import('@/background/scheduler');
      await seedProject();

      await triggerKeywordRescan(1);

      const pendingJobs = await testDb.queue.where('status').equals('pending').toArray();
      expect(pendingJobs).toHaveLength(1);
      expect(pendingJobs[0].type).toBe('keyword_scan');
      expect((pendingJobs[0].payload as { keywordId: number }).keywordId).toBe(1);

      const processQueueAlarm = getCalls('alarms.create').find((c) => c.args[0] === 'processQueue');
      expect(processQueueAlarm).toBeDefined();

      // Immediate feedback so the button doesn't look dead during the alarm delay.
      const progressMsg = getCalls('runtime.sendMessage').find(
        (c) => (c.args[0] as { type: string }).type === 'SCAN_PROGRESS'
      );
      expect(progressMsg).toBeDefined();
      expect((progressMsg!.args[0] as { phase: string }).phase).toBe('queued');
    });

    it('does NOT clear existing pending jobs (non-destructive)', async () => {
      const { triggerKeywordRescan } = await import('@/background/scheduler');
      await seedProject();

      await testDb.enqueueJobs([
        {
          type: 'listing_scan',
          payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
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

      await triggerKeywordRescan(1);

      const pendingJobs = await testDb.queue.where('status').equals('pending').toArray();
      // Pre-existing listing job is preserved + the new keyword_scan job.
      expect(pendingJobs).toHaveLength(2);
      expect(pendingJobs.some((j) => j.type === 'listing_scan')).toBe(true);
      expect(pendingJobs.some((j) => j.type === 'keyword_scan')).toBe(true);
    });

    it('no-ops for an unknown keyword', async () => {
      const { triggerKeywordRescan } = await import('@/background/scheduler');
      await seedProject();

      await triggerKeywordRescan(999);

      const pendingJobs = await testDb.queue.where('status').equals('pending').toArray();
      expect(pendingJobs).toHaveLength(0);
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

  describe('proxy guard', () => {
    it('triggerManualRefresh enqueues nothing and broadcasts SCAN_ERROR when no proxy', async () => {
      const { triggerManualRefresh } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('proxyUrl', ''); // clear the default proxy

      const deps = createSchedulerDeps();
      await triggerManualRefresh(undefined, 'full', deps);

      // No jobs enqueued, no processing alarm scheduled.
      expect(await testDb.queue.count()).toBe(0);
      const processQueueAlarm = getCalls('alarms.create').find((c) => c.args[0] === 'processQueue');
      expect(processQueueAlarm).toBeUndefined();

      // A SCAN_ERROR is broadcast so the dashboard can explain why.
      const errorMsg = getCalls('runtime.sendMessage').find(
        (c) => (c.args[0] as { type: string }).type === 'SCAN_ERROR'
      );
      expect(errorMsg).toBeDefined();
      expect((errorMsg!.args[0] as { error: string }).error).toMatch(/proxy not configured/i);
    });

    it('triggerKeywordRescan enqueues nothing when no proxy', async () => {
      const { triggerKeywordRescan } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('proxyUrl', '');

      await triggerKeywordRescan(1, createSchedulerDeps());

      expect(await testDb.queue.count()).toBe(0);
    });

    it('handleDailyScanAlarm skips and leaves lastDailyScanDate unset when no proxy', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('proxyUrl', '');

      const deps = createSchedulerDeps();
      await handleDailyScanAlarm(deps);

      // No jobs, and lastDailyScanDate NOT stamped so the next alarm retries.
      expect(await testDb.queue.count()).toBe(0);
      expect(await settingsManager.get('lastDailyScanDate')).toBeNull();
    });
  });
});
