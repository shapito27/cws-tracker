/**
 * Scheduler (Phase 1.6.4).
 *
 * Orchestrates daily scans, queue processing, and pause/resume controls
 * using chrome.alarms. This is the top-level coordinator for the background
 * service worker.
 *
 * Alarm names:
 * - 'dailyScan': fires every 24 hours to kick off a new scan cycle.
 * - 'processQueue': fires between individual job executions.
 */

import { db } from '@/shared/db/database';
import { SettingsManager, isProxyConfigured } from '@/shared/utils/settings';
import { today, toDateString } from '@/shared/utils/dates';
import {
  buildDailyScanJobs,
  buildKeywordScanJobs,
  buildAutocompleteScanJobs,
} from '@/background/queue-builder';
import { processNextJob, type ProcessorDeps } from '@/background/queue-processor';
import type { ScanType, QueueJob } from '@/shared/types';
import type { Settings } from '@/shared/types/settings';
import type { ScanErrorMessage } from '@/shared/types/messages';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ALARM_DAILY_SCAN = 'dailyScan';
export const ALARM_PROCESS_QUEUE = 'processQueue';

/** Minimum delay for chrome.alarms (1 minute per MV3 rules). */
const MIN_ALARM_DELAY_MINUTES = 1;

/** Completed job cleanup: 7 days. */
const COMPLETED_RETENTION_DAYS = 7;

/** Failed job cleanup: 30 days. */
const FAILED_RETENTION_DAYS = 30;

/**
 * Window during which a freshly-stamped `scanCycleStartedAt` suppresses a
 * duplicate cycle. The onStartup/onInstalled catch-up and a past-due `dailyScan`
 * alarm fire within seconds of each other; 2 minutes covers that race while
 * still letting a missed scan run after a stale marker (older than this and with
 * no jobs left) from an interrupted/reloaded cycle.
 */
const DUPLICATE_CYCLE_WINDOW_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Dependencies (injectable for testing)
// ---------------------------------------------------------------------------

export interface SchedulerDeps {
  settings: SettingsManager;
  processorDeps?: ProcessorDeps;
}

const defaultSettings = new SettingsManager();

/**
 * Proxy guard: scans cannot run without a configured proxy (CWS blocks direct
 * extension-origin fetches via CORS). Returns true when a proxy URL is set.
 *
 * When `broadcast` is true (manual scans), emits a SCAN_ERROR so an open
 * dashboard/popup can explain why nothing happened. Scheduled scans pass
 * `broadcast: false` since no UI is listening.
 */
