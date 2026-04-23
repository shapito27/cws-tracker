import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { requirePro } from '../middleware/auth.js';
import { config } from '../config.js';
import {
  updateUserPlan, upsertScanConfig, getScanConfig,
  getUserScanResults, getLatestCrawlRun,
} from '../db/queries.js';

const router = Router();

// Size limits for scan configs (per-user, even for Pro).
// These prevent accidental or malicious DoS via huge configs.
const MAX_PROJECTS = 100;
const MAX_EXTENSIONS_PER_PROJECT = 50;
const MAX_KEYWORDS_PER_PROJECT = 100;
const MAX_STR_LEN = 200;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Constant-time string comparison. */
function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/** Per-IP rate limit for /license to prevent brute-force. */
const licenseRateLimit = rateLimit({
  windowMs: 3600_000,
  limit: 10,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many license activation attempts. Try again later.' },
});

router.put('/license', licenseRateLimit, async (req, res) => {
  const { licenseKey } = req.body as { licenseKey?: unknown };
  if (!licenseKey || typeof licenseKey !== 'string' || licenseKey.length > MAX_STR_LEN) {
    res.status(400).json({ error: 'Missing or invalid licenseKey.' });
    return;
  }

  if (!safeCompare(licenseKey, config.proLicenseKey)) {
    res.status(403).json({ error: 'Invalid license key.' });
    return;
  }

  await updateUserPlan(req.user!.id, 'pro', licenseKey);
  res.json({ plan: 'pro', validUntil: '2027-01-01' });
});

interface ProjectConfigBody {
  id: number;
  ownExtensionId: string;
  competitorIds: string[];
  keywordTexts: string[];
}

function validateProjects(projects: unknown): string | null {
  if (!Array.isArray(projects)) return 'projects must be an array';
  if (projects.length > MAX_PROJECTS) return `max ${MAX_PROJECTS} projects`;

  for (const p of projects) {
    if (typeof p !== 'object' || p === null) return 'each project must be an object';
    const proj = p as Partial<ProjectConfigBody>;
    if (typeof proj.id !== 'number') return 'project.id must be a number';
    if (typeof proj.ownExtensionId !== 'string' || proj.ownExtensionId.length > MAX_STR_LEN) {
      return 'project.ownExtensionId must be a short string';
    }
    if (!Array.isArray(proj.competitorIds)) return 'project.competitorIds must be an array';
    if (proj.competitorIds.length > MAX_EXTENSIONS_PER_PROJECT) {
      return `max ${MAX_EXTENSIONS_PER_PROJECT} competitors per project`;
    }
    for (const id of proj.competitorIds) {
      if (typeof id !== 'string' || id.length > MAX_STR_LEN) return 'competitorId must be a short string';
    }
    if (!Array.isArray(proj.keywordTexts)) return 'project.keywordTexts must be an array';
    if (proj.keywordTexts.length > MAX_KEYWORDS_PER_PROJECT) {
      return `max ${MAX_KEYWORDS_PER_PROJECT} keywords per project`;
    }
    for (const kw of proj.keywordTexts) {
      if (typeof kw !== 'string' || kw.length > MAX_STR_LEN) return 'keywordText must be a short string';
    }
  }
  return null;
}

router.put('/scan-configs', requirePro, async (req, res) => {
  const { projects } = req.body as { projects?: unknown };
  const err = validateProjects(projects);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }

  await upsertScanConfig(req.user!.id, { projects });
  res.json({ ok: true });
});

router.get('/scan-configs', requirePro, async (req, res) => {
  const scanConfig = await getScanConfig(req.user!.id);
  if (!scanConfig) {
    res.json({ projects: [] });
    return;
  }
  res.json(scanConfig.config);
});

router.get('/results', requirePro, async (req, res) => {
  const rawSince = req.query['since'] as string | undefined;
  if (rawSince && !DATE_RE.test(rawSince)) {
    res.status(400).json({ error: 'Invalid since date. Use YYYY-MM-DD.' });
    return;
  }
  const since = rawSince ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

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
