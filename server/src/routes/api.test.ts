import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/queries.js', () => ({
  findUserByApiKey: vi.fn(),
  updateLastSeen: vi.fn().mockResolvedValue(undefined),
  updateUserPlan: vi.fn().mockResolvedValue(undefined),
  upsertScanConfig: vi.fn().mockResolvedValue(undefined),
  getScanConfig: vi.fn(),
  getUserScanResults: vi.fn(),
  getLatestCrawlRun: vi.fn(),
}));

vi.mock('../middleware/rate-limit.js', () => ({
  proxyRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  registerRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../config.js', () => ({
  config: {
    port: 3000,
    databaseUrl: 'test',
    proxyPool: [],
    proLicenseKey: 'test-pro-key-123',
  },
}));

import express from 'express';
import request from 'supertest';
import apiRouter from './api.js';
import { findUserByApiKey, updateUserPlan, upsertScanConfig, getScanConfig, getUserScanResults, getLatestCrawlRun } from '../db/queries.js';
import { authMiddleware } from '../middleware/auth.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, apiRouter);
  return app;
}

function mockUser(plan: 'free' | 'pro') {
  vi.mocked(findUserByApiKey).mockResolvedValue({
    id: 'user-1', api_key: 'key-1', plan,
    license_key: null, created_at: new Date(), last_seen_at: new Date(),
  });
}

describe('PUT /api/license', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('activates Pro with valid license key', async () => {
    mockUser('free');
    const res = await request(createApp())
      .put('/api/license')
      .set('X-API-Key', 'key-1')
      .send({ licenseKey: 'test-pro-key-123' });

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('pro');
    expect(updateUserPlan).toHaveBeenCalledWith('user-1', 'pro', 'test-pro-key-123');
  });

  it('rejects invalid license key', async () => {
    mockUser('free');
    const res = await request(createApp())
      .put('/api/license')
      .set('X-API-Key', 'key-1')
      .send({ licenseKey: 'wrong-key' });

    expect(res.status).toBe(403);
    expect(updateUserPlan).not.toHaveBeenCalled();
  });

  it('rejects missing license key', async () => {
    mockUser('free');
    const res = await request(createApp())
      .put('/api/license')
      .set('X-API-Key', 'key-1')
      .send({});

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(createApp())
      .put('/api/license')
      .send({ licenseKey: 'test-pro-key-123' });

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/scan-configs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('saves scan config for Pro user', async () => {
    mockUser('pro');
    const projects = [{ id: 1, ownExtensionId: 'abc', competitorIds: ['def'], keywordTexts: ['ad blocker'] }];

    const res = await request(createApp())
      .put('/api/scan-configs')
      .set('X-API-Key', 'key-1')
      .send({ projects });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(upsertScanConfig).toHaveBeenCalledWith('user-1', { projects });
  });

  it('rejects free user', async () => {
    mockUser('free');
    const res = await request(createApp())
      .put('/api/scan-configs')
      .set('X-API-Key', 'key-1')
      .send({ projects: [] });

    expect(res.status).toBe(403);
  });

  it('rejects missing projects', async () => {
    mockUser('pro');
    const res = await request(createApp())
      .put('/api/scan-configs')
      .set('X-API-Key', 'key-1')
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects non-array projects', async () => {
    mockUser('pro');
    const res = await request(createApp())
      .put('/api/scan-configs')
      .set('X-API-Key', 'key-1')
      .send({ projects: 'not-an-array' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/scan-configs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns existing config', async () => {
    mockUser('pro');
    vi.mocked(getScanConfig).mockResolvedValue({
      user_id: 'user-1',
      config: { projects: [{ id: 1, ownExtensionId: 'abc', competitorIds: [], keywordTexts: ['test'] }] },
      updated_at: new Date(),
    });

    const res = await request(createApp())
      .get('/api/scan-configs')
      .set('X-API-Key', 'key-1');

    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
  });

  it('returns empty projects when no config exists', async () => {
    mockUser('pro');
    vi.mocked(getScanConfig).mockResolvedValue(null);

    const res = await request(createApp())
      .get('/api/scan-configs')
      .set('X-API-Key', 'key-1');

    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([]);
  });

  it('rejects free user', async () => {
    mockUser('free');
    const res = await request(createApp())
      .get('/api/scan-configs')
      .set('X-API-Key', 'key-1');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/results', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns grouped results by date', async () => {
    mockUser('pro');
    vi.mocked(getUserScanResults).mockResolvedValue([
      { scan_type: 'listing', query_key: 'detail:abc:en', date: '2026-03-30', result: { name: 'Ext' }, status_code: 200 },
      { scan_type: 'keyword', query_key: 'search:ad:en:1', date: '2026-03-30', result: { results: [] }, status_code: 200 },
    ]);

    const res = await request(createApp())
      .get('/api/results?since=2026-03-29')
      .set('X-API-Key', 'key-1');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].date).toBe('2026-03-30');
    expect(res.body.results[0].listings).toHaveLength(1);
    expect(res.body.results[0].rankings).toHaveLength(1);
  });

  it('returns empty results when none exist', async () => {
    mockUser('pro');
    vi.mocked(getUserScanResults).mockResolvedValue([]);

    const res = await request(createApp())
      .get('/api/results?since=2026-03-29')
      .set('X-API-Key', 'key-1');

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('defaults since to 30 days ago', async () => {
    mockUser('pro');
    vi.mocked(getUserScanResults).mockResolvedValue([]);

    await request(createApp())
      .get('/api/results')
      .set('X-API-Key', 'key-1');

    expect(getUserScanResults).toHaveBeenCalledWith('user-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('rejects free user', async () => {
    mockUser('free');
    const res = await request(createApp())
      .get('/api/results')
      .set('X-API-Key', 'key-1');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/crawl-status', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns latest crawl run info', async () => {
    mockUser('pro');
    vi.mocked(getLatestCrawlRun).mockResolvedValue({
      id: 1, run_at: new Date('2026-03-30T03:15:00Z'),
      total_queries: 100, successful: 97, failed: 3, skipped: 0,
      duration_ms: 60000, proxy_stats: {},
    });

    const res = await request(createApp())
      .get('/api/crawl-status')
      .set('X-API-Key', 'key-1');

    expect(res.status).toBe(200);
    expect(res.body.successful).toBe(97);
    expect(res.body.failed).toBe(3);
    expect(res.body.lastRun).toBeTruthy();
    expect(res.body.nextRun).toBeTruthy();
  });

  it('returns nulls when no crawl has run yet', async () => {
    mockUser('pro');
    vi.mocked(getLatestCrawlRun).mockResolvedValue(null);

    const res = await request(createApp())
      .get('/api/crawl-status')
      .set('X-API-Key', 'key-1');

    expect(res.status).toBe(200);
    expect(res.body.lastRun).toBeNull();
    expect(res.body.successful).toBe(0);
  });

  it('rejects free user', async () => {
    mockUser('free');
    const res = await request(createApp())
      .get('/api/crawl-status')
      .set('X-API-Key', 'key-1');

    expect(res.status).toBe(403);
  });
});
