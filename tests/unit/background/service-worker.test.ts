/**
 * Tests for Service Worker Entry Point (Phase 1.7.1).
 *
 * Tests that:
 * - onInstalled fires: alarms are set up
 * - onAlarm('dailyScan'): dispatches to daily scan handler
 * - onAlarm('processQueue'): dispatches to process queue handler
 * - onMessage('TRIGGER_REFRESH'): calls triggerManualRefresh
 * - sendToUI(): doesn't throw if no dashboard is open
 * - Unknown alarm name: ignored gracefully
 * - Unknown message type: ignored gracefully
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import '../../mocks/chrome';
import { resetChromeMock, getCalls, chromeMock } from '../../mocks/chrome';

// Mock the scheduler module so we can spy on its functions
const mockSetupAlarms = vi.fn().mockResolvedValue(undefined);
const mockHandleDailyScanAlarm = vi.fn().mockResolvedValue(undefined);
const mockHandleProcessQueueAlarm = vi.fn().mockResolvedValue(undefined);
const mockHandleBrowserStartup = vi.fn().mockResolvedValue(undefined);
const mockHandleSettingsChange = vi.fn().mockResolvedValue(undefined);
const mockTriggerManualRefresh = vi.fn().mockResolvedValue(undefined);
const mockTriggerKeywordRescan = vi.fn().mockResolvedValue(undefined);
const mockPauseScanning = vi.fn().mockResolvedValue(undefined);
const mockResumeScanning = vi.fn().mockResolvedValue(undefined);

vi.mock('@/background/scheduler', () => ({
  setupAlarms: (...args: unknown[]) => mockSetupAlarms(...args),
  handleDailyScanAlarm: (...args: unknown[]) => mockHandleDailyScanAlarm(...args),
  handleProcessQueueAlarm: (...args: unknown[]) => mockHandleProcessQueueAlarm(...args),
  handleBrowserStartup: (...args: unknown[]) => mockHandleBrowserStartup(...args),
  handleSettingsChange: (...args: unknown[]) => mockHandleSettingsChange(...args),
  triggerManualRefresh: (...args: unknown[]) => mockTriggerManualRefresh(...args),
  triggerKeywordRescan: (...args: unknown[]) => mockTriggerKeywordRescan(...args),
  pauseScanning: (...args: unknown[]) => mockPauseScanning(...args),
  resumeScanning: (...args: unknown[]) => mockResumeScanning(...args),
  ALARM_DAILY_SCAN: 'dailyScan',
  ALARM_PROCESS_QUEUE: 'processQueue',
}));

// Mock db for cancelScan
vi.mock('@/shared/db/database', () => {
  const mockQueue = {
    where: vi.fn().mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    }),
    bulkDelete: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      queue: mockQueue,
    },
  };
});

describe('Service Worker Entry Point', () => {
  beforeEach(() => {
    resetChromeMock();
    vi.clearAllMocks();
  });

  /**
   * Helper: import the service worker module fresh.
   * Since listeners are registered at the top level of the module,
   * we need to re-import to trigger them.
   */
  async function loadServiceWorker(): Promise<void> {
    // Reset module cache to force re-registration of listeners
    vi.resetModules();

    // Re-setup mocks after module reset
    vi.mock('@/background/scheduler', () => ({
      setupAlarms: (...args: unknown[]) => mockSetupAlarms(...args),
      handleDailyScanAlarm: (...args: unknown[]) => mockHandleDailyScanAlarm(...args),
      handleProcessQueueAlarm: (...args: unknown[]) => mockHandleProcessQueueAlarm(...args),
      handleBrowserStartup: (...args: unknown[]) => mockHandleBrowserStartup(...args),
      handleSettingsChange: (...args: unknown[]) => mockHandleSettingsChange(...args),
      triggerManualRefresh: (...args: unknown[]) => mockTriggerManualRefresh(...args),
      triggerKeywordRescan: (...args: unknown[]) => mockTriggerKeywordRescan(...args),
      pauseScanning: (...args: unknown[]) => mockPauseScanning(...args),
      resumeScanning: (...args: unknown[]) => mockResumeScanning(...args),
      ALARM_DAILY_SCAN: 'dailyScan',
      ALARM_PROCESS_QUEUE: 'processQueue',
    }));

    vi.mock('@/shared/db/database', () => {
      const mockQueue = {
        where: vi.fn().mockReturnValue({
          equals: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
        bulkDelete: vi.fn().mockResolvedValue(undefined),
      };
      return {
        db: {
          queue: mockQueue,
        },
      };
    });

    await import('@/background/index');
  }

  describe('onInstalled', () => {
    it('sets up alarms and triggers first scan on install', async () => {
      await loadServiceWorker();

      chromeMock.runtime._fireInstalled({ reason: 'install' });

      expect(mockSetupAlarms).toHaveBeenCalledTimes(1);
      expect(mockTriggerManualRefresh).toHaveBeenCalledTimes(1);
    });

    it('sets up alarms on update', async () => {
      await loadServiceWorker();

      chromeMock.runtime._fireInstalled({ reason: 'update', previousVersion: '0.6.0' });

      expect(mockSetupAlarms).toHaveBeenCalledTimes(1);
      // triggerManualRefresh should NOT be called on update
      expect(mockTriggerManualRefresh).not.toHaveBeenCalled();
    });
  });

  describe('onStartup', () => {
    it('dispatches browser startup to handleBrowserStartup (catch-up)', async () => {
      await loadServiceWorker();

      chromeMock.runtime._fireStartup();

      await vi.waitFor(() => {
        expect(mockHandleBrowserStartup).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('storage.onChanged', () => {
    it('re-arms via handleSettingsChange when settings change in local storage', async () => {
      await loadServiceWorker();

      chromeMock.storage.onChanged._fire(
        {
          settings: {
            oldValue: { dailyScanTime: '11:00' },
            newValue: { dailyScanTime: '14:00' },
          },
        },
        'local'
      );

      await vi.waitFor(() => {
        expect(mockHandleSettingsChange).toHaveBeenCalledTimes(1);
      });
      expect(mockHandleSettingsChange).toHaveBeenCalledWith(
        { dailyScanTime: '11:00' },
        { dailyScanTime: '14:00' }
      );
    });

    it('ignores changes from non-local storage areas', async () => {
      await loadServiceWorker();

      chromeMock.storage.onChanged._fire(
        { settings: { oldValue: {}, newValue: { dailyScanTime: '09:00' } } },
        'sync'
      );

      expect(mockHandleSettingsChange).not.toHaveBeenCalled();
    });

    it('ignores changes that do not touch the settings key', async () => {
      await loadServiceWorker();

      chromeMock.storage.onChanged._fire(
        { somethingElse: { oldValue: 1, newValue: 2 } },
        'local'
      );

      expect(mockHandleSettingsChange).not.toHaveBeenCalled();
    });
  });

  describe('onAlarm', () => {
    it('dispatches dailyScan alarm to handleDailyScanAlarm', async () => {
      await loadServiceWorker();

      // Create the alarm first so _fire can find it
      chromeMock.alarms.create('dailyScan', { delayInMinutes: 1 });
      chromeMock.alarms._fire('dailyScan');

      // Allow the async handler to resolve
      await vi.waitFor(() => {
        expect(mockHandleDailyScanAlarm).toHaveBeenCalledTimes(1);
      });
    });

    it('dispatches processQueue alarm to handleProcessQueueAlarm', async () => {
      await loadServiceWorker();

      chromeMock.alarms.create('processQueue', { delayInMinutes: 1 });
      chromeMock.alarms._fire('processQueue');

      await vi.waitFor(() => {
        expect(mockHandleProcessQueueAlarm).toHaveBeenCalledTimes(1);
      });
    });

    it('ignores unknown alarm names gracefully', async () => {
      await loadServiceWorker();

      chromeMock.alarms.create('unknownAlarm', { delayInMinutes: 1 });

      // Should not throw
      expect(() => {
        chromeMock.alarms._fire('unknownAlarm');
      }).not.toThrow();

      expect(mockHandleDailyScanAlarm).not.toHaveBeenCalled();
      expect(mockHandleProcessQueueAlarm).not.toHaveBeenCalled();
    });
  });

  describe('onMessage', () => {
    it('handles TRIGGER_REFRESH message', async () => {
      await loadServiceWorker();

      const response = await chromeMock.runtime.sendMessage({
        type: 'TRIGGER_REFRESH',
      });

      await vi.waitFor(() => {
        expect(mockTriggerManualRefresh).toHaveBeenCalledTimes(1);
      });
      expect(response).toEqual({ ok: true });
    });

    it('handles TRIGGER_REFRESH with projectId', async () => {
      await loadServiceWorker();

      const response = await chromeMock.runtime.sendMessage({
        type: 'TRIGGER_REFRESH',
        projectId: 42,
      });

      await vi.waitFor(() => {
        expect(mockTriggerManualRefresh).toHaveBeenCalledWith(42, 'full');
      });
      expect(response).toEqual({ ok: true });
    });

    it('handles PAUSE_SCAN message', async () => {
      await loadServiceWorker();

      const response = await chromeMock.runtime.sendMessage({
        type: 'PAUSE_SCAN',
      });

      await vi.waitFor(() => {
        expect(mockPauseScanning).toHaveBeenCalledTimes(1);
      });
      expect(response).toEqual({ ok: true });
    });

    it('handles RESUME_SCAN message', async () => {
      await loadServiceWorker();

      const response = await chromeMock.runtime.sendMessage({
        type: 'RESUME_SCAN',
      });

      await vi.waitFor(() => {
        expect(mockResumeScanning).toHaveBeenCalledTimes(1);
      });
      expect(response).toEqual({ ok: true });
    });

    it('handles CANCEL_SCAN message', async () => {
      await loadServiceWorker();

      const response = await chromeMock.runtime.sendMessage({
        type: 'CANCEL_SCAN',
      });

      // cancelScan accesses db.queue and clears the processQueue alarm
      await vi.waitFor(() => {
        const clearCalls = getCalls('alarms.clear');
        expect(clearCalls.some((c) => c.args[0] === 'processQueue')).toBe(true);
      });
      expect(response).toEqual({ ok: true });
    });

    it('ignores unknown message types gracefully', async () => {
      await loadServiceWorker();

      const response = await chromeMock.runtime.sendMessage({
        type: 'UNKNOWN_TYPE',
      });

      // Should not throw, should return ok
      expect(response).toEqual({ ok: true });

      // None of the handlers should have been called
      expect(mockTriggerManualRefresh).not.toHaveBeenCalled();
      expect(mockPauseScanning).not.toHaveBeenCalled();
      expect(mockResumeScanning).not.toHaveBeenCalled();
    });
  });
});
