import { HttpsProxyAgent } from 'https-proxy-agent';

export const CWS_BASE = 'https://chromewebstore.google.com';
export const CWS_DETAIL_PATH = '/detail';
export const CWS_SEARCH_PATH = '/search';
export const BATCHEXECUTE_PATH = '/_/ChromeWebStoreConsumerFeUi/data/batchexecute';
export const SEARCH_RPC_METHOD = 'zTyKYc';
export const AUTOCOMPLETE_RPC_METHOD = 'QcU9bc';
export const SEARCH_PAGE_SIZE = 10;
export const CWS_FETCH_TIMEOUT_MS = 15_000;
export const SESSION_CACHE_TTL_MS = 3600_000;

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const EXTENSION_ID_REGEX = /^[a-z]{32}$/;
export const MAX_SEARCH_QUERY_LENGTH = 200;

export interface SessionParams {
  bl: string;
  sid: string;
  at: string;
}

export interface FetchOptions {
  proxyAgent?: HttpsProxyAgent<string>;
}

let cachedSessionParams: { params: SessionParams; expiresAt: number } | null = null;

/** Margin to avoid returning cached params on the cusp of expiry. */
const SESSION_EXPIRY_MARGIN_MS = 10_000;

export function getCachedSession(): SessionParams | null {
  if (cachedSessionParams && Date.now() + SESSION_EXPIRY_MARGIN_MS < cachedSessionParams.expiresAt) {
    return cachedSessionParams.params;
  }
  return null;
}

export function cacheSession(params: SessionParams): void {
  cachedSessionParams = { params, expiresAt: Date.now() + SESSION_CACHE_TTL_MS };
}

export function clearSessionCache(): void {
  cachedSessionParams = null;
}

async function fetchRaw(
  url: string,
  init: RequestInit & { agent?: HttpsProxyAgent<string> },
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CWS_FETCH_TIMEOUT_MS);

  try {
    const { agent: _agent, ...fetchInit } = init;
    const opts: RequestInit = { ...fetchInit, signal: controller.signal };
    const response = await fetch(url, opts);
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchCWS(
  path: string,
  hl: string,
  _opts?: FetchOptions,
): Promise<{ status: number; body: string }> {
  const url = new URL(path, CWS_BASE);
  if (hl) url.searchParams.set('hl', hl);

  return fetchRaw(url.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': hl ? `${hl},en;q=0.5` : 'en-US,en;q=0.9',
    },
  });
}

export function extractSessionParams(html: string): SessionParams | null {
  const blMatch = html.match(/"cfb2h":"([^"]+)"/);
  if (!blMatch) return null;

  const sidMatch = html.match(/"FdrFJe":"([^"]+)"/);
  const sid = sidMatch?.[1] ?? '';

  let at = '';
  const atMatch = html.match(/"SNlM0e":"([^"]+)"/) ?? html.match(/"S06Grb":"([^"]+)"/);
  if (atMatch?.[1]) at = atMatch[1];

  return { bl: blMatch[1]!, sid, at };
}

export function buildBatchExecuteUrl(params: SessionParams, rpcMethod: string, query: string, hl: string): string {
  const url = new URL(BATCHEXECUTE_PATH, CWS_BASE);
  url.searchParams.set('rpcids', rpcMethod);
  url.searchParams.set('source-path', `/search/${encodeURIComponent(query)}`);
  if (params.sid) url.searchParams.set('f.sid', params.sid);
  url.searchParams.set('bl', params.bl);
  url.searchParams.set('hl', hl);
  url.searchParams.set('soc-app', '1');
  url.searchParams.set('soc-platform', '1');
  url.searchParams.set('soc-device', '1');
  url.searchParams.set('rt', 'c');
  return url.toString();
}

export function buildSearchRpcBody(query: string, token: string, at: string): string {
  const innerPayload = [[null, [null, null, null, [query, [SEARCH_PAGE_SIZE, token], null, ['EXTENSION']]]]];
  const outerPayload = [[[SEARCH_RPC_METHOD, JSON.stringify(innerPayload), null, 'generic']]];
  let body = `f.req=${encodeURIComponent(JSON.stringify(outerPayload))}&`;
  if (at) body += `at=${encodeURIComponent(at)}&`;
  return body;
}

export function parseBatchExecuteResponse(text: string, rpcMethod: string): string {
  const cleaned = text.replace(/^\)?\]?\}?'?\n/, '');
  const lines = cleaned.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes(`"${rpcMethod}"`)) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (Array.isArray(entry) && entry[1] === rpcMethod && typeof entry[2] === 'string') {
            return entry[2];
          }
        }
      }
    } catch { /* continue */ }
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (Array.isArray(entry)) {
          const flat = Array.isArray(entry[0]) ? entry[0] : entry;
          if (flat[1] === rpcMethod && typeof flat[2] === 'string') return flat[2];
        }
      }
    }
  } catch { /* not JSON */ }

  throw new Error(`${rpcMethod} response not found in batchexecute result`);
}

