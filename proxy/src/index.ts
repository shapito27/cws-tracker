/**
 * CWS Tracker Proxy - Cloudflare Worker
 *
 * Fetches Chrome Web Store pages on behalf of the extension,
 * bypassing Chrome's restriction on extension access to CWS domains.
 *
 * Endpoints:
 *   GET /detail?id={extensionId}&hl={locale}
 *   GET /search?q={query}&hl={locale}
 *   GET /health
 *
 * Security:
 *   - API key required via X-API-Key header or ?key= parameter
 *   - CORS restricted to chrome-extension:// origins
 *   - Per-key rate limiting via in-memory sliding window
 */

export interface Env {
  API_KEYS: string; // Comma-separated list of valid API keys
  ENVIRONMENT: string;
}

// --- Constants ---

const CWS_BASE = 'https://chromewebstore.google.com';
const CWS_DETAIL_PATH = '/detail';
const CWS_SEARCH_PATH = '/search';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const EXTENSION_ID_REGEX = /^[a-z]{32}$/;
const MAX_SEARCH_QUERY_LENGTH = 200;

// Rate limit: requests per key per minute
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

// CWS fetch timeout
const CWS_FETCH_TIMEOUT_MS = 15_000;

// Cache TTL
const CACHE_TTL_SECONDS = 300; // 5 minutes

// --- Rate Limiter (in-memory, per-isolate) ---

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  let entry = rateLimitMap.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimitMap.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );

  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  entry.timestamps.push(now);
  return false;
}

// --- CORS ---

function corsHeaders(origin: string | null): Record<string, string> {
  // Only allow chrome-extension:// origins and localhost for dev
  const allowedOrigin =
    origin && (origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost'))
      ? origin
      : '';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function handleOptions(request: Request): Response {
  const origin = request.headers.get('Origin');
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

// --- Response Helpers ---

function jsonResponse(
  data: unknown,
  status: number,
  origin: string | null
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function errorResponse(
  message: string,
  status: number,
  origin: string | null
): Response {
  return jsonResponse({ error: message }, status, origin);
}

// --- Auth ---

function getApiKey(request: Request, url: URL): string | null {
  return (
    request.headers.get('X-API-Key') || url.searchParams.get('key') || null
  );
}

function isValidApiKey(key: string, env: Env): boolean {
  if (!env.API_KEYS) return false;
  const validKeys = env.API_KEYS.split(',').map((k) => k.trim());
  return validKeys.includes(key);
}

// --- CWS Fetcher ---

async function fetchCWS(
  path: string,
  hl: string
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const url = new URL(path, CWS_BASE);
  if (hl) {
    url.searchParams.set('hl', hl);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CWS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': hl ? `${hl},en;q=0.5` : 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    const body = await response.text();

    return {
      status: response.status,
      body,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Route Handlers ---

async function handleDetail(
  url: URL,
  origin: string | null
): Promise<Response> {
  const id = url.searchParams.get('id');
  const hl = url.searchParams.get('hl') || 'en';

  if (!id) {
    return errorResponse('Missing required parameter: id', 400, origin);
  }

  if (!EXTENSION_ID_REGEX.test(id)) {
    return errorResponse(
      'Invalid extension ID. Must be 32 lowercase letters.',
      400,
      origin
    );
  }

  try {
    const result = await fetchCWS(`${CWS_DETAIL_PATH}/${id}`, hl);

    return jsonResponse(
      {
        url: `${CWS_BASE}${CWS_DETAIL_PATH}/${id}?hl=${hl}`,
        status: result.status,
        html: result.body,
        htmlLength: result.body.length,
        fetchedAt: new Date().toISOString(),
      },
      200,
      origin
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('aborted')) {
      return errorResponse('CWS request timed out', 504, origin);
    }
    return errorResponse(`CWS fetch failed: ${message}`, 502, origin);
  }
}

async function handleSearch(
  url: URL,
  origin: string | null
): Promise<Response> {
  const query = url.searchParams.get('q');
  const hl = url.searchParams.get('hl') || 'en';
  const token = url.searchParams.get('token');

  if (!query) {
    return errorResponse('Missing required parameter: q', 400, origin);
  }

  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    return errorResponse(
      `Search query too long. Max ${MAX_SEARCH_QUERY_LENGTH} characters.`,
      400,
      origin
    );
  }

  try {
    let path = `${CWS_SEARCH_PATH}/${encodeURIComponent(query)}`;
    if (token) {
      path += `?token=${encodeURIComponent(token)}`;
    }

    const result = await fetchCWS(path, hl);

    let cwsUrl = `${CWS_BASE}${CWS_SEARCH_PATH}/${encodeURIComponent(query)}?hl=${hl}`;
    if (token) {
      cwsUrl += `&token=${encodeURIComponent(token)}`;
    }

    return jsonResponse(
      {
        url: cwsUrl,
        status: result.status,
        html: result.body,
        htmlLength: result.body.length,
        fetchedAt: new Date().toISOString(),
      },
      200,
      origin
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('aborted')) {
      return errorResponse('CWS request timed out', 504, origin);
    }
    return errorResponse(`CWS fetch failed: ${message}`, 502, origin);
  }
}

function handleHealth(origin: string | null): Response {
  return jsonResponse(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    },
    200,
    origin
  );
}

// --- Main Handler ---

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Only allow GET
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405, null);
    }

    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const pathname = url.pathname;

    // Health check (no auth required)
    if (pathname === '/health') {
      return handleHealth(origin);
    }

    // Auth check
    const apiKey = getApiKey(request, url);
    if (!apiKey) {
      return errorResponse(
        'Missing API key. Provide via X-API-Key header or ?key= parameter.',
        401,
        origin
      );
    }

    if (!isValidApiKey(apiKey, env)) {
      return errorResponse('Invalid API key', 403, origin);
    }

    // Rate limit check
    if (isRateLimited(apiKey)) {
      return errorResponse(
        `Rate limit exceeded. Max ${RATE_LIMIT_MAX_REQUESTS} requests per minute.`,
        429,
        origin
      );
    }

    // Check cache first
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      // Re-add CORS headers since cached response may not have the right origin
      const newHeaders = new Headers(cachedResponse.headers);
      const cors = corsHeaders(origin);
      for (const [k, v] of Object.entries(cors)) {
        newHeaders.set(k, v);
      }
      newHeaders.set('X-Cache', 'HIT');
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        headers: newHeaders,
      });
    }

    // Route
    let response: Response;
    if (pathname === '/detail') {
      response = await handleDetail(url, origin);
    } else if (pathname === '/search') {
      response = await handleSearch(url, origin);
    } else {
      response = errorResponse(
        'Not found. Available endpoints: /detail, /search, /health',
        404,
        origin
      );
    }

    // Cache successful responses
    if (response.status === 200) {
      const cacheResponse = response.clone();
      const cacheHeaders = new Headers(cacheResponse.headers);
      cacheHeaders.set('Cache-Control', `s-maxage=${CACHE_TTL_SECONDS}`);
      ctx.waitUntil(
        cache.put(
          cacheKey,
          new Response(cacheResponse.body, {
            status: cacheResponse.status,
            headers: cacheHeaders,
          })
        )
      );
      response.headers.set('X-Cache', 'MISS');
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
