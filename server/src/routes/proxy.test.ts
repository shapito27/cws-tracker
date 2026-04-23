import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/queries.js', () => ({
  findUserByApiKey: vi.fn(),
  createUser: vi.fn(),
  updateLastSeen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../middleware/rate-limit.js', () => ({
  proxyRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  registerRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import request from 'supertest';
import proxyRouter from './proxy.js';
import { findUserByApiKey } from '../db/queries.js';
import { authMiddleware } from '../middleware/auth.js';
import { clearSessionCache } from '../services/cws-fetcher.js';

function mockFetchResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/proxy', authMiddleware, proxyRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[test error]', err.message);
    res.status(500).json({ error: err.message });
  });
  return app;
}

function mockAuthUser(plan: 'free' | 'pro' = 'free') {
  vi.mocked(findUserByApiKey).mockResolvedValue({
    id: 'test-user', api_key: 'test-key', plan,
    license_key: null, created_at: new Date(), last_seen_at: new Date(),
  });
}

describe('proxy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionCache();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('auth requirement', () => {
    it('returns 401 without API key', async () => {
      const res = await request(createApp()).get('/proxy/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm');
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid API key', async () => {
      vi.mocked(findUserByApiKey).mockResolvedValue(null);
      const res = await request(createApp())
        .get('/proxy/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm')
        .set('X-API-Key', 'bad-key');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /proxy/detail', () => {
    beforeEach(() => {
      mockAuthUser();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse('<html>detail</html>'));
    });

    it('returns CWS detail page', async () => {
      const res = await request(createApp())
        .get('/proxy/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm&hl=en')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(200);
      expect(res.body.html).toBe('<html>detail</html>');
      expect(res.body.url).toContain('/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm');
      expect(res.body.htmlLength).toBe('<html>detail</html>'.length);
      expect(res.body.fetchedAt).toBeTruthy();
    });

    it('defaults hl to en', async () => {
      const res = await request(createApp())
        .get('/proxy/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(200);
      expect(res.body.url).toContain('hl=en');
    });

    it('rejects missing id', async () => {
      const res = await request(createApp())
        .get('/proxy/detail')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('rejects invalid extension ID (too short)', async () => {
      const res = await request(createApp())
        .get('/proxy/detail?id=tooshort')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('32 lowercase');
    });

    it('rejects invalid extension ID (uppercase)', async () => {
      const res = await request(createApp())
        .get('/proxy/detail?id=CJPALHDLNBPAFIAMEJDNHCPHJBKEIAGM')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(400);
    });

    it('rejects invalid extension ID (with numbers)', async () => {
      const res = await request(createApp())
        .get('/proxy/detail?id=cjpalhdlnbpafiamejdnhcphjbke1234')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(400);
    });

    it('returns 502 on CWS fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'));
      const res = await request(createApp())
        .get('/proxy/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(502);
      expect(res.body.error).toContain('CWS fetch failed');
    });

    it('returns 504 on timeout', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('The operation was aborted'));
      const res = await request(createApp())
        .get('/proxy/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(504);
      expect(res.body.error).toContain('timed out');
    });

    it('accepts API key via query param', async () => {
      const res = await request(createApp())
        .get('/proxy/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm&key=test-key');

      expect(res.status).toBe(200);
    });
  });

  describe('GET /proxy/search', () => {
    beforeEach(() => {
      mockAuthUser();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse('<html>search results</html>'));
    });

    it('returns search results for page 1', async () => {
      const res = await request(createApp())
        .get('/proxy/search?q=ad+blocker&hl=en')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(200);
      expect(res.body.html).toBe('<html>search results</html>');
    });

    it('rejects missing query', async () => {
      const res = await request(createApp())
        .get('/proxy/search')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('rejects query exceeding max length', async () => {
      const longQuery = 'a'.repeat(201);
      const res = await request(createApp())
        .get(`/proxy/search?q=${longQuery}`)
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('too long');
    });

    it('accepts query at exactly max length', async () => {
      const maxQuery = 'a'.repeat(200);
      const res = await request(createApp())
        .get(`/proxy/search?q=${maxQuery}`)
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(200);
    });

    it('returns 502 on CWS failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
      const res = await request(createApp())
        .get('/proxy/search?q=test')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(502);
    });
  });

  describe('GET /proxy/autocomplete', () => {
    beforeEach(() => {
      mockAuthUser();
    });

    it('returns autocomplete data', async () => {
      const batchResponse = ")]}'\n" +
        `[["wrb.fr","QcU9bc","[\\"sug1\\"]",null,null,null,"generic"]]\n`;
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(batchResponse));

      const res = await request(createApp())
        .get('/proxy/autocomplete?q=ad&hl=en')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(200);
      expect(res.body.data).toBe('["sug1"]');
      expect(res.body.query).toBe('ad');
    });

    it('rejects missing query', async () => {
      const res = await request(createApp())
        .get('/proxy/autocomplete')
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(400);
    });

    it('rejects query exceeding max length', async () => {
      const res = await request(createApp())
        .get(`/proxy/autocomplete?q=${'x'.repeat(201)}`)
        .set('X-API-Key', 'test-key');

      expect(res.status).toBe(400);
    });
  });
});
