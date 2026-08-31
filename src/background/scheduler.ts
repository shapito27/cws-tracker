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
  buildReviewScanJobs,
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
 * Maximum randomized delay applied to a slot's fire time, in minutes.
 *
 * Keeps the sampling times from being perfectly regular. Small enough that a
 * slot cannot drift into the next one (the tightest spacing, at scansPerDay: 4,
 * is 6 hours).
 */
const SLOT_JITTER_MINUTES = 20;

// ---------------------------------------------------------------------------
// Dependencies (injectable for testing)
// ---------------------------------------------------------------------------

export interface SchedulerDeps {
  settings: SettingsManager;
  processorDeps?: ProcessorDeps;
}

const defaultSettings = new SettingsManager();

/**
 * Best-effort reentrancy guard: stops two event handlers in the SAME live
 * service-worker instance (e.g. the onStartup/onInstalled catch-up AND a
 * past-due `dailyScan` alarm, both delivered on the same browser launch) from
 * both enqueueing the day's jobs. It is checked and set synchronously at the
 * top of {@link handleDailyScanAlarm} (no `await` between check and set), so a
 * concurrent second invocation reliably observes it.
 *
 * This is NOT durable state — it intentionally resets when the SW is recycled
 * (when there is, by definition, no concurrent invocation). The durable
 * `scanCycleStartedAt` guard in {@link runDailyScanCycle} is the cross-restart /
 * cross-instance backstop.
 */
let dailyScanRunning = false;

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

// ---------------------------------------------------------------------------
// Scan slots
// ---------------------------------------------------------------------------
//
// With `scansPerDay: N`, a day has N scan slots. Slot 0 fires at
// `dailyScanTime`; slot k fires 24/N hours later than slot k-1. At N=1 there is
// exactly one slot at `dailyScanTime` and everything below reduces to the
// single-daily-scan behaviour that came before.

/**
 * Local wall-clock `HH:MM` for slot `k`.
 *
 * Deliberately returns a wall-clock time rather than an offset in milliseconds:
 * adding `k * 8h` of real time would shift every later slot by an hour across a
 * DST boundary, whereas a fixed local time stays put. `scansPerDay` is capped at
 * 4 so `24/N` is always a whole number of hours.
 */
