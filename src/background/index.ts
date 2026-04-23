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
  triggerManualRefresh,
  pauseScanning,
  resumeScanning,
  ALARM_DAILY_SCAN,
  ALARM_PROCESS_QUEUE,
} from '@/background/scheduler';
import { runPaginationDiagnostic } from '@/background/pagination-diagnostic';
import { ensureDeviceRegistered } from '@/background/registration';
import { db } from '@/shared/db/database';
import type { DashboardMessage } from '@/shared/types';

// ---------------------------------------------------------------------------
// chrome.runtime.onInstalled — extension install / update
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  // Register this device with the server (idempotent, graceful on failure).
  ensureDeviceRegistered().catch((err) => {
    console.warn('[CWS Tracker] registration failed:', err);
  });

  if (details.reason === 'install') {
    setupAlarms();
    // Trigger an initial scan attempt after install
    triggerManualRefresh().catch(() => {
      // May fail if no projects exist yet — that's fine
    });
  } else if (details.reason === 'update') {
    // Re-create alarms in case they were lost during update
    setupAlarms();
  }
});

// Also retry registration on startup — covers cases where the first registration
// failed (network unavailable) and we need to recover.
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    ensureDeviceRegistered().catch((err) => {
      console.warn('[CWS Tracker] registration failed:', err);
    });
  });
}

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
      await triggerManualRefresh(message.projectId);
      return { ok: true };

    case 'PAUSE_SCAN':
      await pauseScanning();
      return { ok: true };

    case 'RESUME_SCAN':
      await resumeScanning();
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
}
