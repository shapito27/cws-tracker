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
import { SettingsManager } from '@/shared/utils/settings';
import { today, daysAgo } from '@/shared/utils/dates';
import { buildDailyScanJobs } from '@/background/queue-builder';
import { processNextJob, type ProcessorDeps } from '@/background/queue-processor';

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

// ---------------------------------------------------------------------------
// Dependencies (injectable for testing)
// ---------------------------------------------------------------------------

export interface SchedulerDeps {
  settings: SettingsManager;
  processorDeps?: ProcessorDeps;
}

const defaultSettings = new SettingsManager();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set up chrome.alarms on extension install or service worker startup.
 * Creates the recurring dailyScan alarm.
 */
export function setupAlarms(): void {
  chrome.alarms.create(ALARM_DAILY_SCAN, {
    delayInMinutes: MIN_ALARM_DELAY_MINUTES,
    periodInMinutes: 1440, // 24 hours
  });
}

/**
 * Handle the dailyScan alarm. Checks conditions and initiates a scan cycle.
 */
export async function handleDailyScanAlarm(
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
  const { settings } = deps;

  // Check if daily scanning is enabled
  const enabled = await settings.get('dailyScanEnabled');
  if (!enabled) return;

  // Check if already scanned today
  const lastScan = await settings.get('lastDailyScanDate');
  if (lastScan === today()) return;

  // Run queue cleanup
  const now = new Date();
  const completedBefore = new Date(now.getTime() - COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const failedBefore = new Date(now.getTime() - FAILED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.cleanupOldJobs(completedBefore, failedBefore);

  // Build jobs from all projects
  const projects = await db.getAllProjects();
  const extensions = await db.extensions.toArray();

  // Get all keywords across all projects
  const allKeywords = await db.keywords.toArray();

  const jobs = buildDailyScanJobs(projects, extensions, allKeywords);

  if (jobs.length === 0) {
    // No projects/extensions/keywords to scan
    await settings.set('lastDailyScanDate', today());
    return;
  }

  // Enqueue jobs
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

    const stats = await db.getQueueStats();
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
  }
}

/**
 * Trigger a manual refresh scan.
 * Clears existing pending jobs, builds new ones, and starts processing.
 *
 * @param projectId  If provided, only scan this project. Otherwise scan all.
 */
export async function triggerManualRefresh(
  projectId?: number,
  deps: SchedulerDeps = { settings: defaultSettings }
): Promise<void> {
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

  const jobs = buildDailyScanJobs(projects, extensions, relevantKeywords);

  if (jobs.length === 0) return;

  await db.enqueueJobs(jobs);

  // Notify dashboard immediately so UI shows "Scan Running..."
  try {
    chrome.runtime.sendMessage({
      type: 'SCAN_PROGRESS',
      completed: 0,
      total: jobs.length,
      currentJob: 'Queued, waiting to start...',
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
