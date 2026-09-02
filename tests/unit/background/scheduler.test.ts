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
      // Fires in the 11:00 slot (today or tomorrow). Each slot carries up to
      // 20 minutes of jitter, so the exact minute is deliberately not fixed —
      // scanning at the same wall-clock minute every day is its own systematic
      // sampling pattern.
      const scheduled = new Date(info.when!);
      expect(scheduled.getHours()).toBe(11);
      expect(scheduled.getMinutes()).toBeGreaterThanOrEqual(0);
      expect(scheduled.getMinutes()).toBeLessThan(20);
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
      // Slot start, plus up to 20 minutes of jitter.
      const slotStart = new Date(2026, 5, 25, 8, 30, 0, 0).getTime();
      const when = (calls[0].args[1] as { when?: number }).when!;
      expect(when).toBeGreaterThanOrEqual(slotStart);
      expect(when).toBeLessThan(slotStart + 20 * 60_000);
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

    it('false when this slot already ran today', async () => {
      const { isDailyScanDue, slotKey } = await import('@/background/scheduler');
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '11:00');
      const now = new Date(2026, 5, 24, 13, 0, 0);
      await settingsManager.setMultiple({
        lastDailyScanDate: toDateString(now),
        lastScanSlotKey: slotKey(toDateString(now), 0),
      });
      expect(await isDailyScanDue(createSchedulerDeps(), now)).toBe(false);
    });

    it('false for a legacy install once its state has been migrated', async () => {
      // A pre-0.38 install records only lastDailyScanDate. That is no longer
      // read at scan time — migrateLegacyScanState converts it up front, which
      // is what handleBrowserStartup does before any scheduling decision.
      const { isDailyScanDue, migrateLegacyScanState } = await import('@/background/scheduler');
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '11:00');
      const now = new Date(2026, 5, 24, 13, 0, 0);
      await settingsManager.set('lastDailyScanDate', toDateString(now));

      await migrateLegacyScanState(settingsManager);

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

      // The missed daily scan ran: 1 listing + 1 keyword + 1 autocomplete + 1 review job.
      expect(await testDb.queue.count()).toBe(4);
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
      // Today's 11:00 slot, plus up to 20 minutes of jitter.
      const slotStart = new Date(2026, 5, 24, 11, 0, 0, 0).getTime();
      const when = (armed[0].args[1] as { when?: number }).when!;
      expect(when).toBeGreaterThanOrEqual(slotStart);
      expect(when).toBeLessThan(slotStart + 20 * 60_000);
    });

    it('resumes an interrupted scan by kicking the processor when jobs are still queued', async () => {
      const { handleBrowserStartup, ALARM_PROCESS_QUEUE } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '11:00');
      // A leftover pending job from a cycle interrupted by a close/reload.
      await testDb.enqueueJobs([{
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
      }]);

      // PAST the scan time → a catch-up WOULD be due, but the interrupted cycle
      // must resume instead of a second cycle being enqueued on top.
      const now = new Date(2026, 5, 24, 13, 0, 0);
      await handleBrowserStartup(createSchedulerDeps(), now);

      // Processor kicked to resume…
      const processQueueAlarm = getCalls('alarms.create').find(
        (c) => c.args[0] === ALARM_PROCESS_QUEUE
      );
      expect(processQueueAlarm).toBeDefined();
      // …and NO new daily jobs enqueued (only the leftover one remains).
      expect(await testDb.queue.count()).toBe(1);
    });
  });

  describe('migrateLegacyScanState', () => {
    it('records the pre-0.38 daily scan as slot 0 of its date', async () => {
      const { migrateLegacyScanState } = await import('@/background/scheduler');
      await settingsManager.set('lastDailyScanDate', '2026-08-20');

      await migrateLegacyScanState(settingsManager);

      expect(await settingsManager.get('lastScanSlotKey')).toBe('2026-08-20#0');
    });

    it('leaves an existing slot key alone', async () => {
      const { migrateLegacyScanState } = await import('@/background/scheduler');
      await settingsManager.setMultiple({
        lastDailyScanDate: '2026-08-20',
        lastScanSlotKey: '2026-08-20#2',
      });

      await migrateLegacyScanState(settingsManager);

      expect(await settingsManager.get('lastScanSlotKey')).toBe('2026-08-20#2');
    });

    it('is a no-op on a fresh install that has never scanned', async () => {
      const { migrateLegacyScanState } = await import('@/background/scheduler');

      await migrateLegacyScanState(settingsManager);

      expect(await settingsManager.get('lastScanSlotKey')).toBeNull();
    });

    it('is idempotent', async () => {
      const { migrateLegacyScanState } = await import('@/background/scheduler');
      await settingsManager.set('lastDailyScanDate', '2026-08-20');

      await migrateLegacyScanState(settingsManager);
      await migrateLegacyScanState(settingsManager);

      expect(await settingsManager.get('lastScanSlotKey')).toBe('2026-08-20#0');
    });

    it('runs before handleBrowserStartup makes any scheduling decision', async () => {
      const { handleBrowserStartup } = await import('@/background/scheduler');
      await seedProject();
      await settingsManager.setMultiple({
        dailyScanEnabled: true,
        dailyScanTime: '11:00',
        lastDailyScanDate: '2026-08-20',
      });

      await handleBrowserStartup(createSchedulerDeps(), new Date(2026, 7, 20, 13, 0));

      expect(await settingsManager.get('lastScanSlotKey')).toBe('2026-08-20#0');
    });
  });

  describe('catch-up proximity guard', () => {
    it('does not catch up a missed slot when the next one is imminent', async () => {
      // Catching up at 08:55 would still be draining at 09:00, so the in-flight
      // guard would skip slot 1 — a catch-up that costs a scan instead of
      // adding one.
      const { isDailyScanDue } = await import('@/background/scheduler');
      await settingsManager.setMultiple({
        dailyScanEnabled: true,
        dailyScanTime: '03:00',
        scansPerDay: 4,
      });

      const now = new Date(2026, 7, 20, 8, 55);
      expect(await isDailyScanDue(createSchedulerDeps(), now)).toBe(false);
    });

    it('catches up a missed slot when the next one is hours away', async () => {
      const { isDailyScanDue } = await import('@/background/scheduler');
      await settingsManager.setMultiple({
        dailyScanEnabled: true,
        dailyScanTime: '03:00',
        scansPerDay: 4,
      });

      // 12:00 — slot 1 (09:00) was missed, slot 2 is 3 hours off.
      const now = new Date(2026, 7, 20, 12, 0);
      expect(await isDailyScanDue(createSchedulerDeps(), now)).toBe(true);
    });
  });

  describe('upgraded install with more than one scan a day', () => {
    // The state a real 0.38.0 upgrade lands in: the pre-upgrade daily scan
    // already stamped lastDailyScanDate, and lastScanSlotKey has never been
    // written because it only exists in the new version. Every test before this
    // one either started clean or set the slot key explicitly, which is exactly
    // why the bug below shipped.
    async function seedUpgradedInstall(): Promise<void> {
      await seedProject();
      await settingsManager.setMultiple({
        dailyScanEnabled: true,
        dailyScanTime: '03:00',
        scansPerDay: 4,
        lastDailyScanDate: today(),
        lastScanSlotKey: null,
      });
    }

    it('runs a later slot on the day of the upgrade', async () => {
      const { handleDailyScanAlarm, migrateLegacyScanState } = await import('@/background/scheduler');
      await seedUpgradedInstall();
      await migrateLegacyScanState(settingsManager);

      // 15:00 is slot 2 of 03:00/09:00/15:00/21:00. It has never run.
      const now = new Date();
      now.setHours(15, 30, 0, 0);
      await handleDailyScanAlarm(createSchedulerDeps(), now);

      expect(await testDb.queue.count()).toBeGreaterThan(0);
    });

    it('does not re-run the slot the pre-upgrade scan already covered', async () => {
      const { handleDailyScanAlarm, migrateLegacyScanState } = await import('@/background/scheduler');
      await seedUpgradedInstall();
      await migrateLegacyScanState(settingsManager);

      // 03:30 is slot 0 — the one the old single daily scan corresponds to.
      const now = new Date();
      now.setHours(3, 30, 0, 0);
      await handleDailyScanAlarm(createSchedulerDeps(), now);

      expect(await testDb.queue.count()).toBe(0);
    });

    it('keeps running later slots after a manual refresh stamps the date', async () => {
      const { handleDailyScanAlarm, migrateLegacyScanState } = await import('@/background/scheduler');
      await seedProject();
      await settingsManager.setMultiple({
        dailyScanEnabled: true,
        dailyScanTime: '03:00',
        scansPerDay: 4,
        lastDailyScanDate: null,
        lastScanSlotKey: null,
      });
      await migrateLegacyScanState(settingsManager);

      // A manual refresh sets lastDailyScanDate but deliberately claims no slot.
      // That must not suppress the day's remaining scheduled slots.
      await settingsManager.set('lastDailyScanDate', today());

      const now = new Date();
      now.setHours(15, 30, 0, 0);
      await handleDailyScanAlarm(createSchedulerDeps(), now);

      expect(await testDb.queue.count()).toBeGreaterThan(0);
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

    it('re-arms the alarm when scansPerDay changes', async () => {
      const { handleSettingsChange, ALARM_DAILY_SCAN } = await import('@/background/scheduler');
      await settingsManager.set('dailyScanEnabled', true);
      await settingsManager.set('dailyScanTime', '03:00');
      await settingsManager.set('scansPerDay', 3);

      await handleSettingsChange(
        { dailyScanTime: '03:00', dailyScanEnabled: true, scansPerDay: 1 },
        { dailyScanTime: '03:00', dailyScanEnabled: true, scansPerDay: 3 },
        createSchedulerDeps()
      );

      // Raising the cadence adds slots later today that the armed alarm knows
      // nothing about; without re-arming, the new cadence would not start until
      // tomorrow.
      expect(
        getCalls('alarms.create').filter((c) => c.args[0] === ALARM_DAILY_SCAN).length
      ).toBeGreaterThanOrEqual(1);
    });

    it('does not re-arm when nothing schedule-related changed', async () => {
      const { handleSettingsChange, ALARM_DAILY_SCAN } = await import('@/background/scheduler');
      await settingsManager.set('dailyScanEnabled', true);

      await handleSettingsChange(
        { dailyScanTime: '03:00', dailyScanEnabled: true, scansPerDay: 1, queueDelayMs: 60_000 },
        { dailyScanTime: '03:00', dailyScanEnabled: true, scansPerDay: 1, queueDelayMs: 90_000 },
        createSchedulerDeps()
      );

      expect(
        getCalls('alarms.create').filter((c) => c.args[0] === ALARM_DAILY_SCAN)
      ).toHaveLength(0);
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

      // Should have created 4 jobs: 1 listing_scan + 1 keyword_scan + 1 autocomplete_scan + 1 review_scan
      const queueCount = await testDb.queue.count();
      expect(queueCount).toBe(4);

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
      expect(await testDb.queue.count()).toBe(4);

      // Second trigger (the past-due dailyScan alarm firing on the same startup)
      // must NOT duplicate the day's jobs.
      await handleDailyScanAlarm(deps);
      expect(await testDb.queue.count()).toBe(4);
    });

    it('does not double-enqueue when two triggers fire concurrently (reentrancy lock)', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);

      const deps = createSchedulerDeps();
      // Both triggers on the same browser launch, interleaved (onStartup catch-up
      // + a past-due dailyScan alarm). The synchronous in-flight lock must let
      // only one cycle enqueue, even though neither has stamped lastDailyScanDate.
      await Promise.all([
        handleDailyScanAlarm(deps),
        handleDailyScanAlarm(deps),
      ]);

      expect(await testDb.queue.count()).toBe(4);
    });

    it('skips enqueuing when a scan is already in flight (jobs pending)', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);
      // A job already queued (a scan is in progress, from this or a prior cycle).
      await testDb.enqueueJobs([{
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
      }]);

      await handleDailyScanAlarm(createSchedulerDeps());

      // No new daily jobs piled on — only the pre-existing one remains.
      expect(await testDb.queue.count()).toBe(1);
    });

    it('does not pile a new cycle on an interrupted prior-day cycle (Issue 7)', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('dailyScanEnabled', true);
      // Yesterday's cycle was interrupted: jobs still pending, lastDailyScanDate
      // never stamped, and a stale marker dated yesterday.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await settingsManager.set('scanCycleStartedAt', yesterday);
      await testDb.enqueueJobs([{
        type: 'keyword_scan',
        payload: { keywordId: 1, keyword: 'ad blocker' },
        status: 'pending',
        priority: 30,
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(),
        startedAt: null,
        completedAt: null,
        error: null,
      }]);

      await handleDailyScanAlarm(createSchedulerDeps());

      // The interrupted cycle resumes; today's cycle is NOT enqueued on top.
      expect(await testDb.queue.count()).toBe(1);
    });

    it('sets lastDailyScanDate when there are no projects to scan', async () => {
      const { handleDailyScanAlarm } = await import('@/background/scheduler');

      await settingsManager.set('dailyScanEnabled', true);

      await handleDailyScanAlarm(createSchedulerDeps());

      expect(await testDb.queue.count()).toBe(0);
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

    it('stamps the completed slot from the cycle marker, not the clock', async () => {
      const { handleProcessQueueAlarm } = await import('@/background/scheduler');

      await seedProject();
      // A cycle that started in slot 2 and is only draining now. Recomputing the
      // slot from the current time would credit the run to whichever slot we
      // happen to be in when the last job finishes.
      await settingsManager.set('scanCycleSlotKey', '2026-08-20#2');
      await testDb.enqueueJobs([{
        type: 'listing_scan',
        payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        status: 'pending',
        priority: 0,
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(Date.now() - 1000),
        startedAt: null,
        completedAt: null,
        error: null,
      }]);

      await handleProcessQueueAlarm(createSchedulerDeps());

      expect(await settingsManager.get('lastScanSlotKey')).toBe('2026-08-20#2');
      // And the marker is cleared so a later drain cannot re-stamp it.
      expect(await settingsManager.get('scanCycleSlotKey')).toBeNull();
    });

    it('does not stamp a slot when no cycle marker is set', async () => {
      const { handleProcessQueueAlarm } = await import('@/background/scheduler');

      await seedProject();
      await settingsManager.set('lastScanSlotKey', '2026-08-19#0');
      await testDb.enqueueJobs([{
        type: 'listing_scan',
        payload: { extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        status: 'pending',
        priority: 0,
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(Date.now() - 1000),
        startedAt: null,
        completedAt: null,
        error: null,
      }]);

      await handleProcessQueueAlarm(createSchedulerDeps());

      // A manual refresh (which sets no slot key) must not claim a scheduled
      // slot as done, or it would suppress that slot's real scan.
      expect(await settingsManager.get('lastScanSlotKey')).toBe('2026-08-19#0');
    });
  });

  describe('triggerTranslationAudit', () => {
    it('enqueues one translation_audit job per extension x locale and kicks the queue', async () => {
      const { triggerTranslationAudit } = await import('@/background/scheduler');
      await seedProject();

      const deps = createSchedulerDeps();
      const count = await triggerTranslationAudit(
        ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
        ['en', 'es', 'ja'],
        deps
      );

      expect(count).toBe(6);
      const jobs = await testDb.queue.where('status').equals('pending').toArray();
      expect(jobs).toHaveLength(6);
      expect(jobs.every((j) => j.type === 'translation_audit')).toBe(true);
      expect(jobs.every((j) => j.cycleDate === today())).toBe(true);

      const alarm = getCalls('alarms.create').find((c) => c.args[0] === 'processQueue');
      expect(alarm).toBeDefined();

      const progress = getCalls('runtime.sendMessage').find(
        (c) => (c.args[0] as { type: string }).type === 'SCAN_PROGRESS'
      );
      expect(progress).toBeDefined();
      const msg = progress!.args[0] as { total: number; phase: string; currentJob: string };
      expect(msg.total).toBe(6);
      expect(msg.phase).toBe('queued');
      expect(msg.currentJob).toContain('Translation audit');
    });

    it('does not clear pending jobs from a scan in progress', async () => {
      const { triggerTranslationAudit } = await import('@/background/scheduler');
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

      await triggerTranslationAudit(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], ['es'], createSchedulerDeps());

      const jobs = await testDb.queue.where('status').equals('pending').toArray();
      expect(jobs).toHaveLength(2);
      expect(jobs.some((j) => j.type === 'listing_scan')).toBe(true);
    });

    it('starts a cycle marker only when no cycle is active, and never claims a slot', async () => {
      const { triggerTranslationAudit } = await import('@/background/scheduler');
      await seedProject();

      await triggerTranslationAudit(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], ['es'], createSchedulerDeps());
      const started = await settingsManager.get('scanCycleStartedAt');
      expect(started).not.toBeNull();
      expect(await settingsManager.get('scanCycleSlotKey')).toBeNull();

      // A second audit while the first is active keeps the original marker.
      await triggerTranslationAudit(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], ['ja'], createSchedulerDeps());
      expect(await settingsManager.get('scanCycleStartedAt')).toBe(started);
    });

    it('returns 0 and enqueues nothing without extensions or locales', async () => {
      const { triggerTranslationAudit } = await import('@/background/scheduler');
      await seedProject();
      expect(await triggerTranslationAudit([], ['es'], createSchedulerDeps())).toBe(0);
      expect(await triggerTranslationAudit(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], [], createSchedulerDeps())).toBe(0);
      expect(await testDb.queue.count()).toBe(0);
    });

    it('bails out with a SCAN_ERROR when no proxy is configured', async () => {
      const { triggerTranslationAudit } = await import('@/background/scheduler');
      await seedProject();
      await settingsManager.set('proxyUrl', '');

      const count = await triggerTranslationAudit(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], ['es'], createSchedulerDeps());

      expect(count).toBe(0);
      expect(await testDb.queue.count()).toBe(0);
      const err = getCalls('runtime.sendMessage').find(
        (c) => (c.args[0] as { type: string }).type === 'SCAN_ERROR'
      );
      expect(err).toBeDefined();
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

      // Should have 4 new jobs (1 listing + 1 keyword + 1 autocomplete + 1 review)
      expect(pendingJobs).toHaveLength(4);

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

    it('scanType="reviews" enqueues only review_scan jobs for the project\'s tracked extensions', async () => {
      const { triggerManualRefresh } = await import('@/background/scheduler');

      await seedProject();

      const deps = createSchedulerDeps();
      await triggerManualRefresh(1, 'reviews', deps);

      const pendingJobs = await testDb.queue.where('status').equals('pending').toArray();
      expect(pendingJobs.length).toBeGreaterThan(0);
      expect(pendingJobs.every((j) => j.type === 'review_scan')).toBe(true);
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
