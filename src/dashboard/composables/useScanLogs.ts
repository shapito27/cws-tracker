/**
 * Composable for loading, grouping, and filtering scan logs.
 *
 * Loads the newest scan logs from IndexedDB for the list (max 500) and
 * provides client-side filtering by level and job type plus job-oriented
 * grouping for the Logs page. The 7-day chart is fed by a separate, uncapped
 * query over the whole window so the list cap never hides a day.
 *
 * A keyword scan emits one log per HTTP request plus a synthetic per-page
 * `kind: 'summary'` log (results / tracked-found / stop reason). The grouping
 * here folds each summary into its request row and clusters all of a queue
 * job's requests under a single job group so the page reads as
 * "one scan job → its page requests" instead of a flat list of near-duplicates.
 */

import { ref, computed } from 'vue';
import type { ScanLog, ScanLogLevel } from '@/shared/types';
import { db } from '@/shared/db/database';
import { daysAgo, toDateString } from '@/shared/utils/dates';

const MAX_LOGS = 500;
const STATS_WINDOW_DAYS = 7;

/** A ScanLog that has been persisted and has a guaranteed id. */
export interface SavedScanLog extends ScanLog {
  id: number;
}

export interface LogStats {
  total: number;
  infoCount: number;
  warnCount: number;
  errorCount: number;
  avgDurationMs: number;
}

/** Aggregated per-day request stats for the 7-day chart on the Logs page. */
export interface DailyRequestStat {
  date: string;
  infoCount: number;
  warnCount: number;
  errorCount: number;
  avgDurationMs: number;
}

/** One real HTTP request row, with its per-page summary folded in (if any). */
export interface LogRequestEntry {
  log: SavedScanLog;
  /** Matching `kind: 'summary'` log (paired by page number), or null. */
  summary: SavedScanLog | null;
  /** Result text from the summary with its redundant prefix stripped, or null. */
  summaryText: string | null;
}

/** One queue job's worth of consecutive request entries. */
export interface LogJobGroup {
  /** Stable v-for key. */
  key: string;
  jobId: number | null;
  jobType: string;
  /** Primary title from the first request (e.g. `Search: "ad blocker" (kw#5)`). */
  title: string;
  /** Representative (newest) timestamp in the group. */
  timestamp: string;
  /** Worst severity across the group's entries (error > warn > info). */
  level: ScanLogLevel;
  /** Sum of real request durations across the group. */
  totalDurationMs: number;
  entries: LogRequestEntry[];
}

/** Job groups bucketed by local calendar date (YYYY-MM-DD, see `localDateOf`). */
export interface LogDateGroup {
  date: string;
  jobs: LogJobGroup[];
}

const SEVERITY_RANK: Record<ScanLogLevel, number> = { info: 0, warn: 1, error: 2 };

/** One real (non-summary) request reduced to what the daily chart needs. */
interface DailyStatSample {
  /** Local calendar date (YYYY-MM-DD) the request happened on. */
  date: string;
  level: ScanLogLevel;
  durationMs: number;
}

/**
 * Local calendar date (YYYY-MM-DD) of an ISO timestamp.
 *
 * Log timestamps are stored as UTC ISO strings, so `timestamp.slice(0, 10)`
 * is the *UTC* date. The Logs page shows local times and local date headers,
 * and the chart's day buckets are built from the local `daysAgo()`, so every
 * bucketing decision has to use the local date too - otherwise a request at
 * 01:00 local in a UTC+ zone lands under "yesterday", the same local day
 * renders as two date headers, and the chart shifts counts across midnight.
 * An unparseable timestamp falls back to its literal date prefix.
 */
export function localDateOf(timestamp: string): string {
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? timestamp.slice(0, 10) : toDateString(d);
}

/** Matches the successful per-page summary jobDetail, e.g. `Page 2 for "kw": ...`. */
const SUMMARY_DETAIL_RE = /^Page \d+ for "/;

/**
 * A synthetic per-page summary log (not a real HTTP request). Tagged via
 * `kind: 'summary'` since 0.31.0; the body-pattern fallback keeps pre-0.31.0
 * logs folding correctly until they age out of the 7-day window. Page error
 * logs ("Page N fetch failed/HTTP/parse failed") are deliberately NOT matched —
 * they are real failed attempts and stay as request rows.
 */
