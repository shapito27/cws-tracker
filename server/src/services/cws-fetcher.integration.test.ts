import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchDetail, fetchSearch, fetchAutocomplete,
  clearSessionCache, cacheSession, SEARCH_RPC_METHOD, AUTOCOMPLETE_RPC_METHOD,
  CWS_BASE,
} from './cws-fetcher.js';

function mockFetchResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
}

describe('fetchDetail', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse('<html>detail page</html>'));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns structured response with correct fields', async () => {
    const result = await fetchDetail('cjpalhdlnbpafiamejdnhcphjbkeiagm', 'en');
    expect(result.url).toContain('/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm');
    expect(result.url).toContain('hl=en');
    expect(result.status).toBe(200);
    expect(result.html).toBe('<html>detail page</html>');
    expect(result.htmlLength).toBe('<html>detail page</html>'.length);
    expect(result.fetchedAt).toBeTruthy();
  });

  it('passes correct URL to CWS', async () => {
    await fetchDetail('abcdefghijklmnopqrstuvwxyzabcdef', 'ja');
    const calledUrl = (vi.mocked(fetch).mock.calls[0]![0] as string);
    expect(calledUrl).toContain(`${CWS_BASE}/detail/abcdefghijklmnopqrstuvwxyzabcdef`);
    expect(calledUrl).toContain('hl=ja');
  });

  it('sends User-Agent and Accept headers', async () => {
    await fetchDetail('cjpalhdlnbpafiamejdnhcphjbkeiagm', 'en');
    const headers = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('Chrome');
    expect(headers['Accept']).toContain('text/html');
  });

  it('propagates CWS error status in response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse('Not Found', 404));
    const result = await fetchDetail('cjpalhdlnbpafiamejdnhcphjbkeiagm', 'en');
    expect(result.status).toBe(404);
  });

  it('throws on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
    await expect(fetchDetail('cjpalhdlnbpafiamejdnhcphjbkeiagm', 'en')).rejects.toThrow('Network error');
  });
});

describe('fetchSearch', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('page 1 (no token)', () => {
    it('fetches CWS search page and returns HTML', async () => {
      const searchHtml = '<html>search results "cfb2h":"test-bl","FdrFJe":"sid1","SNlM0e":"at1"</html>';
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse(searchHtml));

      const result = await fetchSearch('ad blocker', 'en');
      expect(result.url).toContain('/search/ad%20blocker');
      expect(result.html).toBe(searchHtml);
      expect(result.status).toBe(200);
    });

    it('caches session params extracted from page 1', async () => {
      const html = 'data "cfb2h":"cached-bl","FdrFJe":"cached-sid","SNlM0e":"cached-at" end';
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse(html));

      await fetchSearch('test', 'en');
      // Session should now be cached — verify by doing a page 2 request without needing a fresh fetch
      const batchResponse = `)]}'\n[["wrb.fr","${SEARCH_RPC_METHOD}","[[\\"data\\"]]",null,null,null,"generic"]]\n`;
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse(batchResponse));

      const page2 = await fetchSearch('test', 'en', 'page-token');
      expect(page2.html).toContain('AF_initDataCallback');
      // Only 2 fetch calls total: page 1 + page 2 batchexecute (no extra fetch for session)
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('page 2+ (with token)', () => {
    it('uses batchexecute RPC when token provided', async () => {
      cacheSession({ bl: 'test-bl', sid: 'test-sid', at: 'test-at' });
      const batchResponse = `)]}'\n[["wrb.fr","${SEARCH_RPC_METHOD}","[[\\"page2-data\\"]]",null,null,null,"generic"]]\n`;
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse(batchResponse));

      const result = await fetchSearch('ad blocker', 'en', 'next-page-token');
      expect(result.html).toContain('AF_initDataCallback');
      expect(result.html).toContain('[["page2-data"]]');
      expect(result.status).toBe(200);

      const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
      expect(calledUrl).toContain('batchexecute');
    });

    it('fetches fresh session params if cache is empty', async () => {
      // First call: fetch search page for session params
      const searchHtml = '"cfb2h":"fresh-bl","FdrFJe":"fresh-sid","SNlM0e":"fresh-at"';
      // Second call: batchexecute
      const batchResponse = `)]}'\n[["wrb.fr","${SEARCH_RPC_METHOD}","[[\\"data\\"]]",null,null,null,"generic"]]\n`;
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockFetchResponse(searchHtml))
        .mockResolvedValueOnce(mockFetchResponse(batchResponse));

      const result = await fetchSearch('test', 'en', 'token-123');
      expect(result.html).toContain('AF_initDataCallback');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('throws when batchexecute returns non-200', async () => {
      cacheSession({ bl: 'bl', sid: '', at: '' });
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse('error', 429));

      await expect(fetchSearch('q', 'en', 'tok')).rejects.toThrow('HTTP 429');
    });

    it('throws when session params cannot be extracted', async () => {
      vi.mocked(fetch).mockResolvedValue(mockFetchResponse('<html>no wiz data</html>'));
      await expect(fetchSearch('q', 'en', 'tok')).rejects.toThrow('session parameters');
    });
  });
});

describe('fetchAutocomplete', () => {
  beforeEach(() => {
    clearSessionCache();
    vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns autocomplete data via batchexecute', async () => {
    const batchResponse = `)]}'\n[["wrb.fr","${AUTOCOMPLETE_RPC_METHOD}","[\\"sug1\\",\\"sug2\\"]",null,null,null,"generic"]]\n`;
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(batchResponse));

    const result = await fetchAutocomplete('ad', 'en');
    expect(result.query).toBe('ad');
    expect(result.hl).toBe('en');
    expect(result.data).toBe('["sug1","sug2"]');
    expect(result.fetchedAt).toBeTruthy();
  });

  it('uses cached build label if available', async () => {
    cacheSession({ bl: 'cached-bl', sid: '', at: '' });
    const batchResponse = `)]}'\n[["wrb.fr","${AUTOCOMPLETE_RPC_METHOD}","[]",null,null,null,"generic"]]\n`;
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(batchResponse));

    await fetchAutocomplete('test', 'en');
    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain('bl=cached-bl');
  });

  it('works without cached build label', async () => {
    const batchResponse = `)]}'\n[["wrb.fr","${AUTOCOMPLETE_RPC_METHOD}","[]",null,null,null,"generic"]]\n`;
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(batchResponse));

    const result = await fetchAutocomplete('test', 'en');
    expect(result.data).toBe('[]');
    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).not.toContain('bl=');
  });

  it('throws when batchexecute returns non-200', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse('error', 500));
    await expect(fetchAutocomplete('q', 'en')).rejects.toThrow('HTTP 500');
  });

  it('sends POST with correct headers', async () => {
    const batchResponse = `)]}'\n[["wrb.fr","${AUTOCOMPLETE_RPC_METHOD}","[]",null,null,null,"generic"]]\n`;
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(batchResponse));

    await fetchAutocomplete('test', 'en');
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toContain('x-www-form-urlencoded');
    expect(headers['Origin']).toBe(CWS_BASE);
    expect(headers['X-Same-Domain']).toBe('1');
  });
});