async function ensureProxyConfigured(
  settings: SettingsManager,
  broadcast: boolean
): Promise<boolean> {
  const s = await settings.getWithDefaults();
  if (isProxyConfigured(s)) return true;

  if (broadcast) {
    const message: ScanErrorMessage = {
      type: 'SCAN_ERROR',
      jobId: -1,
      error: 'Proxy not configured — add a proxy URL in Settings to scan.',
      retriesLeft: 0,
    };
    try {
      chrome.runtime.sendMessage(message);
    } catch {
      // Dashboard/popup may not be open — ignore.
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the absolute timestamp (epoch ms) of the next occurrence of the
 * given `HH:MM` scan time relative to `now`, using local calendar fields.
 *
 * If today's scheduled time has already passed (or is exactly `now`), the
 * next occurrence is tomorrow at the same time.
 *
 * Uses `setHours` (local wall-clock), so the scan stays at the same local time
 * across DST transitions rather than drifting by an hour.
 */
export function nextDailyScanTimestamp(scanTime: string, now: Date): number {
  const [hours, minutes] = scanTime.split(':').map(Number);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

/**
 * Arm (or clear) the one-shot `dailyScan` alarm so it fires at the user's
 * configured scan time.
 *
 * Replaces the old fixed `delayInMinutes: 1 / periodInMinutes: 1440` alarm,
 * whose fire time was anchored to install/update time and ignored
 * `dailyScanTime` entirely. We use an absolute `when` for the next occurrence
 * and re-arm after each fire (see {@link handleDailyScanAlarm}), on browser
 * startup, and whenever the relevant settings change.
 *
 * When auto-scan is disabled, the alarm is cleared instead — re-enabling
 * re-arms it via {@link handleSettingsChange}.
 */
export async function scheduleNextDailyScan(
  deps: SchedulerDeps = { settings: defaultSettings },
  now: Date = new Date()
): Promise<void> {
  const s = await deps.settings.getWithDefaults();
  if (!s.dailyScanEnabled) {
    await chrome.alarms.clear(ALARM_DAILY_SCAN);
    return;
  }
  // Chrome enforces a ~1-minute minimum, so an alarm armed less than a minute
  // before its `when` may fire up to ~1 minute late — acceptable for a daily scan.
  chrome.alarms.create(ALARM_DAILY_SCAN, {
    when: nextDailyScanTimestamp(s.dailyScanTime, now),
  });
}

/**
 * Set up chrome.alarms on extension install or update. Arms the dailyScan
 * alarm for the next configured scan time (or clears it when auto-scan is off).
 */
export async function setupAlarms(
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
  await scheduleNextDailyScan(deps);
}

/**
 * True when a daily scan is "due now": auto-scan is enabled, no scan has
 * completed today, and the configured scan time for today has already passed
 * at `now`.
 *
 * This is the catch-up predicate: if the browser was closed (or the extension
 * not running) at the scheduled time, opening it later should still run the
 * day's scan rather than waiting until tomorrow.
 */
export async function isDailyScanDue(
  deps: SchedulerDeps = { settings: defaultSettings },
  now: Date = new Date()
): Promise<boolean> {
  const s = await deps.settings.getWithDefaults();
  if (!s.dailyScanEnabled) return false;
  if (s.lastDailyScanDate === toDateString(now)) return false;
  const [hours, minutes] = s.dailyScanTime.split(':').map(Number);
  const scheduledToday = new Date(now);
  scheduledToday.setHours(hours, minutes, 0, 0);
  return now.getTime() >= scheduledToday.getTime();
}

/**
 * Handle browser startup (chrome.runtime.onStartup). Runs a missed scan if one
 * is due (catch-up), otherwise just (re)arms the next dailyScan alarm.
 */
export async function handleBrowserStartup(
  deps: SchedulerDeps = { settings: defaultSettings },
  now: Date = new Date()
): Promise<void> {
  // Resume an interrupted scan: if jobs are still queued from a cycle that did
  // not finish (browser closed or extension reloaded mid-scan), kick the
  // processor so they continue rather than stalling until the next cycle.
  const [pending, running] = await Promise.all([
    db.getPendingCount(),
    db.getRunningJobs(),
  ]);
  if (pending > 0 || running.length > 0) {
    chrome.alarms.create(ALARM_PROCESS_QUEUE, {
      delayInMinutes: MIN_ALARM_DELAY_MINUTES,
    });
  }

  if (await isDailyScanDue(deps, now)) {
    // Missed today's scheduled scan (browser was closed, or the extension was
    // reloaded/updated after the scheduled time) — run it now. handleDailyScanAlarm
    // re-arms the next alarm in its finally block.
    await handleDailyScanAlarm(deps);
  } else {
    // Not due (already ran today, or before today's scan time) — just arm.
    await scheduleNextDailyScan(deps, now);
  }
}

/**
 * React to a chrome.storage.local settings change. When the scan time or the
 * enabled flag changes, re-arm (or clear) the dailyScan alarm so the edit
 * takes effect immediately instead of waiting for the next browser restart.
 */
export async function handleSettingsChange(
  oldSettings: Partial<Settings>,
  newSettings: Partial<Settings>,
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
  const timeChanged = oldSettings.dailyScanTime !== newSettings.dailyScanTime;
  const enabledChanged =
    oldSettings.dailyScanEnabled !== newSettings.dailyScanEnabled;
  if (!timeChanged && !enabledChanged) return;
  await scheduleNextDailyScan(deps);
}

/**
 * Handle the dailyScan alarm. Checks conditions and initiates a scan cycle,
 * then re-arms the next day's alarm.
 *
 * The next alarm is re-armed in a `finally` so the daily schedule survives
 * regardless of whether this run scanned, was skipped (already ran today / no
 * proxy / no projects), or threw — a one-shot `when` alarm does not repeat on
 * its own.
 */
export async function handleDailyScanAlarm(
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
  const { settings } = deps;

  // Check if daily scanning is enabled. When disabled there is no alarm to
  // re-arm (scheduleNextDailyScan would clear it), so bail early.
  const enabled = await settings.get('dailyScanEnabled');
  if (!enabled) return;

  try {
    await runDailyScanCycle(settings);
  } finally {
    await scheduleNextDailyScan(deps);
  }
}

/**
 * Run one daily scan cycle: guard on proxy, skip if already scanned today,
 * clean up old data, then build and enqueue jobs and kick the processor.
 *
 * Assumes auto-scan is enabled (checked by the caller). Does not schedule the
 * next dailyScan alarm — that is the caller's responsibility.
 */
async function runDailyScanCycle(settings: SettingsManager): Promise<void> {
  // Guard: a proxy is required to scan. Skip without stamping
  // lastDailyScanDate so the next alarm retries once a proxy is configured.
  if (!(await ensureProxyConfigured(settings, false))) {
    console.warn('[CWS Tracker] Daily scan skipped: proxy not configured.');
    return;
  }

  // Check if already scanned today
  const lastScan = await settings.get('lastDailyScanDate');
  if (lastScan === today()) return;

  // Idempotency guard against a duplicate scan cycle. On startup the
  // onStartup/onInstalled catch-up and a past-due `dailyScan` alarm can BOTH
  // reach this point within seconds, and lastDailyScanDate is only stamped once
  // the queue drains — so without this guard the day's jobs would be enqueued
  // twice (double the CWS requests). We skip when a cycle is genuinely in
  // flight: stamped within the last couple of minutes (covers the
  // near-simultaneous double-fire, before jobs are even enqueued) OR with jobs
  // still pending/running. A *stale* marker (older, no jobs left — e.g. an
  // interrupted/reloaded cycle) does NOT block, so a missed scan can still run.
  const existingCycle = await settings.get('scanCycleStartedAt');
  if (existingCycle && toDateString(new Date(existingCycle)) === today()) {
    const startedRecently =
      Date.now() - new Date(existingCycle).getTime() < DUPLICATE_CYCLE_WINDOW_MS;
    const [pendingCount, runningJobs] = await Promise.all([
      db.getPendingCount(),
      db.getRunningJobs(),
    ]);
    if (startedRecently || pendingCount > 0 || runningJobs.length > 0) return;
  }
  await settings.set('scanCycleStartedAt', new Date().toISOString());

  // Run queue cleanup
  const now = new Date();
  const completedBefore = new Date(now.getTime() - COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const failedBefore = new Date(now.getTime() - FAILED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.cleanupOldJobs(completedBefore, failedBefore);

  // Clean up scan logs older than 7 days (same retention as completed jobs)
  const scanLogCutoff = new Date(now.getTime() - COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.cleanupOldScanLogs(scanLogCutoff);

  // Build jobs from all projects
  const projects = await db.getAllProjects();
  const extensions = await db.extensions.toArray();

  // Get all keywords across all projects
  const allKeywords = await db.keywords.toArray();

  const jobs = buildDailyScanJobs(projects, extensions, allKeywords);

  if (jobs.length === 0) {
    // No projects/extensions/keywords to scan — clear the cycle marker we just
    // stamped (no cycle is actually running).
    await settings.set('lastDailyScanDate', today());
    await settings.set('scanCycleStartedAt', null);
    return;
  }

  // Enqueue jobs (scanCycleStartedAt was stamped above).
  await db.enqueueJobs(jobs);

  // Schedule first processQueue alarm
  chrome.alarms.create(ALARM_PROCESS_QUEUE, {
    delayInMinutes: MIN_ALARM_DELAY_MINUTES,
  });
}

/**
 * Handle the processQueue alarm. Processes one job and schedules the next.
 */
export async function handleProcessQueueAlarm(
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
  const { settings, processorDeps } = deps;

  // Reset any 'running' jobs to 'pending' (service worker may have restarted)
  await db.resetRunningJobs();

  // Process next job
  const result = await processNextJob(processorDeps);

  if (result.hasMore) {
    // Schedule next processQueue alarm with calculated delay
    const delayMinutes = Math.max(
      result.delayMs / 60_000,
      MIN_ALARM_DELAY_MINUTES
    );
    chrome.alarms.create(ALARM_PROCESS_QUEUE, {
      delayInMinutes: delayMinutes,
    });
  } else {
    // All jobs done - update last scan date and send completion message
    await settings.set('lastDailyScanDate', today());

    const cycleStartedAtIso = await settings.get('scanCycleStartedAt');
    const cycleStartedAt = cycleStartedAtIso ? new Date(cycleStartedAtIso) : null;
    const stats = await db.getQueueStats(cycleStartedAt);
    try {
      chrome.runtime.sendMessage({
        type: 'SCAN_COMPLETE',
        date: today(),
        jobsCompleted: stats.completed,
        jobsFailed: stats.failed,
      });
    } catch {
      // Dashboard may not be open
    }

    // Clear the scan cycle marker so any stray stats query returns global counts.
    await settings.set('scanCycleStartedAt', null);
  }
}

/**
 * Trigger a manual refresh scan.
 * Clears existing pending jobs, builds new ones, and starts processing.
 *
 * @param projectId  If provided, only scan this project. Otherwise scan all.
 * @param scanType   Job scope: 'full' (default), 'keywords' only, or 'autocomplete' only.
 */
export async function triggerManualRefresh(
  projectId?: number,
  scanType: ScanType = 'full',
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
  // Guard: a proxy is required to scan. Bail before touching the queue.
  if (!(await ensureProxyConfigured(deps.settings, true))) return;

  // Clear all pending jobs from queue
  const pendingJobs = await db.queue.where('status').equals('pending').toArray();
  if (pendingJobs.length > 0) {
    await db.queue.bulkDelete(pendingJobs.map((j) => j.id!));
  }

  // Clear the processQueue alarm
  await chrome.alarms.clear(ALARM_PROCESS_QUEUE);

  // Build new jobs
  let projects = await db.getAllProjects();
  if (projectId !== undefined) {
    projects = projects.filter((p) => p.id === projectId);
  }

  const extensions = await db.extensions.toArray();
  const allKeywords = await db.keywords.toArray();

  // Filter keywords to relevant projects
  const projectIds = new Set(projects.map((p) => p.id!));
  const relevantKeywords = allKeywords.filter((k) => projectIds.has(k.projectId));

  let jobs: QueueJob[];
  if (scanType === 'keywords') {
    jobs = buildKeywordScanJobs(relevantKeywords);
  } else if (scanType === 'autocomplete') {
    jobs = buildAutocompleteScanJobs(relevantKeywords);
  } else {
    jobs = buildDailyScanJobs(projects, extensions, relevantKeywords);
  }

  if (jobs.length === 0) return;

  // Record the scan cycle start so progress counts only include jobs from
  // this cycle (prior completed jobs are retained in the queue table for 7d).
  await deps.settings.set('scanCycleStartedAt', new Date().toISOString());

  await db.enqueueJobs(jobs);

  // Notify dashboard immediately so UI shows "Scan Running..."
  const nextProcessingAt = new Date(Date.now() + MIN_ALARM_DELAY_MINUTES * 60_000).toISOString();
  try {
    chrome.runtime.sendMessage({
      type: 'SCAN_PROGRESS',
      completed: 0,
      total: jobs.length,
      currentJob: 'Waiting to start...',
      nextProcessingAt,
      phase: 'queued',
    });
  } catch {
    // Dashboard may not be open
  }

  // Start processing
  chrome.alarms.create(ALARM_PROCESS_QUEUE, {
    delayInMinutes: MIN_ALARM_DELAY_MINUTES,
  });
}

/**
 * Re-scan a single keyword's search rank (lightweight, non-destructive).
 *
 * Unlike {@link triggerManualRefresh}, this does NOT clear the pending queue or
 * reset the scan-cycle marker — it appends one `keyword_scan` job and kicks the
 * processor. Used by the "Re-scan" action next to an unstable-rank hint to
 * quickly re-check a volatile rank.
 */
export async function triggerKeywordRescan(
  keywordId: number,
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
  // Guard: a proxy is required to scan.
  if (!(await ensureProxyConfigured(deps.settings, true))) return;

  const keyword = await db.keywords.get(keywordId);
  if (!keyword) return;

  const jobs = buildKeywordScanJobs([keyword]);
  if (jobs.length === 0) return;

  await db.enqueueJobs(jobs);

  // Notify the dashboard immediately so the button reflects the queued re-scan
  // (mirrors triggerManualRefresh — without this the UI shows nothing until the
  // 1-minute alarm fires, which looks like the button did nothing).
  const pending = await db.getPendingCount();
  const nextProcessingAt = new Date(Date.now() + MIN_ALARM_DELAY_MINUTES * 60_000).toISOString();
  try {
    chrome.runtime.sendMessage({
      type: 'SCAN_PROGRESS',
      completed: 0,
      total: Math.max(pending, 1),
      currentJob: `Re-scanning "${keyword.text}"…`,
      nextProcessingAt,
      phase: 'queued',
    });
  } catch {
    // Dashboard may not be open — ignore.
  }

  // Kick processing (MV3 alarm floor is 1 minute).
  chrome.alarms.create(ALARM_PROCESS_QUEUE, {
    delayInMinutes: MIN_ALARM_DELAY_MINUTES,
  });
}

/**
 * Pause automatic scanning by disabling the dailyScanEnabled setting.
 * In-progress jobs will still complete, but no new scan cycle will start.
 */
export async function pauseScanning(
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
  await deps.settings.set('dailyScanEnabled', false);
}

/**
 * Resume automatic scanning by enabling the dailyScanEnabled setting.
 */
export async function resumeScanning(
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
  await deps.settings.set('dailyScanEnabled', true);
}
