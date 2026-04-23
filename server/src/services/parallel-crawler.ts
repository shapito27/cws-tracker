import type { ProxyRotator } from './proxy-rotator.js';
import { getCrawlCache, saveCrawlResult } from '../db/queries.js';

export interface CrawlJob {
  cacheKey: string;
  type: 'listing' | 'keyword' | 'autocomplete';
  params: { id?: string; query?: string; locale: string };
  priority: number;
}

export interface CrawlOptions {
  concurrency: number;
  delayMs: number;
  jitterMs: number;
}

export interface CrawlReport {
  successful: number;
  failed: number;
  skipped: number;
  cached: number;
  durationMs: number;
  proxyStats: Record<string, { ok: number; fail: number }>;
  failures: Array<{ cacheKey: string; error: string; lastStatusCode: number }>;
}

interface Fetcher {
  fetchDetail(id: string, hl: string): Promise<{ url: string; status: number; html: string; htmlLength: number; fetchedAt: string }>;
  fetchSearch(query: string, hl: string, token?: string): Promise<{ url: string; status: number; html: string; htmlLength: number; fetchedAt: string }>;
  fetchAutocomplete(query: string, hl: string): Promise<{ query: string; hl: string; data: string; fetchedAt: string }>;
}

const MAX_RETRIES = 3;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jitteredDelay(base: number, jitter: number): number {
  return base + Math.floor(Math.random() * jitter * 2) - jitter;
}

export class ParallelCrawler {
  private fetcher: Fetcher;
  private rotator: ProxyRotator;
  private opts: CrawlOptions;

  constructor(fetcher: Fetcher, rotator: ProxyRotator, opts: CrawlOptions) {
    this.fetcher = fetcher;
    this.rotator = rotator;
    this.opts = opts;
  }

  async crawl(jobs: CrawlJob[]): Promise<CrawlReport> {
    const startTime = Date.now();
    const sorted = [...jobs].sort((a, b) => a.priority - b.priority);

    const report: CrawlReport = {
      successful: 0, failed: 0, skipped: 0, cached: 0,
      durationMs: 0, proxyStats: {}, failures: [],
    };

    if (sorted.length === 0) {
      return report;
    }

    let nextIdx = 0;
    const processNext = async (): Promise<void> => {
      while (nextIdx < sorted.length) {
        const idx = nextIdx++;
        const job = sorted[idx]!;
        await this.processJob(job, report);
        await sleep(jitteredDelay(this.opts.delayMs, this.opts.jitterMs));
      }
    };

    const workers = Array.from(
      { length: Math.min(this.opts.concurrency, sorted.length) },
      () => processNext(),
    );
    await Promise.all(workers);

    report.durationMs = Date.now() - startTime;
    return report;
  }

  private async processJob(job: CrawlJob, report: CrawlReport): Promise<void> {
    const date = todayUTC();

    const cached = await getCrawlCache(job.cacheKey, date);
    if (cached) {
      report.cached++;
      return;
    }

    let lastError = '';
    let lastStatusCode = 0;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let proxyId = 'direct';
      try {
        const proxy = await this.rotator.getNextProxy();
        proxyId = proxy.id;

        const result = await this.executeFetch(job);

        await saveCrawlResult(job.cacheKey, date, job.type, result, 200);

        await this.rotator.reportSuccess(proxyId);
        this.trackProxyStat(report, proxyId, true);
        report.successful++;
        return;
      } catch (err) {
        const error = err as Error & { statusCode?: number };
        lastError = error.message;
        lastStatusCode = error.statusCode ?? 0;

        await this.rotator.reportFailure(proxyId, lastStatusCode);
        this.trackProxyStat(report, proxyId, false);

        const backoffMs = Math.min(2000 * Math.pow(2, attempt), 16000);
        await sleep(this.opts.delayMs > 0 ? backoffMs : 0);
      }
    }

    report.failed++;
    report.failures.push({ cacheKey: job.cacheKey, error: lastError, lastStatusCode });
  }

  private async executeFetch(job: CrawlJob): Promise<unknown> {
    switch (job.type) {
      case 'listing':
        return this.fetcher.fetchDetail(job.params.id!, job.params.locale);
      case 'keyword':
        return this.fetcher.fetchSearch(job.params.query!, job.params.locale);
      case 'autocomplete':
        return this.fetcher.fetchAutocomplete(job.params.query!, job.params.locale);
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  private trackProxyStat(report: CrawlReport, proxyId: string, ok: boolean): void {
    if (!report.proxyStats[proxyId]) {
      report.proxyStats[proxyId] = { ok: 0, fail: 0 };
    }
    if (ok) report.proxyStats[proxyId]!.ok++;
    else report.proxyStats[proxyId]!.fail++;
  }
}
