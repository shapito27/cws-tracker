/**
 * Tests for useScanLogs composable - focused on the weeklyStats aggregation
 * that feeds the daily request stats chart on the Logs page.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import { useScanLogs, groupLogsByJob, isSummaryLog, localDateOf } from '@/dashboard/composables/useScanLogs';
import type { SavedScanLog } from '@/dashboard/composables/useScanLogs';
import type { ScanLog, ScanLogLevel } from '@/shared/types';
import { daysAgo, toDateString } from '@/shared/utils/dates';

/** ISO timestamp for a wall-clock time on a local YYYY-MM-DD date. */
function localIso(date: string, hh: number, mm: number): string {
  return new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).toISOString();
}

function makeLog(partial: Partial<ScanLog> & { timestamp: string; level: ScanLogLevel; durationMs: number }): ScanLog {
  return {
    timestamp: partial.timestamp,
    jobId: null,
    jobType: 'listing_scan',
    level: partial.level,
    requestUrl: 'https://example.com/',
    responseStatus: partial.level === 'error' ? null : 200,
    responsePreview: '',
    durationMs: partial.durationMs,
    jobDetail: 'test',
    error: partial.level === 'error' ? 'boom' : null,
  };
}

beforeEach(async () => {
  await db.scan_logs.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useScanLogs weeklyStats', () => {
  it('returns 7 days of zeros when no logs exist', async () => {
    const { loadLogs, weeklyStats } = useScanLogs();
    await loadLogs();

    expect(weeklyStats.value).toHaveLength(7);
    for (const day of weeklyStats.value) {
      expect(day.infoCount).toBe(0);
      expect(day.warnCount).toBe(0);
      expect(day.errorCount).toBe(0);
      expect(day.avgDurationMs).toBe(0);
    }
  });

  it('returns days in chronological order ending with today', async () => {
    const { loadLogs, weeklyStats } = useScanLogs();
    await loadLogs();

    expect(weeklyStats.value[0].date).toBe(daysAgo(6));
    expect(weeklyStats.value[6].date).toBe(daysAgo(0));
  });

  it('buckets mixed-level logs on the same day', async () => {
    const today = daysAgo(0);
    await db.saveScanLog(makeLog({ timestamp: `${today}T10:00:00.000Z`, level: 'info', durationMs: 100 }));
    await db.saveScanLog(makeLog({ timestamp: `${today}T10:05:00.000Z`, level: 'info', durationMs: 300 }));
    await db.saveScanLog(makeLog({ timestamp: `${today}T10:10:00.000Z`, level: 'warn', durationMs: 500 }));
    await db.saveScanLog(makeLog({ timestamp: `${today}T10:15:00.000Z`, level: 'error', durationMs: 800 }));

    const { loadLogs, weeklyStats } = useScanLogs();
    await loadLogs();

    const todayBucket = weeklyStats.value.find((d) => d.date === today);
    expect(todayBucket).toBeDefined();
    expect(todayBucket!.infoCount).toBe(2);
    expect(todayBucket!.warnCount).toBe(1);
    expect(todayBucket!.errorCount).toBe(1);
    expect(todayBucket!.avgDurationMs).toBe(425); // (100+300+500+800)/4
  });

  it('spreads logs across multiple days', async () => {
    await db.saveScanLog(makeLog({ timestamp: `${daysAgo(5)}T12:00:00.000Z`, level: 'info', durationMs: 200 }));
    await db.saveScanLog(makeLog({ timestamp: `${daysAgo(2)}T12:00:00.000Z`, level: 'error', durationMs: 400 }));
    await db.saveScanLog(makeLog({ timestamp: `${daysAgo(0)}T12:00:00.000Z`, level: 'warn', durationMs: 600 }));

    const { loadLogs, weeklyStats } = useScanLogs();
    await loadLogs();

    const d5 = weeklyStats.value.find((d) => d.date === daysAgo(5))!;
    const d2 = weeklyStats.value.find((d) => d.date === daysAgo(2))!;
    const d0 = weeklyStats.value.find((d) => d.date === daysAgo(0))!;
    const d6 = weeklyStats.value.find((d) => d.date === daysAgo(6))!;

    expect(d5.infoCount).toBe(1);
    expect(d5.avgDurationMs).toBe(200);
    expect(d2.errorCount).toBe(1);
    expect(d2.avgDurationMs).toBe(400);
    expect(d0.warnCount).toBe(1);
    expect(d0.avgDurationMs).toBe(600);
    expect(d6.infoCount + d6.warnCount + d6.errorCount).toBe(0);
    expect(d6.avgDurationMs).toBe(0);
  });

  it('handles logs with durationMs = 0', async () => {
    const today = daysAgo(0);
    await db.saveScanLog(makeLog({ timestamp: `${today}T09:00:00.000Z`, level: 'info', durationMs: 0 }));
    await db.saveScanLog(makeLog({ timestamp: `${today}T09:01:00.000Z`, level: 'info', durationMs: 200 }));

    const { loadLogs, weeklyStats } = useScanLogs();
    await loadLogs();

    const todayBucket = weeklyStats.value.find((d) => d.date === today)!;
    expect(todayBucket.infoCount).toBe(2);
    expect(todayBucket.avgDurationMs).toBe(100);
  });

  it('ignores logs older than the 7-day window', async () => {
    await db.saveScanLog(makeLog({ timestamp: `${daysAgo(10)}T00:00:00.000Z`, level: 'info', durationMs: 999 }));
    await db.saveScanLog(makeLog({ timestamp: `${daysAgo(0)}T00:00:00.000Z`, level: 'info', durationMs: 100 }));

    const { loadLogs, weeklyStats } = useScanLogs();
    await loadLogs();

    const totalInfo = weeklyStats.value.reduce((sum, d) => sum + d.infoCount, 0);
    expect(totalInfo).toBe(1);
  });

  it('is independent of filterLevel / filterJobType', async () => {
    const today = daysAgo(0);
    await db.saveScanLog(makeLog({ timestamp: `${today}T09:00:00.000Z`, level: 'info', durationMs: 100 }));
    await db.saveScanLog(makeLog({ timestamp: `${today}T09:01:00.000Z`, level: 'error', durationMs: 100 }));

    const { loadLogs, weeklyStats, filterLevel, filterJobType } = useScanLogs();
    await loadLogs();

    filterLevel.value = 'error';
    filterJobType.value = 'listing_scan';

    const todayBucket = weeklyStats.value.find((d) => d.date === today)!;
    expect(todayBucket.infoCount).toBe(1);
    expect(todayBucket.errorCount).toBe(1);
  });

  it('counts every request in the window even when the list cap (500 rows) is exceeded', async () => {
    // Older day first so its rows have the lowest ids and are the first ones
    // the id-ordered list query drops.
    const old = daysAgo(5);
    await db.scan_logs.bulkAdd([
      makeLog({ timestamp: `${old}T12:00:00.000Z`, level: 'info', durationMs: 100 }),
      makeLog({ timestamp: `${old}T12:01:00.000Z`, level: 'error', durationMs: 300 }),
    ]);
    // 260 requests + 260 summary rows today = 520 rows, more than the list loads.
    const today = daysAgo(0);
    const rows: ScanLog[] = [];
    for (let i = 0; i < 260; i++) {
      rows.push(makeLog({ timestamp: `${today}T10:00:00.000Z`, level: 'info', durationMs: 200 }));
      rows.push({
        ...makeLog({ timestamp: `${today}T10:00:01.000Z`, level: 'info', durationMs: 0 }),
        jobDetail: 'Page 1 for "x": 30 results, 1/1 tracked found, continuing',
        kind: 'summary',
      });
    }
    await db.scan_logs.bulkAdd(rows);

    const { loadLogs, logs, weeklyStats } = useScanLogs();
    await loadLogs();

    expect(logs.value).toHaveLength(500); // the list is still capped...
    const oldBucket = weeklyStats.value.find((d) => d.date === old)!;
    expect(oldBucket.infoCount).toBe(1); // ...but the chart still sees the older day
    expect(oldBucket.errorCount).toBe(1);
    expect(oldBucket.avgDurationMs).toBe(200);
    const todayBucket = weeklyStats.value.find((d) => d.date === today)!;
    expect(todayBucket.infoCount).toBe(260);
    expect(todayBucket.avgDurationMs).toBe(200);
  });

  it('buckets by local calendar date, not the UTC date of the ISO timestamp', async () => {
    const today = daysAgo(0);
    const yesterday = daysAgo(1);
    // Just after local midnight today and just before local midnight
    // yesterday: in a non-UTC zone at least one of these has a different UTC
    // date than its local date.
    await db.saveScanLog(makeLog({ timestamp: localIso(today, 0, 30), level: 'info', durationMs: 100 }));
    await db.saveScanLog(makeLog({ timestamp: localIso(today, 23, 30), level: 'warn', durationMs: 300 }));
    await db.saveScanLog(makeLog({ timestamp: localIso(yesterday, 23, 30), level: 'error', durationMs: 500 }));

    const { loadLogs, weeklyStats } = useScanLogs();
    await loadLogs();

    const todayBucket = weeklyStats.value.find((d) => d.date === today)!;
    expect(todayBucket.infoCount).toBe(1);
    expect(todayBucket.warnCount).toBe(1);
    expect(todayBucket.errorCount).toBe(0);
    expect(todayBucket.avgDurationMs).toBe(200);
    const yesterdayBucket = weeklyStats.value.find((d) => d.date === yesterday)!;
    expect(yesterdayBucket.errorCount).toBe(1);
    expect(yesterdayBucket.infoCount + yesterdayBucket.warnCount).toBe(0);
  });

  it('includes the whole oldest charted day, from local midnight', async () => {
    const oldest = daysAgo(6);
    await db.saveScanLog(makeLog({ timestamp: localIso(oldest, 0, 5), level: 'info', durationMs: 100 }));
    await db.saveScanLog(makeLog({ timestamp: localIso(daysAgo(7), 23, 55), level: 'info', durationMs: 100 }));

    const { loadLogs, weeklyStats } = useScanLogs();
    await loadLogs();

    expect(weeklyStats.value[0].date).toBe(oldest);
    expect(weeklyStats.value[0].infoCount).toBe(1);
    expect(weeklyStats.value.reduce((sum, d) => sum + d.infoCount, 0)).toBe(1);
  });

  it('excludes synthetic summary logs from the daily request counts and average', async () => {
    const today = daysAgo(0);
    // A real request (200ms) plus its 0ms per-page summary.
    await db.saveScanLog(makeLog({ timestamp: `${today}T09:00:00.000Z`, level: 'info', durationMs: 200 }));
    await db.saveScanLog({
      ...makeLog({ timestamp: `${today}T09:00:01.000Z`, level: 'info', durationMs: 0 }),
      jobDetail: 'Page 1 for "x": 30 results, 1/1 tracked found, continuing',
      kind: 'summary',
    });

    const { loadLogs, weeklyStats } = useScanLogs();
    await loadLogs();

    const todayBucket = weeklyStats.value.find((d) => d.date === today)!;
    // Only the real request counts; the 0ms summary does not deflate the average.
    expect(todayBucket.infoCount).toBe(1);
    expect(todayBucket.avgDurationMs).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Summary detection + job grouping
// ---------------------------------------------------------------------------

let nextId = 1;
function makeSaved(partial: Partial<SavedScanLog> & { jobId: number | null; timestamp: string }): SavedScanLog {
  return {
    id: nextId++,
    timestamp: partial.timestamp,
    jobId: partial.jobId,
    jobType: partial.jobType ?? 'keyword_scan',
    level: partial.level ?? 'info',
    requestUrl: partial.requestUrl ?? 'https://proxy.example.com/search?q=ad+blocker',
    responseStatus: partial.responseStatus ?? 200,
    responsePreview: partial.responsePreview ?? '',
    durationMs: partial.durationMs ?? 0,
    jobDetail: partial.jobDetail ?? 'test',
    error: partial.error ?? null,
    httpMethod: partial.httpMethod ?? 'GET',
    pageNumber: partial.pageNumber ?? null,
    kind: partial.kind,
  };
}

describe('isSummaryLog', () => {
  it('detects logs explicitly tagged kind: "summary"', () => {
    expect(isSummaryLog(makeSaved({ jobId: 1, timestamp: 't', kind: 'summary' }))).toBe(true);
  });

  it('treats real request logs (with duration) as non-summary', () => {
    expect(isSummaryLog(makeSaved({ jobId: 1, timestamp: 't', durationMs: 300, jobDetail: 'Search: "x" (kw#1)' }))).toBe(false);
  });

  it('falls back to the body pattern for pre-0.31.0 summaries without a kind', () => {
    const legacy = makeSaved({
      jobId: 1, timestamp: 't', durationMs: 0, responsePreview: '', error: null,
      jobDetail: 'Page 2 for "x": 28 results, 2/2 tracked found, stopping: all_tracked_found',
    });
    expect(isSummaryLog(legacy)).toBe(true);
  });

  it('does not mistake page error logs for summaries', () => {
    const httpErr = makeSaved({ jobId: 1, timestamp: 't', level: 'warn', durationMs: 0, error: 'CWS returned HTTP 429', jobDetail: 'Page 2 HTTP 429 for "x"' });
    const fetchErr = makeSaved({ jobId: 1, timestamp: 't', level: 'warn', durationMs: 0, error: 'Network timeout', jobDetail: 'Page 2 fetch failed for "x": Network timeout' });
    expect(isSummaryLog(httpErr)).toBe(false);
    expect(isSummaryLog(fetchErr)).toBe(false);
  });
});

describe('groupLogsByJob', () => {
  beforeEach(() => {
    nextId = 1;
  });

  it('folds each per-page summary into its request row for a paginated keyword job', () => {
    const day = '2026-06-08';
    // Stored newest-first (reverse-chronological), as getRecentScanLogs returns.
    const logs: SavedScanLog[] = [
      makeSaved({ id: 4, jobId: 42, timestamp: `${day}T11:35:26.500Z`, pageNumber: 2, kind: 'summary', jobDetail: 'Page 2 for "ad blocker": 28 results, 2/2 tracked found, stopping: all_tracked_found' }),
      makeSaved({ id: 3, jobId: 42, timestamp: `${day}T11:35:26.000Z`, pageNumber: 2, durationMs: 450, responsePreview: '<html>p2', jobDetail: 'Search: "ad blocker" (kw#5)' }),
      makeSaved({ id: 2, jobId: 42, timestamp: `${day}T11:35:23.500Z`, pageNumber: 1, kind: 'summary', jobDetail: 'Page 1 for "ad blocker": 30 results, 1/2 tracked found, continuing' }),
      makeSaved({ id: 1, jobId: 42, timestamp: `${day}T11:35:23.000Z`, pageNumber: 1, durationMs: 400, responsePreview: '<html>p1', jobDetail: 'Search: "ad blocker" (kw#5)' }),
    ];

    const groups = groupLogsByJob(logs);
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe(day);
    expect(groups[0].jobs).toHaveLength(1);

    const job = groups[0].jobs[0];
    expect(job.jobId).toBe(42);
    expect(job.title).toBe('Search: "ad blocker" (kw#5)');
    expect(job.totalDurationMs).toBe(850); // 400 + 450, summaries contribute 0
    expect(job.entries).toHaveLength(2); // one row per real request, not 4 rows

    // Ascending page order with summaries folded in.
    expect(job.entries[0].log.pageNumber).toBe(1);
    expect(job.entries[0].log.responsePreview).toBe('<html>p1');
    expect(job.entries[0].summaryText).toBe('30 results, 1/2 tracked found, continuing');
    expect(job.entries[1].log.pageNumber).toBe(2);
    expect(job.entries[1].summaryText).toBe('28 results, 2/2 tracked found, stopping: all_tracked_found');
  });

  it('renders a single-request job (listing) as one entry with no summary', () => {
    const logs: SavedScanLog[] = [
      makeSaved({ jobId: 7, timestamp: '2026-06-08T10:00:00.000Z', jobType: 'listing_scan', durationMs: 512, jobDetail: 'Listing: uBlock Origin (cjpalhdl...)' }),
    ];
    const groups = groupLogsByJob(logs);
    const job = groups[0].jobs[0];
    expect(job.entries).toHaveLength(1);
    expect(job.entries[0].summary).toBeNull();
    expect(job.entries[0].summaryText).toBeNull();
    expect(job.title).toBe('Listing: uBlock Origin (cjpalhdl...)');
  });

  it('separates consecutive logs from different jobs into distinct groups', () => {
    const logs: SavedScanLog[] = [
      makeSaved({ jobId: 8, timestamp: '2026-06-08T10:05:00.000Z', jobType: 'listing_scan', durationMs: 300, jobDetail: 'Listing: B' }),
      makeSaved({ jobId: 7, timestamp: '2026-06-08T10:00:00.000Z', jobType: 'listing_scan', durationMs: 200, jobDetail: 'Listing: A' }),
    ];
    const groups = groupLogsByJob(logs);
    expect(groups).toHaveLength(1); // same day
    expect(groups[0].jobs).toHaveLength(2);
    expect(groups[0].jobs[0].jobId).toBe(8); // newest first
    expect(groups[0].jobs[1].jobId).toBe(7);
  });

  it('folds a page-2 HTTP error diagnostic into its request row and escalates level', () => {
    // Production shape for a page-2 HTTP error: the real fetch log (warn, has the
    // error-page body) plus a kind:'summary' "Page 2 HTTP ..." diagnostic, both
    // pageNumber 2 — so the page still collapses to a single row.
    const logs: SavedScanLog[] = [
      makeSaved({ jobId: 9, timestamp: '2026-06-08T10:00:03.000Z', level: 'warn', pageNumber: 2, kind: 'summary', error: 'CWS returned HTTP 429', jobDetail: 'Page 2 HTTP 429 for "x"' }),
      makeSaved({ jobId: 9, timestamp: '2026-06-08T10:00:02.000Z', level: 'warn', pageNumber: 2, durationMs: 380, responseStatus: 429, responsePreview: '<html>err', jobDetail: 'Search: "x" (kw#1)' }),
      makeSaved({ jobId: 9, timestamp: '2026-06-08T10:00:01.000Z', level: 'info', pageNumber: 1, kind: 'summary', jobDetail: 'Page 1 for "x": 30 results, 0/1 tracked found, continuing' }),
      makeSaved({ jobId: 9, timestamp: '2026-06-08T10:00:00.000Z', level: 'info', pageNumber: 1, durationMs: 410, responsePreview: '<html>p1', jobDetail: 'Search: "x" (kw#1)' }),
    ];
    const job = groupLogsByJob(logs)[0].jobs[0];
    expect(job.level).toBe('warn');
    // Exactly one row per page (2), not four — the error diagnostic folds in too.
    expect(job.entries).toHaveLength(2);
    const page2 = job.entries[1];
    expect(page2.log.pageNumber).toBe(2);
    expect(page2.log.responsePreview).toBe('<html>err'); // primary = the real fetch
    expect(page2.summary?.jobDetail).toBe('Page 2 HTTP 429 for "x"'); // diagnostic folded
    expect(page2.summary?.error).toBe('CWS returned HTTP 429');
    expect(page2.summaryText).toBe('Page 2 HTTP 429 for "x"'); // no success prefix to strip
  });

  it('buckets jobs spanning two local days into separate date groups', () => {
    const logs: SavedScanLog[] = [
      makeSaved({ jobId: 2, timestamp: localIso('2026-06-08', 0, 10), jobType: 'listing_scan', durationMs: 100, jobDetail: 'Listing: today' }),
      makeSaved({ jobId: 1, timestamp: localIso('2026-06-07', 23, 50), jobType: 'listing_scan', durationMs: 100, jobDetail: 'Listing: yesterday' }),
    ];
    const groups = groupLogsByJob(logs);
    expect(groups).toHaveLength(2);
    expect(groups[0].date).toBe('2026-06-08');
    expect(groups[1].date).toBe('2026-06-07');
  });

  it('keeps one local day in one date group even when its UTC date differs', () => {
    // 00:10 and 23:50 local on the same day straddle UTC midnight in most
    // zones; the page must not render the same "Jun 8" header twice.
    const logs: SavedScanLog[] = [
      makeSaved({ jobId: 2, timestamp: localIso('2026-06-08', 23, 50), jobType: 'listing_scan', durationMs: 100, jobDetail: 'Listing: late' }),
      makeSaved({ jobId: 1, timestamp: localIso('2026-06-08', 0, 10), jobType: 'listing_scan', durationMs: 100, jobDetail: 'Listing: early' }),
    ];
    const groups = groupLogsByJob(logs);
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe('2026-06-08');
    expect(groups[0].jobs).toHaveLength(2);
  });
});

describe('localDateOf', () => {
  it('returns the local calendar date of an ISO timestamp', () => {
    const now = new Date(2026, 5, 8, 0, 10); // local
    expect(localDateOf(now.toISOString())).toBe(toDateString(now));
    expect(localDateOf(now.toISOString())).toBe('2026-06-08');
  });

  it('falls back to the literal date prefix for an unparseable timestamp', () => {
    expect(localDateOf('2026-06-08Tgarbage')).toBe('2026-06-08');
  });
});
