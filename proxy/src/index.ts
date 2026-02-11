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

// Batchexecute RPC endpoint for CWS pagination
const BATCHEXECUTE_PATH = '/_/ChromeWebStoreConsumerFeUi/data/batchexecute';
const SEARCH_RPC_METHOD = 'zTyKYc';
const SEARCH_PAGE_SIZE = 10;

// Cache key prefix for build label used in batchexecute requests
const BUILD_LABEL_CACHE_PREFIX = 'https://cws-build-label/';
const BUILD_LABEL_CACHE_TTL = 3600; // 1 hour

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

// --- Batchexecute (CWS RPC for search pagination) ---

/** Session parameters extracted from CWS HTML, needed for batchexecute RPC. */
interface SessionParams {
  /** Build label (WIZ_global_data.cfb2h). Changes with each CWS deployment. */
  bl: string;
  /** Session ID (WIZ_global_data.FdrFJe). Numeric string. */
  sid: string;
  /** CSRF token (WIZ_global_data.SNlM0e or similar). May be empty for cookieless requests. */
  at: string;
}

/**
 * Extract session parameters from WIZ_global_data embedded in CWS HTML.
 * These values are required for constructing batchexecute RPC requests:
 *   - bl (build label): "cfb2h" key
 *   - f.sid (session ID): "FdrFJe" key
 *   - at (CSRF token): "SNlM0e" key, or fallback patterns
 */
function extractSessionParams(html: string): SessionParams | null {
  const blMatch = html.match(/"cfb2h":"([^"]+)"/);
  if (!blMatch) return null;

  const sidMatch = html.match(/"FdrFJe":"([^"]+)"/);
  const sid = sidMatch ? sidMatch[1] : '';

  // CSRF token: try SNlM0e first, then S06Grb (varies between Google apps)
  let at = '';
  const atMatch = html.match(/"SNlM0e":"([^"]+)"/) || html.match(/"S06Grb":"([^"]+)"/);
  if (atMatch && atMatch[1]) {
    at = atMatch[1];
  }

  return { bl: blMatch[1], sid, at };
}

/**
 * Cache session parameters for batchexecute requests.
 * Build labels change with each CWS deployment (roughly daily/weekly).
 */
async function cacheSessionParams(params: SessionParams): Promise<void> {
  try {
    const cache = caches.default;
    const key = new Request(BUILD_LABEL_CACHE_PREFIX);
    await cache.put(
      key,
      new Response(JSON.stringify(params), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `s-maxage=${BUILD_LABEL_CACHE_TTL}`,
        },
      })
    );
  } catch {
    // Caching is best-effort
  }
}

/**
 * Retrieve cached session parameters.
 */
async function getCachedSessionParams(): Promise<SessionParams | null> {
  try {
    const cache = caches.default;
    const key = new Request(BUILD_LABEL_CACHE_PREFIX);
    const cached = await cache.match(key);
    if (cached) {
      return cached.json() as Promise<SessionParams>;
    }
  } catch {
    // Cache miss is fine
  }
  return null;
}

/**
 * Build the batchexecute URL for CWS search pagination.
 */
function buildBatchExecuteUrl(
  params: SessionParams,
  query: string,
  hl: string
): string {
  const url = new URL(BATCHEXECUTE_PATH, CWS_BASE);
  url.searchParams.set('rpcids', SEARCH_RPC_METHOD);
  url.searchParams.set('source-path', `/search/${encodeURIComponent(query)}`);
  if (params.sid) {
    url.searchParams.set('f.sid', params.sid);
  }
  url.searchParams.set('bl', params.bl);
  url.searchParams.set('hl', hl);
  url.searchParams.set('soc-app', '1');
  url.searchParams.set('soc-platform', '1');
  url.searchParams.set('soc-device', '1');
  url.searchParams.set('rt', 'c');
  return url.toString();
}

/**
 * Build the f.req POST body for search pagination via batchexecute.
 *
 * Structure mirrors real CWS requests:
 *   [[["zTyKYc", "[[null,[null,null,null,[\"query\",[10,\"token\"],null,[\"EXTENSION\"]]]]]", null, "generic"]]]
 *
 * Inner payload encodes the search query, page size (10), pagination token,
 * and the EXTENSION type filter (required for CWS to return extension results).
 * The `at` CSRF token is appended to the body when available.
 */
function buildSearchRpcBody(
  query: string,
  token: string,
  at: string
): string {
  const innerPayload = [[null, [null, null, null, [query, [SEARCH_PAGE_SIZE, token], null, ['EXTENSION']]]]];
  const innerJson = JSON.stringify(innerPayload);
  const outerPayload = [[[SEARCH_RPC_METHOD, innerJson, null, 'generic']]];
  const outerJson = JSON.stringify(outerPayload);
  let body = `f.req=${encodeURIComponent(outerJson)}&`;
  if (at) {
    body += `at=${encodeURIComponent(at)}&`;
  }
  return body;
}

/**
 * Parse a batchexecute response to extract the search data JSON string.
 *
 * Response format with rt=c uses length-prefixed chunks after a )]}\' prefix:
 *   )]}'\n
 *   123\n
 *   [["wrb.fr","zTyKYc","[...data...]",null,null,null,"generic"]]\n
 *   34\n
 *   [["di",456]]\n
 *   ...
 *
 * We find the chunk containing our RPC method and extract the data string.
 */
