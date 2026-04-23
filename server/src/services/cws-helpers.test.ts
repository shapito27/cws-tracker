import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildBatchExecuteUrl,
  buildSearchRpcBody,
  buildAutocompleteBatchUrl,
  buildAutocompleteRpcBody,
  wrapInSyntheticHtml,
  getCachedSession,
  cacheSession,
  clearSessionCache,
  EXTENSION_ID_REGEX,
  SEARCH_RPC_METHOD,
  AUTOCOMPLETE_RPC_METHOD,
  SEARCH_PAGE_SIZE,
  CWS_BASE,
  BATCHEXECUTE_PATH,
  type SessionParams,
} from './cws-fetcher.js';

// --- buildBatchExecuteUrl ---

describe('buildBatchExecuteUrl', () => {
  const params: SessionParams = { bl: 'build-label-1', sid: 'session-123', at: 'csrf-tok' };

  it('includes rpcids, bl, hl, and source-path', () => {
    const url = new URL(buildBatchExecuteUrl(params, SEARCH_RPC_METHOD, 'ad blocker', 'en'));
    expect(url.origin + url.pathname).toBe(`${CWS_BASE}${BATCHEXECUTE_PATH}`);
    expect(url.searchParams.get('rpcids')).toBe(SEARCH_RPC_METHOD);
    expect(url.searchParams.get('bl')).toBe('build-label-1');
    expect(url.searchParams.get('hl')).toBe('en');
    expect(url.searchParams.get('source-path')).toBe('/search/ad%20blocker');
  });

  it('includes f.sid when sid is non-empty', () => {
    const url = new URL(buildBatchExecuteUrl(params, SEARCH_RPC_METHOD, 'test', 'en'));
    expect(url.searchParams.get('f.sid')).toBe('session-123');
  });

  it('omits f.sid when sid is empty', () => {
    const noSid: SessionParams = { bl: 'bl', sid: '', at: '' };
    const url = new URL(buildBatchExecuteUrl(noSid, SEARCH_RPC_METHOD, 'test', 'en'));
    expect(url.searchParams.has('f.sid')).toBe(false);
  });

  it('sets soc-app, soc-platform, soc-device to 1 and rt to c', () => {
    const url = new URL(buildBatchExecuteUrl(params, SEARCH_RPC_METHOD, 'q', 'en'));
    expect(url.searchParams.get('soc-app')).toBe('1');
    expect(url.searchParams.get('soc-platform')).toBe('1');
    expect(url.searchParams.get('soc-device')).toBe('1');
    expect(url.searchParams.get('rt')).toBe('c');
  });

  it('works with different locales', () => {
    const url = new URL(buildBatchExecuteUrl(params, SEARCH_RPC_METHOD, 'q', 'ja'));
    expect(url.searchParams.get('hl')).toBe('ja');
  });

  it('URL-encodes special chars in source-path', () => {
    const url = new URL(buildBatchExecuteUrl(params, SEARCH_RPC_METHOD, 'foo bar', 'en'));
    expect(url.searchParams.get('source-path')).toBe('/search/foo%20bar');
  });

  it('URL-encodes path traversal attempts', () => {
    const url = new URL(buildBatchExecuteUrl(params, SEARCH_RPC_METHOD, '../../../admin', 'en'));
    const sourcePath = url.searchParams.get('source-path')!;
    expect(sourcePath).not.toContain('../');
    expect(sourcePath).toContain('%2F');
  });
});

// --- buildSearchRpcBody ---

describe('buildSearchRpcBody', () => {
  it('encodes query, page size, and token into f.req', () => {
    const body = buildSearchRpcBody('ad blocker', 'page-token-2', 'csrf-tok');
    expect(body).toContain('f.req=');
    const decoded = decodeURIComponent(body.split('f.req=')[1]!.split('&')[0]!);
    const parsed = JSON.parse(decoded);
    expect(parsed[0][0][0]).toBe(SEARCH_RPC_METHOD);
    const inner = JSON.parse(parsed[0][0][1]);
    expect(inner[0][1][0]).toBeNull();
    expect(inner[0][1][3][0]).toBe('ad blocker');
    expect(inner[0][1][3][1][0]).toBe(SEARCH_PAGE_SIZE);
    expect(inner[0][1][3][1][1]).toBe('page-token-2');
    expect(inner[0][1][3][3]).toEqual(['EXTENSION']);
  });

  it('appends at= when CSRF token is provided', () => {
    const body = buildSearchRpcBody('q', 'tok', 'my-csrf');
    expect(body).toContain('at=my-csrf');
  });

  it('omits at= when CSRF token is empty', () => {
    const body = buildSearchRpcBody('q', 'tok', '');
    expect(body).not.toContain('at=');
  });
});

// --- buildAutocompleteBatchUrl ---

