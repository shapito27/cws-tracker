import { Router } from 'express';
import { requirePro } from '../middleware/auth.js';
import { config } from '../config.js';
import {
  updateUserPlan, upsertScanConfig, getScanConfig,
  getUserScanResults, getLatestCrawlRun,
} from '../db/queries.js';

const router = Router();

router.put('/license', async (req, res) => {
  const { licenseKey } = req.body as { licenseKey?: string };
  if (!licenseKey || typeof licenseKey !== 'string') {
    res.status(400).json({ error: 'Missing licenseKey.' });
    return;
  }

  if (licenseKey !== config.proLicenseKey) {
    res.status(403).json({ error: 'Invalid license key.' });
    return;
  }

  await updateUserPlan(req.user!.id, 'pro', licenseKey);
  res.json({ plan: 'pro', validUntil: '2027-01-01' });
});

router.put('/scan-configs', requirePro, async (req, res) => {
  const { projects } = req.body as { projects?: unknown };
  if (!projects || !Array.isArray(projects)) {
    res.status(400).json({ error: 'Missing or invalid projects array.' });
    return;
  }

  await upsertScanConfig(req.user!.id, { projects });
  res.json({ ok: true });
});

router.get('/scan-configs', requirePro, async (req, res) => {
  const config = await getScanConfig(req.user!.id);
  if (!config) {
    res.json({ projects: [] });
    return;
  }
  res.json(config.config);
});

router.get('/results', requirePro, async (req, res) => {
  const since = (req.query['since'] as string) || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const rows = await getUserScanResults(req.user!.id, since);

  const grouped = new Map<string, { listings: unknown[]; rankings: unknown[]; autocomplete: unknown[] }>();
  for (const row of rows) {
    if (!grouped.has(row.date)) {
      grouped.set(row.date, { listings: [], rankings: [], autocomplete: [] });
    }
    const day = grouped.get(row.date)!;
    if (row.scan_type === 'listing') {
      day.listings.push({ queryKey: row.query_key, data: row.result });
    } else if (row.scan_type === 'keyword') {
      day.rankings.push({ queryKey: row.query_key, data: row.result });
    } else if (row.scan_type === 'autocomplete') {
      day.autocomplete.push({ queryKey: row.query_key, data: row.result });
    }
  }

  const results = [...grouped.entries()].map(([date, data]) => ({ date, ...data }));
  res.json({ results, hasMore: false });
});

router.get('/crawl-status', requirePro, async (req, res) => {
  const run = await getLatestCrawlRun();
  if (!run) {
    res.json({ lastRun: null, successful: 0, failed: 0, nextRun: null });
    return;
  }
  res.json({
    lastRun: run.run_at,
    successful: run.successful,
    failed: run.failed,
    nextRun: new Date(new Date(run.run_at).getTime() + 86400_000).toISOString(),
  });
});

export default router;
