import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CrawlOrchestrator } from './crawl-orchestrator.js';
import type { ParallelCrawler, CrawlReport, CrawlJob } from './parallel-crawler.js';

vi.mock('../db/queries.js', () => ({
  getProScanConfigs: vi.fn(),
  insertScanResults: vi.fn().mockResolvedValue(undefined),
  insertCrawlRun: vi.fn().mockResolvedValue(undefined),
  getCrawlCache: vi.fn().mockResolvedValue(null),
  saveCrawlResult: vi.fn().mockResolvedValue(undefined),
  getProxyHealth: vi.fn().mockResolvedValue(null),
  upsertProxyHealth: vi.fn().mockResolvedValue(undefined),
}));

import { getProScanConfigs, insertScanResults, insertCrawlRun } from '../db/queries.js';

function successReport(jobCount: number): CrawlReport {
  return {
    successful: jobCount, failed: 0, skipped: 0, cached: 0,
    durationMs: 100, proxyStats: { direct: { ok: jobCount, fail: 0 } }, failures: [],
  };
}

function createMockCrawler(reportFn?: (jobs: CrawlJob[]) => CrawlReport): ParallelCrawler {
  return {
    crawl: vi.fn().mockImplementation(async (jobs: CrawlJob[]) => {
      return reportFn ? reportFn(jobs) : successReport(jobs.length);
    }),
  } as unknown as ParallelCrawler;
}

