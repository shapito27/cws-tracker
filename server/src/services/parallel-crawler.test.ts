import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelCrawler, type CrawlJob, type CrawlOptions } from './parallel-crawler.js';
import type { ProxyRotator } from './proxy-rotator.js';

vi.mock('../db/queries.js', () => ({
  getCrawlCache: vi.fn().mockResolvedValue(null),
  saveCrawlResult: vi.fn().mockResolvedValue(undefined),
  getProxyHealth: vi.fn().mockResolvedValue(null),
  upsertProxyHealth: vi.fn().mockResolvedValue(undefined),
}));

import { getCrawlCache, saveCrawlResult } from '../db/queries.js';

const directProxy = { id: 'direct', url: null, type: 'direct' as const, weight: 10, maxConsecutiveFailures: 5 };

function createMockRotator(overrides: Partial<ProxyRotator> = {}): ProxyRotator {
  return {
    getNextProxy: vi.fn().mockResolvedValue(directProxy),
    reportSuccess: vi.fn().mockResolvedValue(undefined),
    reportFailure: vi.fn().mockResolvedValue(undefined),
    getHealthReport: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as ProxyRotator;
}

function createMockFetcher() {
  return {
    fetchDetail: vi.fn().mockResolvedValue({
      url: 'https://cws/detail/abc', status: 200,
      html: '<html>"cfb2h":"bl"</html>', htmlLength: 30, fetchedAt: new Date().toISOString(),
    }),
    fetchSearch: vi.fn().mockResolvedValue({
      url: 'https://cws/search/q', status: 200,
      html: '<html>search</html>', htmlLength: 20, fetchedAt: new Date().toISOString(),
    }),
    fetchAutocomplete: vi.fn().mockResolvedValue({
      query: 'q', hl: 'en', data: '[]', fetchedAt: new Date().toISOString(),
    }),
  };
}

const fastOpts: CrawlOptions = { concurrency: 2, delayMs: 0, jitterMs: 0 };

describe('ParallelCrawler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCrawlCache).mockResolvedValue(null);
  });

  describe('basic crawling', () => {
    it('crawls listing jobs and stores parsed results', async () => {
      const fetcher = createMockFetcher();
      const rotator = createMockRotator();
      const crawler = new ParallelCrawler(fetcher, rotator, fastOpts);

      const jobs: CrawlJob[] = [
        { cacheKey: 'detail:abc:en', type: 'listing', params: { id: 'a'.repeat(32), locale: 'en' }, priority: 1 },
      ];

      const report = await crawler.crawl(jobs);
      expect(report.successful).toBe(1);
      expect(report.failed).toBe(0);
      expect(fetcher.fetchDetail).toHaveBeenCalledOnce();
      expect(saveCrawlResult).toHaveBeenCalledOnce();
    });

    it('crawls keyword search jobs', async () => {
      const fetcher = createMockFetcher();
      const crawler = new ParallelCrawler(fetcher, createMockRotator(), fastOpts);

      const jobs: CrawlJob[] = [
        { cacheKey: 'search:ad blocker:en:1', type: 'keyword', params: { query: 'ad blocker', locale: 'en' }, priority: 3 },
      ];

      const report = await crawler.crawl(jobs);
      expect(report.successful).toBe(1);
      expect(fetcher.fetchSearch).toHaveBeenCalledOnce();
    });

    it('crawls autocomplete jobs', async () => {
      const fetcher = createMockFetcher();
      const crawler = new ParallelCrawler(fetcher, createMockRotator(), fastOpts);

      const jobs: CrawlJob[] = [
        { cacheKey: 'ac:ad:en', type: 'autocomplete', params: { query: 'ad', locale: 'en' }, priority: 2 },
      ];

      const report = await crawler.crawl(jobs);
      expect(report.successful).toBe(1);
      expect(fetcher.fetchAutocomplete).toHaveBeenCalledOnce();
    });

    it('crawls multiple jobs concurrently', async () => {
      const fetcher = createMockFetcher();
      const crawler = new ParallelCrawler(fetcher, createMockRotator(), { ...fastOpts, concurrency: 3 });

      const jobs: CrawlJob[] = [
        { cacheKey: 'detail:aaa:en', type: 'listing', params: { id: 'a'.repeat(32), locale: 'en' }, priority: 1 },
        { cacheKey: 'detail:bbb:en', type: 'listing', params: { id: 'b'.repeat(32), locale: 'en' }, priority: 1 },
        { cacheKey: 'search:q:en:1', type: 'keyword', params: { query: 'q', locale: 'en' }, priority: 3 },
      ];

      const report = await crawler.crawl(jobs);
      expect(report.successful).toBe(3);
      expect(report.failed).toBe(0);
    });

    it('returns empty report for empty jobs list', async () => {
      const fetcher = createMockFetcher();
      const crawler = new ParallelCrawler(fetcher, createMockRotator(), fastOpts);

      const report = await crawler.crawl([]);
      expect(report.successful).toBe(0);
      expect(report.failed).toBe(0);
      expect(report.skipped).toBe(0);
    });
  });

  describe('caching', () => {
    it('skips jobs that already have results for today', async () => {
      vi.mocked(getCrawlCache).mockResolvedValue({
        cache_key: 'detail:abc:en', date: '2026-04-23',
        scan_type: 'listing', result: {}, status_code: 200, fetched_at: new Date(),
      });

      const fetcher = createMockFetcher();
      const crawler = new ParallelCrawler(fetcher, createMockRotator(), fastOpts);

      const jobs: CrawlJob[] = [
        { cacheKey: 'detail:abc:en', type: 'listing', params: { id: 'a'.repeat(32), locale: 'en' }, priority: 1 },
      ];

      const report = await crawler.crawl(jobs);
      expect(report.cached).toBe(1);
      expect(report.successful).toBe(0);
      expect(fetcher.fetchDetail).not.toHaveBeenCalled();
    });
  });

  describe('priority ordering', () => {
    it('processes detail jobs before search jobs', async () => {
      const callOrder: string[] = [];
      const fetcher = createMockFetcher();
      fetcher.fetchDetail.mockImplementation(async () => {
        callOrder.push('detail');
        return { url: '', status: 200, html: '', htmlLength: 0, fetchedAt: '' };
      });
      fetcher.fetchSearch.mockImplementation(async () => {
        callOrder.push('search');
        return { url: '', status: 200, html: '', htmlLength: 0, fetchedAt: '' };
      });

      const crawler = new ParallelCrawler(fetcher, createMockRotator(), { ...fastOpts, concurrency: 1 });
      const jobs: CrawlJob[] = [
        { cacheKey: 'search:q:en:1', type: 'keyword', params: { query: 'q', locale: 'en' }, priority: 3 },
        { cacheKey: 'detail:abc:en', type: 'listing', params: { id: 'a'.repeat(32), locale: 'en' }, priority: 1 },
      ];

      await crawler.crawl(jobs);
      expect(callOrder[0]).toBe('detail');
      expect(callOrder[1]).toBe('search');
    });
  });

  describe('error handling', () => {
    it('retries on 429 with proxy rotation', async () => {
      const fetcher = createMockFetcher();
      const rotator = createMockRotator();
      let callCount = 0;
      fetcher.fetchDetail.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) throw Object.assign(new Error('Rate limited'), { statusCode: 429 });
        return { url: '', status: 200, html: '', htmlLength: 0, fetchedAt: '' };
      });

      const crawler = new ParallelCrawler(fetcher, rotator, fastOpts);
      const jobs: CrawlJob[] = [
        { cacheKey: 'detail:abc:en', type: 'listing', params: { id: 'a'.repeat(32), locale: 'en' }, priority: 1 },
      ];

      const report = await crawler.crawl(jobs);
      expect(report.successful).toBe(1);
      expect(rotator.reportFailure).toHaveBeenCalledTimes(2);
      expect(rotator.reportSuccess).toHaveBeenCalledTimes(1);
    });

    it('marks job as failed after max retries', async () => {
      const fetcher = createMockFetcher();
      fetcher.fetchDetail.mockRejectedValue(Object.assign(new Error('blocked'), { statusCode: 403 }));

      const crawler = new ParallelCrawler(fetcher, createMockRotator(), fastOpts);
      const jobs: CrawlJob[] = [
        { cacheKey: 'detail:abc:en', type: 'listing', params: { id: 'a'.repeat(32), locale: 'en' }, priority: 1 },
      ];

      const report = await crawler.crawl(jobs);
      expect(report.failed).toBe(1);
      expect(report.successful).toBe(0);
      expect(report.failures).toHaveLength(1);
      expect(report.failures[0]!.cacheKey).toBe('detail:abc:en');
    });

    it('continues with remaining jobs when one fails permanently', async () => {
      const fetcher = createMockFetcher();
      const jobIds: string[] = [];
      fetcher.fetchDetail.mockImplementation(async (id: string) => {
        jobIds.push(id);
        if (id === 'a'.repeat(32)) throw Object.assign(new Error('fail'), { statusCode: 403 });
        return { url: '', status: 200, html: '', htmlLength: 0, fetchedAt: '' };
      });

      const crawler = new ParallelCrawler(fetcher, createMockRotator(), { ...fastOpts, concurrency: 1 });
      const jobs: CrawlJob[] = [
        { cacheKey: 'detail:aaa:en', type: 'listing', params: { id: 'a'.repeat(32), locale: 'en' }, priority: 1 },
        { cacheKey: 'detail:bbb:en', type: 'listing', params: { id: 'b'.repeat(32), locale: 'en' }, priority: 1 },
      ];

      const report = await crawler.crawl(jobs);
      expect(report.failed).toBe(1);
      expect(report.successful).toBe(1);
    });

    it('reports duration in the crawl report', async () => {
      const fetcher = createMockFetcher();
      const crawler = new ParallelCrawler(fetcher, createMockRotator(), fastOpts);

      const report = await crawler.crawl([
        { cacheKey: 'detail:abc:en', type: 'listing', params: { id: 'a'.repeat(32), locale: 'en' }, priority: 1 },
      ]);

      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('tracks per-proxy stats', async () => {
      const fetcher = createMockFetcher();
      const crawler = new ParallelCrawler(fetcher, createMockRotator(), fastOpts);

      const report = await crawler.crawl([
        { cacheKey: 'detail:abc:en', type: 'listing', params: { id: 'a'.repeat(32), locale: 'en' }, priority: 1 },
      ]);

      expect(report.proxyStats['direct']).toBeDefined();
      expect(report.proxyStats['direct']!.ok).toBe(1);
    });
  });
});
