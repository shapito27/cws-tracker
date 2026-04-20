/**
 * Tests for useScanLogs composable - focused on the weeklyStats aggregation
 * that feeds the daily request stats chart on the Logs page.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import { useScanLogs } from '@/dashboard/composables/useScanLogs';
import type { ScanLog, ScanLogLevel } from '@/shared/types';
import { daysAgo } from '@/shared/utils/dates';

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
});