describe('buildAutocompleteBatchUrl', () => {
  it('includes QcU9bc RPC method', () => {
    const url = new URL(buildAutocompleteBatchUrl('bl-val', 'ad', 'en'));
    expect(url.searchParams.get('rpcids')).toBe(AUTOCOMPLETE_RPC_METHOD);
  });

  it('includes bl when provided', () => {
    const url = new URL(buildAutocompleteBatchUrl('my-bl', 'q', 'en'));
    expect(url.searchParams.get('bl')).toBe('my-bl');
  });

  it('omits bl when null', () => {
    const url = new URL(buildAutocompleteBatchUrl(null, 'q', 'en'));
    expect(url.searchParams.has('bl')).toBe(false);
  });

  it('URL-encodes the query in source-path', () => {
    const url = new URL(buildAutocompleteBatchUrl(null, 'ad blocker', 'en'));
    expect(url.searchParams.get('source-path')).toBe('/search/ad%20blocker');
  });
});

// --- buildAutocompleteRpcBody ---

describe('buildAutocompleteRpcBody', () => {
  it('encodes query into f.req with QcU9bc method', () => {
    const body = buildAutocompleteRpcBody('ad block');
    expect(body).toContain('f.req=');
    const decoded = decodeURIComponent(body.split('f.req=')[1]!.split('&')[0]!);
    const parsed = JSON.parse(decoded);
    expect(parsed[0][0][0]).toBe(AUTOCOMPLETE_RPC_METHOD);
    const inner = JSON.parse(parsed[0][0][1]);
    expect(inner[0]).toBe('ad block');
  });

  it('handles special characters in query', () => {
    const body = buildAutocompleteRpcBody('test & "quotes"');
    expect(body).toContain('f.req=');
    const decoded = decodeURIComponent(body.split('f.req=')[1]!.split('&')[0]!);
    const parsed = JSON.parse(decoded);
    const inner = JSON.parse(parsed[0][0][1]);
    expect(inner[0]).toBe('test & "quotes"');
  });
});

// --- wrapInSyntheticHtml ---

describe('wrapInSyntheticHtml', () => {
  it('wraps data in AF_initDataCallback script tag', () => {
    const result = wrapInSyntheticHtml('[[1,2,3]]');
    expect(result).toBe("<script>AF_initDataCallback({key: 'ds:1', hash: '1', data:[[1,2,3]]});</script>");
  });

  it('preserves the data string exactly', () => {
    const data = '[["complex","data",null,[1,2]]]';
    const result = wrapInSyntheticHtml(data);
    expect(result).toContain(`data:${data}`);
  });

  it('handles empty data', () => {
    const result = wrapInSyntheticHtml('');
    expect(result).toContain('data:');
  });
});

// --- Session cache ---

describe('session cache', () => {
  beforeEach(() => {
    clearSessionCache();
  });

  it('returns null when cache is empty', () => {
    expect(getCachedSession()).toBeNull();
  });

  it('returns cached params after cacheSession', () => {
    const params: SessionParams = { bl: 'bl1', sid: 'sid1', at: 'at1' };
    cacheSession(params);
    expect(getCachedSession()).toEqual(params);
  });

  it('returns null after clearSessionCache', () => {
    cacheSession({ bl: 'bl', sid: 'sid', at: 'at' });
    clearSessionCache();
    expect(getCachedSession()).toBeNull();
  });

  it('returns null after TTL expires', () => {
    vi.useFakeTimers();
    try {
      cacheSession({ bl: 'bl', sid: 'sid', at: 'at' });
      expect(getCachedSession()).not.toBeNull();
      vi.advanceTimersByTime(3600_001);
      expect(getCachedSession()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('overwrites previous cache', () => {
    cacheSession({ bl: 'old', sid: '', at: '' });
    cacheSession({ bl: 'new', sid: '', at: '' });
    expect(getCachedSession()!.bl).toBe('new');
  });
});

// --- EXTENSION_ID_REGEX ---

describe('EXTENSION_ID_REGEX', () => {
  it('matches valid 32-char lowercase extension ID', () => {
    expect(EXTENSION_ID_REGEX.test('cjpalhdlnbpafiamejdnhcphjbkeiagm')).toBe(true);
  });

  it('rejects 31 characters', () => {
    expect(EXTENSION_ID_REGEX.test('cjpalhdlnbpafiamejdnhcphjbkeiag')).toBe(false);
  });

  it('rejects 33 characters', () => {
    expect(EXTENSION_ID_REGEX.test('cjpalhdlnbpafiamejdnhcphjbkeiagmx')).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(EXTENSION_ID_REGEX.test('CJPALHDLNBPAFIAMEJDNHCPHJBKEIAGM')).toBe(false);
  });

  it('rejects numbers', () => {
    expect(EXTENSION_ID_REGEX.test('cjpalhdlnbpafiamejdnhcphjbke1234')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(EXTENSION_ID_REGEX.test('')).toBe(false);
  });

  it('rejects mixed case', () => {
    expect(EXTENSION_ID_REGEX.test('cjpalhdlnbpafiamejdnhcphjbkeiAgm')).toBe(false);
  });

  it('rejects with special characters', () => {
    expect(EXTENSION_ID_REGEX.test('cjpalhdlnbpafiamejdnhcphjbke-agm')).toBe(false);
  });
});