export function wrapInSyntheticHtml(dataJsonString: string): string {
  return `<script>AF_initDataCallback({key: 'ds:1', hash: '1', data:${dataJsonString}});</script>`;
}

export function buildAutocompleteBatchUrl(bl: string | null, query: string, hl: string): string {
  const url = new URL(BATCHEXECUTE_PATH, CWS_BASE);
  url.searchParams.set('rpcids', AUTOCOMPLETE_RPC_METHOD);
  url.searchParams.set('source-path', `/search/${encodeURIComponent(query)}`);
  if (bl) url.searchParams.set('bl', bl);
  url.searchParams.set('hl', hl);
  url.searchParams.set('soc-app', '1');
  url.searchParams.set('soc-platform', '1');
  url.searchParams.set('soc-device', '1');
  url.searchParams.set('rt', 'c');
  return url.toString();
}

export function buildAutocompleteRpcBody(query: string): string {
  const innerJson = JSON.stringify([query]);
  const outerPayload = [[[AUTOCOMPLETE_RPC_METHOD, innerJson, null, 'generic']]];
  return `f.req=${encodeURIComponent(JSON.stringify(outerPayload))}&`;
}

async function ensureSessionParams(hl: string, opts?: FetchOptions): Promise<SessionParams> {
  const cached = getCachedSession();
  if (cached) return cached;

  const result = await fetchCWS(`${CWS_SEARCH_PATH}/extensions`, hl, opts);
  const params = extractSessionParams(result.body);
  if (!params) throw new Error('Failed to extract session parameters from CWS');
  cacheSession(params);
  return params;
}

export async function fetchDetail(
  id: string, hl: string, opts?: FetchOptions,
): Promise<{ url: string; status: number; html: string; htmlLength: number; fetchedAt: string }> {
  const result = await fetchCWS(`${CWS_DETAIL_PATH}/${id}`, hl, opts);
  return {
    url: `${CWS_BASE}${CWS_DETAIL_PATH}/${id}?hl=${hl}`,
    status: result.status,
    html: result.body,
    htmlLength: result.body.length,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchSearch(
  query: string, hl: string, token?: string, opts?: FetchOptions,
): Promise<{ url: string; status: number; html: string; htmlLength: number; fetchedAt: string }> {
  if (token) {
    const sessionParams = await ensureSessionParams(hl, opts);
    const batchUrl = buildBatchExecuteUrl(sessionParams, SEARCH_RPC_METHOD, query, hl);
    const body = buildSearchRpcBody(query, token, sessionParams.at);

    const result = await fetchRaw(batchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        Origin: CWS_BASE,
        Referer: `${CWS_BASE}/`,
        'X-Same-Domain': '1',
      },
      body,
    });

    if (result.status !== 200) {
      throw new Error(`CWS batchexecute returned HTTP ${result.status}`);
    }

    const dataJsonString = parseBatchExecuteResponse(result.body, SEARCH_RPC_METHOD);
    const syntheticHtml = wrapInSyntheticHtml(dataJsonString);
    const cwsUrl = `${CWS_BASE}${CWS_SEARCH_PATH}/${encodeURIComponent(query)}?hl=${hl}&token=${encodeURIComponent(token)}`;

    return { url: cwsUrl, status: 200, html: syntheticHtml, htmlLength: syntheticHtml.length, fetchedAt: new Date().toISOString() };
  }

  const path = `${CWS_SEARCH_PATH}/${encodeURIComponent(query)}`;
  const result = await fetchCWS(path, hl, opts);

  const sessionParams = extractSessionParams(result.body);
  if (sessionParams) cacheSession(sessionParams);

  return {
    url: `${CWS_BASE}${CWS_SEARCH_PATH}/${encodeURIComponent(query)}?hl=${hl}`,
    status: result.status,
    html: result.body,
    htmlLength: result.body.length,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchAutocomplete(
  query: string, hl: string, _opts?: FetchOptions,
): Promise<{ query: string; hl: string; data: string; fetchedAt: string }> {
  let bl: string | null = null;
  const cached = getCachedSession();
  if (cached) bl = cached.bl;

  const batchUrl = buildAutocompleteBatchUrl(bl, query, hl);
  const body = buildAutocompleteRpcBody(query);

  const result = await fetchRaw(batchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      Origin: CWS_BASE,
      Referer: `${CWS_BASE}/`,
      'X-Same-Domain': '1',
    },
    body,
  });

  if (result.status !== 200) {
    throw new Error(`CWS autocomplete batchexecute returned HTTP ${result.status}`);
  }

  const dataJsonString = parseBatchExecuteResponse(result.body, AUTOCOMPLETE_RPC_METHOD);
  return { query, hl, data: dataJsonString, fetchedAt: new Date().toISOString() };
}
