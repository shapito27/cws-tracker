/**
 * CWS Tracker - Service Worker Entry Point (Phase 1.7).
 *
 * Registers all chrome.* event listeners that wire together the background
 * subsystems: scheduler, queue processor, and UI messaging.
 *
 * Chrome MV3 rules:
 * - No setTimeout/setInterval — use chrome.alarms.
 * - No in-memory state that must survive restarts — use IndexedDB.
 * - Listeners must be registered synchronously at the top level.
 */

import {
  setupAlarms,
  handleDailyScanAlarm,
  handleProcessQueueAlarm,
  handleBrowserStartup,
  handleSettingsChange,
  scheduleNextDailyScan,
  triggerManualRefresh,
  triggerKeywordRescan,
  pauseScanning,
  resumeScanning,
  ALARM_DAILY_SCAN,
  ALARM_PROCESS_QUEUE,
} from '@/background/scheduler';
import { runPaginationDiagnostic } from '@/background/pagination-diagnostic';
import { db } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import type { DashboardMessage } from '@/shared/types';
import type { Settings } from '@/shared/types/settings';

const settings = new SettingsManager();

// ---------------------------------------------------------------------------
// chrome.runtime.onInstalled — extension install / update
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    setupAlarms().catch((err) => {
      console.error('[CWS Tracker] setupAlarms error:', err);
    });
    // Trigger an initial scan attempt after install
    triggerManualRefresh().catch(() => {
      // May fail if no projects exist yet — that's fine
    });
  } else if (details.reason === 'update') {
    // Re-arm the dailyScan alarm AND catch up today's scan if it was missed.
    // Reloading or updating the extension after the scheduled time is equivalent
    // to opening the browser late — but chrome.runtime.onStartup does NOT fire on
    // a reload/update, so the catch-up must run here too (handleBrowserStartup
    // arms the next alarm when no scan is due).
    handleBrowserStartup().catch((err) => {
      console.error('[CWS Tracker] update handler error:', err);
    });
  }
});

// ---------------------------------------------------------------------------
// chrome.runtime.onStartup — browser launched / service worker cold start
// ---------------------------------------------------------------------------

chrome.runtime.onStartup.addListener(() => {
  // Re-arm the dailyScan alarm and, if today's scheduled scan was missed while
  // the browser was closed, run it now (catch-up).
  handleBrowserStartup().catch((err) => {
    console.error('[CWS Tracker] startup handler error:', err);
  });
});

// ---------------------------------------------------------------------------
// chrome.alarms.onAlarm — dispatch to scheduler handlers
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_DAILY_SCAN) {
    handleDailyScanAlarm().catch((err) => {
      console.error('[CWS Tracker] dailyScan alarm error:', err);
    });
    return;
  }

  if (alarm.name === ALARM_PROCESS_QUEUE) {
    handleProcessQueueAlarm().catch((err) => {
      console.error('[CWS Tracker] processQueue alarm error:', err);
    });
    return;
  }

  // Unknown alarm — ignore gracefully
});

// ---------------------------------------------------------------------------
// chrome.storage.onChanged — re-arm the daily scan when settings change
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const change = changes.settings;
  if (!change) return;
  const oldSettings = (change.oldValue ?? {}) as Partial<Settings>;
  const newSettings = (change.newValue ?? {}) as Partial<Settings>;
  // Editing the scan time or toggling auto-scan re-arms the alarm immediately,
  // so changes take effect without waiting for the next browser restart.
  handleSettingsChange(oldSettings, newSettings).catch((err) => {
    console.error('[CWS Tracker] settings-change handler error:', err);
  });
});

// ---------------------------------------------------------------------------
// chrome.runtime.onMessage — handle commands from Dashboard / Popup
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: DashboardMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));

    // Return true to indicate we will respond asynchronously
    return true;
  }
);

/**
 * Route incoming dashboard/popup messages to the appropriate handler.
 */
async function handleMessage(
  message: DashboardMessage
): Promise<{ ok: boolean; [key: string]: unknown }> {
  switch (message.type) {
    case 'TRIGGER_REFRESH':
      await triggerManualRefresh(message.projectId, message.scanType ?? 'full');
      return { ok: true };

    case 'RESCAN_KEYWORD':
      await triggerKeywordRescan(message.keywordId);
      return { ok: true };

    case 'PAUSE_SCAN':
      await pauseScanning();
      return { ok: true };

    case 'RESUME_SCAN':
      await resumeScanning();
      return { ok: true };

    case 'RESCHEDULE_DAILY_SCAN':
      // Re-arm (or clear) the daily alarm from current settings. This message
      // path reliably wakes the worker, so a scan-time/enabled change made in
      // the dashboard takes effect even if storage.onChanged did not wake us.
      await scheduleNextDailyScan();
      return { ok: true };

    case 'CANCEL_SCAN':
      await cancelScan();
      return { ok: true };

    case 'TEST_PAGINATION': {
      if (!message.keyword || message.keyword.trim().length === 0) {
        return { ok: false, error: 'Missing keyword parameter' };
      }
      const result = await runPaginationDiagnostic(
        message.keyword,
        Math.min(message.maxPages ?? 2, 5)
      );
      return { ...result };
    }

    default:
      // Unknown message type — ignore gracefully
      return { ok: true };
  }
}

/**
 * Cancel all pending jobs and stop the processQueue alarm.
 */
async function cancelScan(): Promise<void> {
  // Delete all pending jobs
  const pendingJobs = await db.queue.where('status').equals('pending').toArray();
  const jobIds = pendingJobs.map((j) => j.id).filter((id): id is number => id !== undefined);
  if (jobIds.length > 0) {
    await db.queue.bulkDelete(jobIds);
  }

  // Stop the processQueue alarm
  await chrome.alarms.clear(ALARM_PROCESS_QUEUE);

  // Clear the in-progress cycle marker so a cancelled scan doesn't block the
  // next scheduled daily scan's idempotency guard (which skips when a cycle is
  // already marked as started today).
  await settings.set('scanCycleStartedAt', null);
}