describe('CrawlOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runDailyScan', () => {
    it('collects jobs from all Pro users and crawls them', async () => {
      vi.mocked(getProScanConfigs).mockResolvedValue([
        {
          userId: 'user-1',
          projects: [{
            id: 1, ownExtensionId: 'a'.repeat(32),
            competitorIds: ['b'.repeat(32)],
            keywordTexts: ['ad blocker'],
          }],
        },
      ]);

      const crawler = createMockCrawler();
      const orchestrator = new CrawlOrchestrator(crawler);

      const report = await orchestrator.runDailyScan();

      expect(crawler.crawl).toHaveBeenCalledOnce();
      const jobs = vi.mocked(crawler.crawl).mock.calls[0]![0];
      // 2 listing jobs (own + competitor) + 1 keyword + 1 autocomplete = 4
      expect(jobs).toHaveLength(4);
      expect(report.successful).toBe(4);
    });

    it('deduplicates jobs across users', async () => {
      const sharedExt = 'a'.repeat(32);
      vi.mocked(getProScanConfigs).mockResolvedValue([
        {
          userId: 'user-1',
          projects: [{ id: 1, ownExtensionId: sharedExt, competitorIds: [], keywordTexts: ['vpn'] }],
        },
        {
          userId: 'user-2',
          projects: [{ id: 2, ownExtensionId: sharedExt, competitorIds: [], keywordTexts: ['vpn'] }],
        },
      ]);

      const crawler = createMockCrawler();
      const orchestrator = new CrawlOrchestrator(crawler);

      await orchestrator.runDailyScan();

      const jobs = vi.mocked(crawler.crawl).mock.calls[0]![0];
      // Shared extension: 1 listing. Shared keyword: 1 search + 1 AC = 3 total (not 6)
      expect(jobs).toHaveLength(3);
    });

    it('creates scan_results for each user after crawling', async () => {
      vi.mocked(getProScanConfigs).mockResolvedValue([
        {
          userId: 'user-1',
          projects: [{ id: 1, ownExtensionId: 'a'.repeat(32), competitorIds: [], keywordTexts: ['test'] }],
        },
      ]);

      const crawler = createMockCrawler();
      const orchestrator = new CrawlOrchestrator(crawler);

      await orchestrator.runDailyScan();

      expect(insertScanResults).toHaveBeenCalledOnce();
      const results = vi.mocked(insertScanResults).mock.calls[0]![0];
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.user_id).toBe('user-1');
    });

    it('fans out shared crawl results to multiple users', async () => {
      const sharedExt = 'a'.repeat(32);
      vi.mocked(getProScanConfigs).mockResolvedValue([
        {
          userId: 'user-1',
          projects: [{ id: 1, ownExtensionId: sharedExt, competitorIds: [], keywordTexts: [] }],
        },
        {
          userId: 'user-2',
          projects: [{ id: 2, ownExtensionId: sharedExt, competitorIds: [], keywordTexts: [] }],
        },
      ]);

      const crawler = createMockCrawler();
      const orchestrator = new CrawlOrchestrator(crawler);

      await orchestrator.runDailyScan();

      // Both users should get scan_results for the same extension
      expect(insertScanResults).toHaveBeenCalledTimes(2);
      const user1Results = vi.mocked(insertScanResults).mock.calls[0]![0];
      const user2Results = vi.mocked(insertScanResults).mock.calls[1]![0];
      expect(user1Results[0]!.user_id).toBe('user-1');
      expect(user2Results[0]!.user_id).toBe('user-2');
    });

    it('logs crawl run after completion', async () => {
      vi.mocked(getProScanConfigs).mockResolvedValue([
        {
          userId: 'user-1',
          projects: [{ id: 1, ownExtensionId: 'a'.repeat(32), competitorIds: [], keywordTexts: [] }],
        },
      ]);

      const crawler = createMockCrawler();
      const orchestrator = new CrawlOrchestrator(crawler);

      await orchestrator.runDailyScan();

      expect(insertCrawlRun).toHaveBeenCalledOnce();
    });

    it('handles zero Pro users gracefully', async () => {
      vi.mocked(getProScanConfigs).mockResolvedValue([]);

      const crawler = createMockCrawler();
      const orchestrator = new CrawlOrchestrator(crawler);

      const report = await orchestrator.runDailyScan();
      expect(report.successful).toBe(0);
      expect(crawler.crawl).toHaveBeenCalledWith([]);
    });

    it('handles Pro user with empty projects', async () => {
      vi.mocked(getProScanConfigs).mockResolvedValue([
        { userId: 'user-1', projects: [] },
      ]);

      const crawler = createMockCrawler();
      const orchestrator = new CrawlOrchestrator(crawler);

      const report = await orchestrator.runDailyScan();
      expect(report.successful).toBe(0);
    });

    it('handles multiple projects per user', async () => {
      vi.mocked(getProScanConfigs).mockResolvedValue([
        {
          userId: 'user-1',
          projects: [
            { id: 1, ownExtensionId: 'a'.repeat(32), competitorIds: [], keywordTexts: ['kw1'] },
            { id: 2, ownExtensionId: 'b'.repeat(32), competitorIds: [], keywordTexts: ['kw2'] },
          ],
        },
      ]);

      const crawler = createMockCrawler();
      const orchestrator = new CrawlOrchestrator(crawler);

      await orchestrator.runDailyScan();

      const jobs = vi.mocked(crawler.crawl).mock.calls[0]![0];
      // 2 listings + 2 keywords + 2 autocomplete = 6
      expect(jobs).toHaveLength(6);
    });

    it('assigns correct priorities: listing=1, autocomplete=2, keyword=3', async () => {
      vi.mocked(getProScanConfigs).mockResolvedValue([
        {
          userId: 'user-1',
          projects: [{ id: 1, ownExtensionId: 'a'.repeat(32), competitorIds: [], keywordTexts: ['test'] }],
        },
      ]);

      const crawler = createMockCrawler();
      const orchestrator = new CrawlOrchestrator(crawler);

      await orchestrator.runDailyScan();

      const jobs = vi.mocked(crawler.crawl).mock.calls[0]![0] as CrawlJob[];
      const listing = jobs.find(j => j.type === 'listing');
      const keyword = jobs.find(j => j.type === 'keyword');
      const ac = jobs.find(j => j.type === 'autocomplete');
      expect(listing!.priority).toBe(1);
      expect(ac!.priority).toBe(2);
      expect(keyword!.priority).toBe(3);
    });

    it('prevents overlapping runs', async () => {
      vi.mocked(getProScanConfigs).mockResolvedValue([
        {
          userId: 'user-1',
          projects: [{ id: 1, ownExtensionId: 'a'.repeat(32), competitorIds: [], keywordTexts: [] }],
        },
      ]);

      let resolveFirst: () => void;
      const firstCrawlPromise = new Promise<void>(r => { resolveFirst = r; });

      const crawler = {
        crawl: vi.fn()
          .mockImplementationOnce(async (jobs: CrawlJob[]) => {
            await firstCrawlPromise;
            return successReport(jobs.length);
          })
          .mockImplementation(async (jobs: CrawlJob[]) => successReport(jobs.length)),
      } as unknown as ParallelCrawler;

      const orchestrator = new CrawlOrchestrator(crawler);

      const run1 = orchestrator.runDailyScan();
      const run2 = orchestrator.runDailyScan();

      const report2 = await run2;
      expect(report2.skipped).toBeGreaterThanOrEqual(0);
      // Second run should be skipped (returns immediately)
      expect(report2.durationMs).toBeLessThan(50);

      resolveFirst!();
      await run1;
    });
  });
});
