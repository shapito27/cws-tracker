import { pool } from './client.js';

export interface UserRecord {
  id: string;
  api_key: string;
  plan: 'free' | 'pro';
  license_key: string | null;
  created_at: Date;
  last_seen_at: Date;
}

export interface ScanConfigRecord {
  user_id: string;
  config: { projects: ProjectConfig[] };
  updated_at: Date;
}

export interface ProjectConfig {
  id: number;
  ownExtensionId: string;
  competitorIds: string[];
  keywordTexts: string[];
}

export interface CrawlCacheRecord {
  cache_key: string;
  date: string;
  scan_type: string;
  result: unknown;
  status_code: number;
  fetched_at: Date;
}

export interface CrawlRunRecord {
  id: number;
  run_at: Date;
  total_queries: number;
  successful: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  proxy_stats: Record<string, { ok: number; fail: number }>;
}

export async function findUserByApiKey(apiKey: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    'SELECT * FROM users WHERE api_key = $1',
    [apiKey],
  );
  return rows[0] ?? null;
}

export async function createUser(id: string, apiKey: string): Promise<UserRecord> {
  const { rows } = await pool.query<UserRecord>(
    `INSERT INTO users (id, api_key) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = NOW()
     RETURNING *`,
    [id, apiKey],
  );
  return rows[0]!;
}

export async function updateUserPlan(userId: string, plan: string, licenseKey: string): Promise<void> {
  await pool.query(
    'UPDATE users SET plan = $1, license_key = $2 WHERE id = $3',
    [plan, licenseKey, userId],
  );
}

export async function updateLastSeen(userId: string): Promise<void> {
  await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [userId]);
}

export async function upsertScanConfig(userId: string, config: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO scan_configs (user_id, config, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET config = $2, updated_at = NOW()`,
    [userId, JSON.stringify(config)],
  );
}

export async function getScanConfig(userId: string): Promise<ScanConfigRecord | null> {
  const { rows } = await pool.query<ScanConfigRecord>(
    'SELECT * FROM scan_configs WHERE user_id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

export async function getProScanConfigs(): Promise<Array<{ userId: string; projects: ProjectConfig[] }>> {
  const { rows } = await pool.query<{ user_id: string; config: { projects: ProjectConfig[] } }>(
    `SELECT sc.user_id, sc.config FROM scan_configs sc
     JOIN users u ON u.id = sc.user_id
     WHERE u.plan = 'pro'`,
  );
  return rows.map((r) => ({ userId: r.user_id, projects: r.config.projects }));
}

export async function getCrawlCache(cacheKey: string, date: string): Promise<CrawlCacheRecord | null> {
  const { rows } = await pool.query<CrawlCacheRecord>(
    'SELECT * FROM crawl_cache WHERE cache_key = $1 AND date = $2',
    [cacheKey, date],
  );
  return rows[0] ?? null;
}

export async function saveCrawlResult(
  cacheKey: string, date: string, scanType: string,
  result: unknown, statusCode: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO crawl_cache (cache_key, date, scan_type, result, status_code, fetched_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (cache_key, date) DO UPDATE SET result = $4, status_code = $5, fetched_at = NOW()`,
    [cacheKey, date, scanType, JSON.stringify(result), statusCode],
  );
}

export async function insertScanResults(
  results: Array<{ user_id: string; scan_type: string; query_key: string; date: string }>,
): Promise<void> {
  if (results.length === 0) return;
  const values: unknown[] = [];
  const placeholders = results.map((r, i) => {
    const offset = i * 4;
    values.push(r.user_id, r.scan_type, r.query_key, r.date);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
  });
  await pool.query(
    `INSERT INTO scan_results (user_id, scan_type, query_key, date) VALUES ${placeholders.join(', ')}
     ON CONFLICT (user_id, query_key, date) DO NOTHING`,
    values,
  );
}

export async function getUserScanResults(
  userId: string, since: string,
): Promise<Array<{ scan_type: string; query_key: string; date: string; result: unknown; status_code: number }>> {
  const { rows } = await pool.query(
    `SELECT sr.scan_type, sr.query_key, sr.date::text, cc.result, cc.status_code
     FROM scan_results sr
     JOIN crawl_cache cc ON cc.cache_key = sr.query_key AND cc.date = sr.date
     WHERE sr.user_id = $1 AND sr.date >= $2
     ORDER BY sr.date ASC`,
    [userId, since],
  );
  return rows;
}

export async function insertCrawlRun(run: {
  total_queries: number; successful: number; failed: number;
  skipped: number; duration_ms: number; proxy_stats: unknown;
}): Promise<void> {
  await pool.query(
    `INSERT INTO crawl_runs (run_at, total_queries, successful, failed, skipped, duration_ms, proxy_stats)
     VALUES (NOW(), $1, $2, $3, $4, $5, $6)`,
    [run.total_queries, run.successful, run.failed, run.skipped, run.duration_ms, JSON.stringify(run.proxy_stats)],
  );
}

export async function getLatestCrawlRun(): Promise<CrawlRunRecord | null> {
  const { rows } = await pool.query<CrawlRunRecord>(
    'SELECT * FROM crawl_runs ORDER BY run_at DESC LIMIT 1',
  );
  return rows[0] ?? null;
}

export async function getProxyHealth(proxyId: string) {
  const { rows } = await pool.query('SELECT * FROM proxy_health WHERE proxy_id = $1', [proxyId]);
  return rows[0] ?? null;
}

const ALLOWED_PROXY_HEALTH_FIELDS = new Set([
  'total_requests',
  'total_failures',
  'consecutive_failures',
  'disabled_until',
  'last_success_at',
  'last_failure_at',
]);

export async function upsertProxyHealth(
  proxyId: string, updates: Record<string, unknown>,
): Promise<void> {
  const safeEntries = Object.entries(updates).filter(
    ([key, value]) => ALLOWED_PROXY_HEALTH_FIELDS.has(key) && value !== undefined,
  );
  if (safeEntries.length === 0) return;

  const fields = safeEntries.map(([k]) => k);
  const values = safeEntries.map(([, v]) => v);
  const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  await pool.query(
    `INSERT INTO proxy_health (proxy_id, ${fields.join(', ')}) VALUES ($1, ${values.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (proxy_id) DO UPDATE SET ${setClause}`,
    [proxyId, ...values],
  );
}
