import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { proxyRateLimit } from './middleware/rate-limit.js';
import authRouter from './routes/auth.js';
import proxyRouter from './routes/proxy.js';
import apiRouter from './routes/api.js';
import healthRouter from './routes/health.js';
import { ProxyRotator } from './services/proxy-rotator.js';
import { ParallelCrawler } from './services/parallel-crawler.js';
import { CrawlOrchestrator } from './services/crawl-orchestrator.js';
import * as cwsFetcher from './services/cws-fetcher.js';

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

app.use(express.json());

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/proxy', authMiddleware, proxyRateLimit, proxyRouter);
app.use('/api', authMiddleware, apiRouter);

const rotator = new ProxyRotator(config.proxyPool);
const crawler = new ParallelCrawler(cwsFetcher, rotator, {
  concurrency: 3,
  delayMs: 2000,
  jitterMs: 1000,
});
const orchestrator = new CrawlOrchestrator(crawler);

cron.schedule('0 3 * * *', async () => {
  console.log('[cron] Starting daily scan...');
  try {
    const report = await orchestrator.runDailyScan();
    console.log(
      `[cron] Done: ${report.successful} ok, ${report.failed} failed, ` +
      `${report.skipped} skipped, ${report.cached} cached in ${report.durationMs}ms`,
    );
  } catch (err) {
    console.error('[cron] Fatal error:', err);
  }
});

app.post('/admin/trigger-scan', async (_req, res) => {
  try {
    const report = await orchestrator.runDailyScan();
    res.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

app.listen(config.port, () => {
  console.log(`[server] CWS Tracker server listening on port ${config.port}`);
});
