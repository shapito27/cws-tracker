import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from './index';

const BASE = 'http://localhost';

function makeRequest(
  path: string,
  options: {
    apiKey?: string;
    origin?: string;
    method?: string;
  } = {}
): Request {
  const headers = new Headers();
  if (options.apiKey) {
    headers.set('X-API-Key', options.apiKey);
  }
  if (options.origin) {
    headers.set('Origin', options.origin);
  }
  return new Request(`${BASE}${path}`, {
    method: options.method || 'GET',
    headers,
  });
}

async function callWorker(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function getJson(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

// --- Tests ---

describe('Health endpoint', () => {
  it('returns ok without auth', async () => {
    const response = await callWorker(makeRequest('/health'));
    expect(response.status).toBe(200);
    const body = await getJson(response);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(body.timestamp).toBeDefined();
  });
});

describe('Authentication', () => {
  it('rejects requests without API key', async () => {
    const response = await callWorker(makeRequest('/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm'));
    expect(response.status).toBe(401);
    const body = await getJson(response);
    expect(body.error).toContain('Missing API key');
  });

  it('rejects requests with invalid API key', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm', {
        apiKey: 'invalid-key',
      })
    );
    expect(response.status).toBe(403);
    const body = await getJson(response);
    expect(body.error).toContain('Invalid API key');
  });

  it('accepts valid API key via header', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm', {
        apiKey: 'test-key-1',
      })
    );
    // Should not be 401 or 403
    expect([401, 403]).not.toContain(response.status);
  });

  it('accepts valid API key via query parameter', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm&key=test-key-2')
    );
    expect([401, 403]).not.toContain(response.status);
  });
});

describe('CORS', () => {
  it('returns CORS headers for chrome-extension:// origin', async () => {
    const response = await callWorker(
      makeRequest('/health', {
        origin: 'chrome-extension://abcdefghijklmnopqrstuvwxyz123456',
      })
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'chrome-extension://abcdefghijklmnopqrstuvwxyz123456'
    );
  });

  it('returns empty CORS origin for non-extension origins', async () => {
    const response = await callWorker(
      makeRequest('/health', {
        origin: 'https://evil.example.com',
      })
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('');
  });

  it('handles OPTIONS preflight', async () => {
    const response = await callWorker(
      makeRequest('/detail', {
        method: 'OPTIONS',
        origin: 'chrome-extension://test',
      })
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('allows localhost origin for development', async () => {
    const response = await callWorker(
      makeRequest('/health', {
        origin: 'http://localhost:5173',
      })
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173'
    );
  });
});

describe('Method validation', () => {
  it('rejects POST requests', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm', {
        apiKey: 'test-key-1',
        method: 'POST',
      })
    );
    expect(response.status).toBe(405);
  });
});

describe('Detail endpoint', () => {
  it('rejects missing extension ID', async () => {
    const response = await callWorker(
      makeRequest('/detail', { apiKey: 'test-key-1' })
    );
    expect(response.status).toBe(400);
    const body = await getJson(response);
    expect(body.error).toContain('Missing required parameter: id');
  });

  it('rejects invalid extension ID format', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=INVALID-ID', { apiKey: 'test-key-1' })
    );
    expect(response.status).toBe(400);
    const body = await getJson(response);
    expect(body.error).toContain('Invalid extension ID');
  });

  it('rejects extension ID with wrong length', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=abc', { apiKey: 'test-key-1' })
    );
    expect(response.status).toBe(400);
  });

  it('rejects extension ID with uppercase', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=CJPALHDLNBPAFIAMEJDNHCPHJBKEIAGM', {
        apiKey: 'test-key-1',
      })
    );
    expect(response.status).toBe(400);
  });

  it('fetches a valid extension detail page or returns 502 when CWS unreachable', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm', {
        apiKey: 'test-key-1',
      })
    );
    const body = await getJson(response);

    if (response.status === 200) {
      // Network available - verify full response
      expect(body.status).toBe(200);
      expect(body.html).toBeDefined();
      expect(typeof body.html).toBe('string');
      expect((body.html as string).length).toBeGreaterThan(0);
      expect(body.htmlLength).toBeGreaterThan(0);
      expect(body.fetchedAt).toBeDefined();
      expect(body.url).toContain('cjpalhdlnbpafiamejdnhcphjbkeiagm');
    } else {
      // No network (sandboxed env) - verify error handling
      expect(response.status).toBe(502);
      expect(body.error).toContain('CWS fetch failed');
    }
  });

  it('includes locale parameter in fetch or returns 502', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm&hl=ja', {
        apiKey: 'test-key-1',
      })
    );
    const body = await getJson(response);

    if (response.status === 200) {
      expect(body.url).toContain('hl=ja');
    } else {
      expect(response.status).toBe(502);
    }
  });

  it('defaults locale to en or returns 502', async () => {
    const response = await callWorker(
      makeRequest('/detail?id=cjpalhdlnbpafiamejdnhcphjbkeiagm', {
        apiKey: 'test-key-1',
      })
    );
    const body = await getJson(response);

    if (response.status === 200) {
      expect(body.url).toContain('hl=en');
    } else {
      expect(response.status).toBe(502);
    }
  });
});

describe('Search endpoint', () => {
  it('rejects missing query', async () => {
    const response = await callWorker(
      makeRequest('/search', { apiKey: 'test-key-1' })
    );
    expect(response.status).toBe(400);
    const body = await getJson(response);
    expect(body.error).toContain('Missing required parameter: q');
  });

  it('rejects query exceeding max length', async () => {
    const longQuery = 'a'.repeat(201);
    const response = await callWorker(
      makeRequest(`/search?q=${longQuery}`, { apiKey: 'test-key-1' })
    );
    expect(response.status).toBe(400);
    const body = await getJson(response);
    expect(body.error).toContain('too long');
  });

  it('fetches search results or returns 502 when CWS unreachable', async () => {
    const response = await callWorker(
      makeRequest('/search?q=ad+blocker', { apiKey: 'test-key-1' })
    );
    const body = await getJson(response);

    if (response.status === 200) {
      expect(body.status).toBe(200);
      expect(body.html).toBeDefined();
      expect((body.html as string).length).toBeGreaterThan(0);
      expect(body.url).toContain('ad%20blocker');
    } else {
      expect(response.status).toBe(502);
      expect(body.error).toContain('CWS fetch failed');
    }
  });

  it('includes locale parameter or returns 502', async () => {
    const response = await callWorker(
      makeRequest('/search?q=ad+blocker&hl=es', { apiKey: 'test-key-1' })
    );
    const body = await getJson(response);

    if (response.status === 200) {
      expect(body.url).toContain('hl=es');
    } else {
      expect(response.status).toBe(502);
    }
  });
});

describe('Routing', () => {
  it('returns 404 for unknown paths', async () => {
    const response = await callWorker(
      makeRequest('/unknown', { apiKey: 'test-key-1' })
    );
    expect(response.status).toBe(404);
    const body = await getJson(response);
    expect(body.error).toContain('Not found');
  });
});
