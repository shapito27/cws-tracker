import type { ParallelCrawler, CrawlJob, CrawlReport } from './parallel-crawler.js';
import { getProScanConfigs, insertScanResults, insertCrawlRun } from '../db/queries.js';

export class CrawlOrchestrator {
  private crawler: ParallelCrawler;
  private runningPromise: Promise<CrawlReport> | null = null;

  constructor(crawler: ParallelCrawler) {
    this.crawler = crawler;
  }

  async runDailyScan(): Promise<CrawlReport> {
    // Atomic check-and-set via promise: concurrent callers during a run
    // all receive the empty report (no duplicated work).
    if (this.runningPromise) {
      return {
        successful: 0, failed: 0, skipped: 0, cached: 0,
        durationMs: 0, proxyStats: {}, failures: [],
      };
    }

    this.runningPromise = this.executeFullScan();
    try {
      return await this.runningPromise;
    } finally {
      this.runningPromise = null;
    }
  }

  private async executeFullScan(): Promise<CrawlReport> {
    const startTime = Date.now();

    try {
      const configs = await getProScanConfigs();

      const uniqueJobs = new Map<string, CrawlJob>();
      const userJobMap = new Map<string, string[]>();

      for (const config of configs) {
        const userKeys: string[] = [];

        for (const project of config.projects) {
          const allExtIds = [project.ownExtensionId, ...project.competitorIds];

          for (const extId of allExtIds) {
            const key = `detail:${extId}:en`;
            if (!uniqueJobs.has(key)) {
              uniqueJobs.set(key, {
                cacheKey: key, type: 'listing',
                params: { id: extId, locale: 'en' }, priority: 1,
              });
            }
            userKeys.push(key);
          }

          for (const keyword of project.keywordTexts) {
            const searchKey = `search:${keyword}:en:1`;
            if (!uniqueJobs.has(searchKey)) {
              uniqueJobs.set(searchKey, {
                cacheKey: searchKey, type: 'keyword',
                params: { query: keyword, locale: 'en' }, priority: 3,
              });
            }
            userKeys.push(searchKey);

            const acKey = `ac:${keyword}:en`;
            if (!uniqueJobs.has(acKey)) {
              uniqueJobs.set(acKey, {
                cacheKey: acKey, type: 'autocomplete',
                params: { query: keyword, locale: 'en' }, priority: 2,
              });
            }
            userKeys.push(acKey);
          }
        }

        userJobMap.set(config.userId, userKeys);
      }

      const report = await this.crawler.crawl([...uniqueJobs.values()]);

      const today = new Date().toISOString().slice(0, 10);
      for (const [userId, cacheKeys] of userJobMap) {
        const dedupedKeys = [...new Set(cacheKeys)];
        const results = dedupedKeys.map(key => ({
          user_id: userId,
          scan_type: uniqueJobs.get(key)!.type,
          query_key: key,
          date: today,
        }));
        if (results.length > 0) {
          await insertScanResults(results);
        }
      }

      await insertCrawlRun({
        total_queries: uniqueJobs.size,
        successful: report.successful,
        failed: report.failed,
        skipped: report.skipped,
        duration_ms: Date.now() - startTime,
        proxy_stats: report.proxyStats,
      });

      return report;
    } catch (err) {
      console.error('[crawl-orchestrator] Fatal error during scan:', err);
      throw err;
    }
  }
}
