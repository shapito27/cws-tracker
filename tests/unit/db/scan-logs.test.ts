/**
 * Tests for scan_logs DB methods.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CWSDatabase } from '@/shared/db/database';
import type { ScanLog } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScanLog(overrides: Partial<ScanLog> = {}): ScanLog {
  return {
    timestamp: new Date().toISOString(),
    jobId: 1,
    jobType: 'listing_scan',
    level: 'info',
    requestUrl: 'https://chromewebstore.google.com/detail/test',
    responseStatus: 200,
    responsePreview: '<html>...',
    durationMs: 350,
    jobDetail: 'Scanning extension testtest...',
    error: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let dbCounter = 0;

describe('CWSDatabase - Scan Log Methods', () => {
  let db: CWSDatabase;

  beforeEach(() => {
    db = new CWSDatabase(`TestScanLogDB_${++dbCounter}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  describe('saveScanLog', () => {
    it('saves a log entry and returns auto-increment ID', async () => {
      const id = await db.saveScanLog(makeScanLog());
      expect(id).toBeGreaterThan(0);
    });

    it('saves multiple log entries with unique IDs', async () => {
      const id1 = await db.saveScanLog(makeScanLog({ jobId: 1 }));
      const id2 = await db.saveScanLog(makeScanLog({ jobId: 2 }));
      expect(id1).not.toBe(id2);
    });

    it('stores all fields correctly', async () => {
      const log = makeScanLog({
        jobId: 42,
        jobType: 'keyword_scan',
        level: 'error',
        requestUrl: 'https://proxy.example.com/search?q=test',
        responseStatus: 429,
        responsePreview: 'rate limited',
        durationMs: 1200,
        jobDetail: 'Searching "test"',
        error: 'HTTP 429: Too Many Requests',
      });
      const id = await db.saveScanLog(log);

      const saved = await db.scan_logs.get(id);
      expect(saved).toBeDefined();
      expect(saved!.jobId).toBe(42);
      expect(saved!.jobType).toBe('keyword_scan');
      expect(saved!.level).toBe('error');
      expect(saved!.requestUrl).toBe('https://proxy.example.com/search?q=test');
      expect(saved!.responseStatus).toBe(429);
      expect(saved!.responsePreview).toBe('rate limited');
      expect(saved!.durationMs).toBe(1200);
      expect(saved!.jobDetail).toBe('Searching "test"');
      expect(saved!.error).toBe('HTTP 429: Too Many Requests');
    });

    it('handles null jobId for logs not tied to a specific job', async () => {
      const id = await db.saveScanLog(makeScanLog({ jobId: null }));
      const saved = await db.scan_logs.get(id);
      expect(saved!.jobId).toBeNull();
    });

    it('handles null responseStatus for network errors', async () => {
      const id = await db.saveScanLog(makeScanLog({ responseStatus: null }));
      const saved = await db.scan_logs.get(id);
      expect(saved!.responseStatus).toBeNull();
    });

    it('stores httpMethod and pageNumber when provided', async () => {
      const id = await db.saveScanLog(makeScanLog({
        httpMethod: 'GET',
        pageNumber: 2,
      }));
      const saved = await db.scan_logs.get(id);
      expect(saved!.httpMethod).toBe('GET');
      expect(saved!.pageNumber).toBe(2);
    });

    it('works without httpMethod and pageNumber (backwards compat)', async () => {
      // Simulate a pre-0.17.0 log entry without the new fields
      const oldLog: ScanLog = {
        timestamp: new Date().toISOString(),
        jobId: 1,
        jobType: 'listing_scan',
        level: 'info',
        requestUrl: 'https://chromewebstore.google.com/detail/test',
        responseStatus: 200,
        responsePreview: '<html>...',
        durationMs: 350,
        jobDetail: 'Scanning extension testtest...',
        error: null,
      };
      const id = await db.saveScanLog(oldLog);
      const saved = await db.scan_logs.get(id);
      expect(saved!.httpMethod).toBeUndefined();
      expect(saved!.pageNumber).toBeUndefined();
    });
  });

  describe('getRecentScanLogs', () => {
    it('returns empty array when no logs exist', async () => {
      const logs = await db.getRecentScanLogs(10);
      expect(logs).toEqual([]);
    });

    it('returns logs in reverse order (most recent first)', async () => {
      await db.saveScanLog(makeScanLog({ jobDetail: 'first' }));
      await db.saveScanLog(makeScanLog({ jobDetail: 'second' }));
      await db.saveScanLog(makeScanLog({ jobDetail: 'third' }));

      const logs = await db.getRecentScanLogs(10);
      expect(logs).toHaveLength(3);
      expect(logs[0].jobDetail).toBe('third');
      expect(logs[1].jobDetail).toBe('second');
      expect(logs[2].jobDetail).toBe('first');
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await db.saveScanLog(makeScanLog({ jobDetail: `log-${i}` }));
      }

      const logs = await db.getRecentScanLogs(3);
      expect(logs).toHaveLength(3);
    });
  });

  describe('getScanLogsByJob', () => {
    it('returns only logs for the specified jobId', async () => {
      await db.saveScanLog(makeScanLog({ jobId: 10, jobDetail: 'job-10' }));
      await db.saveScanLog(makeScanLog({ jobId: 20, jobDetail: 'job-20' }));
      await db.saveScanLog(makeScanLog({ jobId: 10, jobDetail: 'job-10-retry' }));

      const logs = await db.getScanLogsByJob(10);
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.jobId === 10)).toBe(true);
    });

    it('returns empty array when no logs match', async () => {
      await db.saveScanLog(makeScanLog({ jobId: 1 }));
      const logs = await db.getScanLogsByJob(999);
      expect(logs).toEqual([]);
    });
  });

  describe('cleanupOldScanLogs', () => {
    it('deletes logs older than the cutoff date', async () => {
      const oldTimestamp = new Date('2026-01-01T00:00:00Z').toISOString();
      const newTimestamp = new Date('2026-02-05T00:00:00Z').toISOString();

      await db.saveScanLog(makeScanLog({ timestamp: oldTimestamp, jobDetail: 'old' }));
      await db.saveScanLog(makeScanLog({ timestamp: newTimestamp, jobDetail: 'new' }));

      const cutoff = new Date('2026-01-15T00:00:00Z');
      const deleted = await db.cleanupOldScanLogs(cutoff);

      expect(deleted).toBe(1);
      const remaining = await db.scan_logs.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].jobDetail).toBe('new');
    });

    it('returns 0 when no logs are older than cutoff', async () => {
      const recentTimestamp = new Date('2026-02-06T00:00:00Z').toISOString();
      await db.saveScanLog(makeScanLog({ timestamp: recentTimestamp }));

      const cutoff = new Date('2026-01-01T00:00:00Z');
      const deleted = await db.cleanupOldScanLogs(cutoff);
      expect(deleted).toBe(0);
    });

    it('returns 0 when no logs exist', async () => {
      const deleted = await db.cleanupOldScanLogs(new Date());
      expect(deleted).toBe(0);
    });
  });
});