function parseBatchExecuteResponse(text: string): string {
  // Strip the security prefix )]}' (or variations)
  const prefixPattern = /^\)?\]?\}?'?\n/;
  const cleaned = text.replace(prefixPattern, '');

  // Try length-prefixed format first (rt=c)
  const lines = cleaned.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if this line contains our RPC method response
    if (line.includes(`"${SEARCH_RPC_METHOD}"`)) {
      try {
        const parsed = JSON.parse(line);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (
              Array.isArray(entry) &&
              entry[1] === SEARCH_RPC_METHOD &&
              typeof entry[2] === 'string'
            ) {
              return entry[2];
            }
          }
        }
      } catch {
        // Not valid JSON on this line, continue
      }
    }
  }

  // Fallback: try parsing the whole thing as JSON (non-chunked format)
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (Array.isArray(entry)) {
          // Could be nested: [[["wrb.fr","zTyKYc","..."...]]]
          const flat = Array.isArray(entry[0]) ? entry[0] : entry;
          if (flat[1] === SEARCH_RPC_METHOD && typeof flat[2] === 'string') {
            return flat[2];
          }
        }
      }
    }
  } catch {
    // Not valid JSON
  }

  throw new Error(
    `${SEARCH_RPC_METHOD} response not found in batchexecute result`
  );
}

/**
 * Wrap raw search data JSON in synthetic AF_initDataCallback HTML
 * so the existing extension search parser can process it unchanged.
 */
function wrapInSyntheticHtml(dataJsonString: string): string {
  return `<script>AF_initDataCallback({key: 'ds:1', hash: '1', data:${dataJsonString}});</script>`;
}

/**
 * Handle paginated search (page 2+) using CWS batchexecute RPC.
 *
 * Flow:
 * 1. Get the build label (from cache or by fetching the initial search page)
 * 2. Construct a batchexecute POST request with the search query and pagination token
 * 3. Parse the RPC response and wrap it in synthetic HTML
 * 4. Return the same response format as page 1 for seamless parser compatibility
 */
async function handleSearchPagination(
  query: string,
  token: string,
  hl: string,
  origin: string | null
): Promise<Response> {
  // Get session params (cached or fresh from initial page)
  let sessionParams = await getCachedSessionParams();

  if (!sessionParams) {
    // Fetch initial search page to extract session params
    const initialResult = await fetchCWS(
      `${CWS_SEARCH_PATH}/${encodeURIComponent(query)}`,
      hl
    );
    sessionParams = extractSessionParams(initialResult.body);
    if (!sessionParams) {
      return errorResponse(
        'Failed to extract session parameters from CWS for pagination',
        502,
        origin
      );
    }
    await cacheSessionParams(sessionParams);
  }

  // Construct and send batchexecute request
  const batchUrl = buildBatchExecuteUrl(sessionParams, query, hl);
  const body = buildSearchRpcBody(query, token, sessionParams.at);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CWS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(batchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        Origin: CWS_BASE,
        Referer: `${CWS_BASE}/`,
        'X-Same-Domain': '1',
      },
      signal: controller.signal,
    });

    const responseText = await response.text();

    if (!response.ok) {
      return errorResponse(
        `CWS batchexecute returned HTTP ${response.status}`,
        502,
        origin
      );
    }

    // Parse the RPC response to extract search data
    const dataJsonString = parseBatchExecuteResponse(responseText);

    // Wrap in synthetic HTML for parser compatibility
    const syntheticHtml = wrapInSyntheticHtml(dataJsonString);

    const cwsUrl = `${CWS_BASE}${CWS_SEARCH_PATH}/${encodeURIComponent(query)}?hl=${hl}&token=${encodeURIComponent(token)}`;

    return jsonResponse(
      {
        url: cwsUrl,
        status: 200,
        html: syntheticHtml,
        htmlLength: syntheticHtml.length,
        fetchedAt: new Date().toISOString(),
      },
      200,
      origin
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('aborted')) {
      return errorResponse('CWS pagination request timed out', 504, origin);
    }
    return errorResponse(`CWS pagination failed: ${message}`, 502, origin);
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

  // Page 2+: use batchexecute RPC for pagination
  // CWS does NOT support URL-based pagination (?token=). Instead, subsequent
  // pages must be fetched via a POST to the batchexecute RPC endpoint.
  if (token) {
    return handleSearchPagination(query, token, hl, origin);
  }

  // Page 1: normal GET fetch (server-rendered HTML with AF_initDataCallback)
  try {
    const path = `${CWS_SEARCH_PATH}/${encodeURIComponent(query)}`;
    const result = await fetchCWS(path, hl);

    // Cache session params from this page for future pagination requests
    const sessionParams = extractSessionParams(result.body);
    if (sessionParams) {
      await cacheSessionParams(sessionParams);
    }

    return jsonResponse(
      {
        url: `${CWS_BASE}${CWS_SEARCH_PATH}/${encodeURIComponent(query)}?hl=${hl}`,
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

    // Paginated search requests (with token) must bypass cache entirely.
    // caches.default shares the Cloudflare CDN cache, which may ignore query
    // string differences depending on zone settings, causing page 2+ to get
    // page 1's cached response. Paginated results are transient and benefit
    // little from caching anyway.
    const isPaginatedSearch = pathname === '/search' && url.searchParams.has('token');

    // Check cache first (skip for paginated search)
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    if (!isPaginatedSearch) {
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

    // Cache successful responses (skip for paginated search)
    if (response.status === 200 && !isPaginatedSearch) {
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