export function isSummaryLog(log: ScanLog): boolean {
  if (log.kind === 'summary') return true;
  return (
    log.kind === undefined &&
    log.durationMs === 0 &&
    log.responsePreview === '' &&
    log.error === null &&
    SUMMARY_DETAIL_RE.test(log.jobDetail)
  );
}

/** Strip the redundant `Page N for "kw": ` prefix; page + keyword are shown elsewhere. */
function extractSummaryText(summary: SavedScanLog): string {
  return summary.jobDetail.replace(/^Page \d+ for ".*?": /, '');
}

/** Split a reverse-chronological list into maximal runs of the same non-null jobId. */
function segmentByJob(logs: SavedScanLog[]): SavedScanLog[][] {
  const runs: SavedScanLog[][] = [];
  for (const log of logs) {
    const last = runs[runs.length - 1];
    if (last && log.jobId !== null && last[0].jobId === log.jobId) {
      last.push(log);
    } else {
      runs.push([log]);
    }
  }
  return runs;
}

/** Build a single job group from one run of logs (reverse-chronological). */
function buildJobGroup(run: SavedScanLog[]): LogJobGroup {
  const requests = run.filter((l) => !isSummaryLog(l));
  const summaries = run.filter((l) => isSummaryLog(l));

  const summaryByPage = new Map<number, SavedScanLog>();
  for (const s of summaries) {
    if (s.pageNumber != null) summaryByPage.set(s.pageNumber, s);
  }

  const entries: LogRequestEntry[] = requests.map((log) => {
    const summary = log.pageNumber != null ? summaryByPage.get(log.pageNumber) ?? null : null;
    if (summary && log.pageNumber != null) summaryByPage.delete(log.pageNumber);
    return { log, summary, summaryText: summary ? extractSummaryText(summary) : null };
  });

  // Defensive: surface any summary that never matched a request rather than drop it.
  for (const orphan of summaryByPage.values()) {
    entries.push({ log: orphan, summary: null, summaryText: null });
  }

  // Natural reading order: page 1 → N, then by time.
  entries.sort((a, b) => {
    const pa = a.log.pageNumber ?? 0;
    const pb = b.log.pageNumber ?? 0;
    if (pa !== pb) return pa - pb;
    return a.log.timestamp.localeCompare(b.log.timestamp);
  });

  const level = run.reduce<ScanLogLevel>(
    (worst, l) => (SEVERITY_RANK[l.level] > SEVERITY_RANK[worst] ? l.level : worst),
    'info'
  );
  const totalDurationMs = entries.reduce((sum, e) => sum + e.log.durationMs, 0);
  // Title comes from the first request (page 1 for keyword scans); fall back to
  // the run's newest log if a group somehow has only orphan summaries.
  const title = entries[0]?.log.jobDetail ?? run[0].jobDetail;

  return {
    key: `job-${run[0].id}`,
    jobId: run[0].jobId,
    jobType: run[0].jobType,
    title,
    timestamp: run[0].timestamp, // newest (run is reverse-chronological)
    level,
    totalDurationMs,
    entries,
  };
}

/**
 * Group a reverse-chronological log list into date buckets, each containing
 * job groups (newest first). Pure + exported for testing.
 */
export function groupLogsByJob(logs: SavedScanLog[]): LogDateGroup[] {
  const dateGroups: LogDateGroup[] = [];
  let currentDate = '';
  for (const run of segmentByJob(logs)) {
    const group = buildJobGroup(run);
    const date = localDateOf(group.timestamp);
    if (date !== currentDate) {
      currentDate = date;
      dateGroups.push({ date, jobs: [] });
    }
    dateGroups[dateGroups.length - 1].jobs.push(group);
  }
  return dateGroups;
}