export function slotScanTime(baseScanTime: string, slot: number, scansPerDay: number): string {
  const [hours, minutes] = baseScanTime.split(':').map(Number);
  const spacingHours = 24 / scansPerDay;
  const slotHour = (hours + slot * spacingHours) % 24;
  return `${String(slotHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * The slot whose scheduled time most recently passed, for a given moment.
 *
 * This is "the slot we are currently in". A manual refresh writes into it, so
 * that a manual scan replaces the current slot's sample rather than inventing an
 * extra one. Before the day's first slot time, the current slot is the last one
 * of the previous day.
 */
export function currentSlot(baseScanTime: string, scansPerDay: number, now: Date): number {
  const [hours, minutes] = baseScanTime.split(':').map(Number);
  const spacingHours = 24 / scansPerDay;

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesBase = hours * 60 + minutes;
  // Minutes since slot 0, wrapped into [0, 1440).
  const elapsed = (minutesNow - minutesBase + 1440) % 1440;
  return Math.floor(elapsed / (spacingHours * 60));
}

/**
 * Timestamp of the next slot boundary strictly after `now`, and which slot it is.
 *
 * Each slot carries up to `SLOT_JITTER_MINUTES` of randomized delay so the
 * sampling times themselves are not perfectly regular. Without it, N evenly
 * spaced scans at fixed times would just replace one systematic sampling pattern
 * with another.
 */
export function nextSlotOccurrence(
  baseScanTime: string,
  scansPerDay: number,
  now: Date
): { when: number; slot: number } {
  let best: { when: number; slot: number } | null = null;

  // Check today's and tomorrow's occurrence of every slot; keep the earliest
  // that is still in the future.
  for (let slot = 0; slot < scansPerDay; slot++) {
    const [h, m] = slotScanTime(baseScanTime, slot, scansPerDay).split(':').map(Number);
    for (const dayOffset of [0, 1]) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(h, m, 0, 0);
      const when = candidate.getTime();
      if (when <= now.getTime()) continue;
      if (!best || when < best.when) best = { when, slot };
    }
  }

  // scansPerDay >= 1 guarantees at least one future candidate across two days.
  return best ?? { when: nextDailyScanTimestamp(baseScanTime, now), slot: 0 };
}

/** Identity of one scan slot on one day, e.g. `"2026-08-28#1"`. */
export function slotKey(date: string, slot: number): string {
  return `${date}#${slot}`;
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
  const next = nextSlotOccurrence(s.dailyScanTime, s.scansPerDay, now);
  // Spread the fire time within the slot so repeated scans don't land on the
  // same wall-clock minute every day.
  const jitterMs = Math.floor(Math.random() * SLOT_JITTER_MINUTES * 60_000);
  // Chrome enforces a ~1-minute minimum, so an alarm armed less than a minute
  // before its `when` may fire up to ~1 minute late — acceptable for a daily scan.
  chrome.alarms.create(ALARM_DAILY_SCAN, {
    when: next.when + jitterMs,
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
 * True when a scan is "due now": auto-scan is enabled, the current slot has not
 * already run, and that slot's scheduled time has passed at `now`.
 *
 * This is the catch-up predicate: if the browser was closed (or the extension
 * not running) at the scheduled time, opening it later should still run the
 * missed scan rather than waiting for the next slot.
 *
 * At `scansPerDay: 1` this is exactly the old behaviour — one slot per day, at
 * `dailyScanTime`.
 */
export async function isDailyScanDue(
  deps: SchedulerDeps = { settings: defaultSettings },
  now: Date = new Date()
): Promise<boolean> {
  const s = await deps.settings.getWithDefaults();
  if (!s.dailyScanEnabled) return false;

  const slot = currentSlot(s.dailyScanTime, s.scansPerDay, now);
  const slotDate = slotDateFor(s.dailyScanTime, s.scansPerDay, now);

  // Only catch up a slot belonging to today. Before the day's first slot time
  // the current slot is the previous day's last one, and a slot missed before
  // midnight stays missed — catching it up now would record it against the
  // wrong day. This is also what keeps scansPerDay: 1 behaving exactly as the
  // single daily scan did.
  if (slotDate !== toDateString(now)) return false;

  if (s.lastScanSlotKey === slotKey(slotDate, slot)) return false;

  // Legacy state: a pre-slots install has lastDailyScanDate but no slot key.
  // Treat today's scan as already done so upgrading doesn't trigger a rescan.
  if (s.lastScanSlotKey === null && s.lastDailyScanDate === toDateString(now)) return false;

  return true;
}

/**
 * The calendar date that the current slot belongs to.
 *
 * Usually today. Between midnight and the day's first slot time we are still
 * inside the previous day's last slot, so its date is yesterday — otherwise a
 * 22:00 slot observed at 01:00 would be recorded against the wrong day and
 * would look like it had never run.
 */
export function slotDateFor(baseScanTime: string, scansPerDay: number, now: Date): string {
  const [hours, minutes] = baseScanTime.split(':').map(Number);
  const firstSlotToday = new Date(now);
  firstSlotToday.setHours(hours, minutes, 0, 0);
  if (now.getTime() >= firstSlotToday.getTime()) return toDateString(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return toDateString(yesterday);
}

/**
 * Handle browser startup (chrome.runtime.onStartup). Runs a missed scan if one
 * is due (catch-up), otherwise just (re)arms the next dailyScan alarm.
 */
export async function handleBrowserStartup(
  deps: SchedulerDeps = { settings: defaultSettings },
  now: Date = new Date()
): Promise<void> {
  // Resume an interrupted scan first: if jobs are still queued from a cycle that
  // did not finish (browser closed or extension reloaded mid-scan), kick the
  // processor to continue it and do NOT start a second cycle on top — that
  // interrupted cycle is "today's" scan and will stamp lastDailyScanDate when it
  // drains. Just re-arm the next scheduled run.
  const [pending, running] = await Promise.all([
    db.getPendingCount(),
    db.getRunningJobs(),
  ]);
  if (pending > 0 || running.length > 0) {
    chrome.alarms.create(ALARM_PROCESS_QUEUE, {
      delayInMinutes: MIN_ALARM_DELAY_MINUTES,
    });
    await scheduleNextDailyScan(deps, now);
    return;
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

  // Reentrancy guard (synchronous check-and-set, no await between them): if a
  // concurrent invocation in this SW is already running the cycle, bail — it
  // re-arms the next alarm, so the schedule still advances.
  if (dailyScanRunning) return;
  dailyScanRunning = true;

  try {
    await runDailyScanCycle(settings);
  } finally {
    dailyScanRunning = false;
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
async function runDailyScanCycle(
  settings: SettingsManager,
  now: Date = new Date()
): Promise<void> {
  // Guard: a proxy is required to scan. Skip without stamping the slot key so
  // the next alarm retries once a proxy is configured.
  if (!(await ensureProxyConfigured(settings, false))) {
    console.warn('[CWS Tracker] Daily scan skipped: proxy not configured.');
    return;
  }

  const s = await settings.getWithDefaults();
  const slot = currentSlot(s.dailyScanTime, s.scansPerDay, now);
  const cycleDate = slotDateFor(s.dailyScanTime, s.scansPerDay, now);
  const key = slotKey(cycleDate, slot);

  // Check if this slot already ran.
  if (s.lastScanSlotKey === key) return;
  // Legacy state: a pre-slots install has no slot key but does have a date.
  // Don't re-run today's scan just because the key is missing.
  if (s.lastScanSlotKey === null && s.lastDailyScanDate === toDateString(now)) return;

  // Idempotency guard: never start a new cycle while a scan is already in
  // flight. This catches (a) the second of two near-simultaneous startup
  // triggers — once the first has enqueued, the second sees its pending jobs;
  // and (b) a prior cycle interrupted by a close/reload (its jobs are resumed
  // on startup), so we must not pile today's jobs on top of yesterday's. The
  // truly-concurrent case where neither has enqueued yet is handled by the
  // synchronous in-flight lock in handleDailyScanAlarm; lastDailyScanDate is
  // stamped only on drain, so it can't be relied on here.
  const [pendingCount, runningJobs] = await Promise.all([
    db.getPendingCount(),
    db.getRunningJobs(),
  ]);
  if (pendingCount > 0 || runningJobs.length > 0) {
    // A slot can be skipped because the previous slot's cycle is still draining
    // — likely when scansPerDay is raised past what a cycle can finish in
    // 24/N hours. Log it, or the missing sample looks like a bug.
    await db.saveScanLog({
      timestamp: new Date().toISOString(),
      jobId: null,
      jobType: 'listing_scan',
      level: 'warn',
      requestUrl: '',
      responseStatus: null,
      responsePreview: '',
      durationMs: 0,
      jobDetail:
        `Scan slot ${key} skipped: the previous cycle is still running ` +
        `(${pendingCount} pending, ${runningJobs.length} in flight). ` +
        `Lower scansPerDay or queueDelayMs if this recurs.`,
      error: null,
      httpMethod: 'GET',
      pageNumber: null,
      kind: 'summary',
    }).catch(() => {
      // Diagnostics must never break scheduling.
    });
    return;
  }

  // Run queue cleanup (relative to the cycle's `now`, which is injectable for tests)
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

  const jobs = buildDailyScanJobs(projects, extensions, allKeywords, { slot, cycleDate });

  if (jobs.length === 0) {
    // No projects/extensions/keywords to scan
    await settings.setMultiple({
      lastDailyScanDate: toDateString(now),
      lastScanSlotKey: key,
    });
    return;
  }

  // Record the scan cycle start so progress counts only include jobs from this
  // cycle (prior completed jobs are retained in the queue table for 7d), plus
  // which slot it is for so the drain handler stamps the right one.
  await settings.setMultiple({
    scanCycleStartedAt: new Date().toISOString(),
    scanCycleSlotKey: key,
  });

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
    // All jobs done - record the completed slot and send the completion message.
    // The slot key comes from the cycle marker rather than being recomputed from
    // the clock: a long cycle can outlive its own slot boundary, and recomputing
    // would then credit the run to a slot that never actually ran.
    const completedSlotKey = await settings.get('scanCycleSlotKey');
    await settings.setMultiple({
      lastDailyScanDate: today(),
      ...(completedSlotKey ? { lastScanSlotKey: completedSlotKey } : {}),
    });

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

    // Clear the scan cycle markers so any stray stats query returns global counts.
    await settings.setMultiple({ scanCycleStartedAt: null, scanCycleSlotKey: null });
  }
}

/**
 * Trigger a manual refresh scan.
 * Clears existing pending jobs, builds new ones, and starts processing.
 *
 * @param projectId  If provided, only scan this project. Otherwise scan all.
 * @param scanType   Job scope: 'full' (default), 'keywords' only, 'autocomplete' only, or 'reviews' only.
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

  // A manual refresh writes into the slot we are currently in, so it replaces
  // that slot's sample rather than adding a phantom extra one. At
  // scansPerDay: 1 this is always slot 0 — i.e. exactly the previous
  // "refresh overwrites today" behaviour.
  const s = await deps.settings.getWithDefaults();
  const now = new Date();
  const cycle = {
    slot: currentSlot(s.dailyScanTime, s.scansPerDay, now),
    cycleDate: slotDateFor(s.dailyScanTime, s.scansPerDay, now),
  };

  let jobs: QueueJob[];
  if (scanType === 'keywords') {
    jobs = buildKeywordScanJobs(relevantKeywords, cycle);
  } else if (scanType === 'autocomplete') {
    jobs = buildAutocompleteScanJobs(relevantKeywords, cycle);
  } else if (scanType === 'reviews') {
    // Tracked extensions (own + competitors) across the relevant projects.
    const relevantExtensionIds = projects.flatMap((p) => [p.ownExtensionId, ...p.competitorIds]);
    jobs = buildReviewScanJobs(relevantExtensionIds, cycle);
  } else {
    // A manual full refresh always includes review scans, even off slot 0:
    // the user explicitly asked for a refresh of everything.
    jobs = buildDailyScanJobs(projects, extensions, relevantKeywords, { ...cycle, slot: 0 })
      .map((job) => ({ ...job, slot: cycle.slot }));
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

  // Write into the current slot, replacing its sample. This re-scan exists to
  // re-check a rank that looked unstable, so it should correct that reading
  // rather than add a second one beside it.
  const s = await deps.settings.getWithDefaults();
  const now = new Date();
  const jobs = buildKeywordScanJobs([keyword], {
    slot: currentSlot(s.dailyScanTime, s.scansPerDay, now),
    cycleDate: slotDateFor(s.dailyScanTime, s.scansPerDay, now),
  });
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