export function useScanLogs() {
  const logs = ref<SavedScanLog[]>([]);
  /** Every real request in the chart window, independent of the list's row cap. */
  const statsSamples = ref<DailyStatSample[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const filterLevel = ref<ScanLogLevel | 'all'>('all');
  const filterJobType = ref<string>('all');

  /** Unique job types present in the loaded data (for dynamic dropdown). */
  const jobTypes = computed<string[]>(() => {
    const types = new Set<string>();
    for (const log of logs.value) {
      types.add(log.jobType);
    }
    return [...types].sort();
  });

  const filteredLogs = computed<SavedScanLog[]>(() => {
    return logs.value.filter((log) => {
      if (filterLevel.value !== 'all' && log.level !== filterLevel.value) return false;
      if (filterJobType.value !== 'all' && log.jobType !== filterJobType.value) return false;
      return true;
    });
  });

  /** Filtered logs grouped by date → scan job, with summaries folded into requests. */
  const logGroups = computed<LogDateGroup[]>(() => groupLogsByJob(filteredLogs.value));

  /**
   * Per-day request stats over the last 7 local calendar days (chronological,
   * oldest → today). Missing days are zero-filled so the chart x-axis is
   * always full. Derived from `statsSamples` - a separate, uncapped query over
   * the whole window - NOT from the list's `logs`, which is capped at
   * `MAX_LOGS` newest rows: a couple of busy days (a translation audit alone
   * is 100+ requests plus their summary rows) would otherwise fill the cap
   * and every older day would silently chart as zero. It is also independent
   * of `filteredLogs` so the level/jobType filters on the list don't distort
   * the overall health view. Synthetic `summary` logs are excluded so counts
   * reflect real requests and the 0ms diagnostics don't deflate the average.
   */
  const weeklyStats = computed<DailyRequestStat[]>(() => {
    const buckets = new Map<string, { info: number; warn: number; error: number; totalDuration: number; count: number }>();
    for (let i = STATS_WINDOW_DAYS - 1; i >= 0; i--) {
      buckets.set(daysAgo(i), { info: 0, warn: 0, error: 0, totalDuration: 0, count: 0 });
    }
    for (const sample of statsSamples.value) {
      const bucket = buckets.get(sample.date);
      if (!bucket) continue;
      if (sample.level === 'info') bucket.info++;
      else if (sample.level === 'warn') bucket.warn++;
      else if (sample.level === 'error') bucket.error++;
      bucket.totalDuration += sample.durationMs;
      bucket.count++;
    }
    const out: DailyRequestStat[] = [];
    for (const [date, b] of buckets) {
      out.push({
        date,
        infoCount: b.info,
        warnCount: b.warn,
        errorCount: b.error,
        avgDurationMs: b.count === 0 ? 0 : Math.round(b.totalDuration / b.count),
      });
    }
    return out;
  });

  const stats = computed<LogStats>(() => {
    // Count only real requests; fold-in summaries are not separate requests.
    const all = filteredLogs.value.filter((log) => !isSummaryLog(log));
    if (all.length === 0) {
      return { total: 0, infoCount: 0, warnCount: 0, errorCount: 0, avgDurationMs: 0 };
    }
    let infoCount = 0;
    let warnCount = 0;
    let errorCount = 0;
    let totalDuration = 0;
    for (const log of all) {
      if (log.level === 'info') infoCount++;
      else if (log.level === 'warn') warnCount++;
      else if (log.level === 'error') errorCount++;
      totalDuration += log.durationMs;
    }
    return {
      total: all.length,
      infoCount,
      warnCount,
      errorCount,
      avgDurationMs: Math.round(totalDuration / all.length),
    };
  });

  async function loadLogs(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      // Chart window starts at local midnight of the oldest charted day; the
      // ISO cutoff is what the (UTC) timestamp index is compared against.
      const windowStartIso = new Date(`${daysAgo(STATS_WINDOW_DAYS - 1)}T00:00:00`).toISOString();
      const [raw, windowLogs] = await Promise.all([
        db.getRecentScanLogs(MAX_LOGS),
        db.getScanLogsSince(windowStartIso),
      ]);
      // Filter to only logs with a persisted id (should always be the case)
      logs.value = raw.filter((l): l is SavedScanLog => l.id !== undefined);
      // Keep only what the chart needs - the window can hold thousands of
      // rows with response bodies attached.
      statsSamples.value = windowLogs
        .filter((l) => !isSummaryLog(l))
        .map((l) => ({ date: localDateOf(l.timestamp), level: l.level, durationMs: l.durationMs }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error.value = msg;
      console.error('Failed to load scan logs:', e);
      logs.value = [];
      statsSamples.value = [];
    } finally {
      loading.value = false;
    }
  }

  return {
    logs,
    loading,
    error,
    filterLevel,
    filterJobType,
    jobTypes,
    filteredLogs,
    logGroups,
    stats,
    weeklyStats,
    loadLogs,
  };
}
