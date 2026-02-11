/**
 * Pagination diagnostic - manual test to verify proxy pagination works.
 *
 * Triggered via:
 *   chrome.runtime.sendMessage(
 *     {type: 'TEST_PAGINATION', keyword: 'check broken links'},
 *     r => console.log(JSON.stringify(r, null, 2))
 *   )
 *
 * Returns detailed results for each page: request URL, response status,
 * parsed results with extension IDs and positions.
 */

import { SettingsManager } from '@/shared/utils/settings';
import { getSearchParser } from '@/background/parsers/index';
import type { SearchResultEntry } from '@/background/parsers/types';

export interface PageResult {
  page: number;
  requestUrl: string;
  responseStatus: number | null;
  proxyStatus: number | null;
  resultCount: number;
  results: Array<{
    position: number;
    extensionId: string;
    name: string;
    userCount: number;
    rating: number;
  }>;
  nextPageToken: string | null;
  totalCount: number;
  htmlLength: number;
  error: string | null;
  durationMs: number;
}

export interface DiagnosticResult {
  ok: boolean;
  keyword: string;
  proxyUrl: string;
  parserVersion: string;
  pages: PageResult[];
  allResults: Array<{
    globalPosition: number;
    extensionId: string;
    name: string;
  }>;
  error?: string;
}

export async function runPaginationDiagnostic(
  keyword: string,
  maxPages: number = 2
): Promise<DiagnosticResult> {
  const settings = new SettingsManager();
  const config = await settings.getWithDefaults();

  if (!config.proxyUrl) {
    return {
      ok: false,
      keyword,
      proxyUrl: '',
      parserVersion: '',
      pages: [],
      allResults: [],
      error: 'No proxy URL configured. Set it in Settings first.',
    };
  }

  const parser = getSearchParser(config.parserVersion);
  const pages: PageResult[] = [];
  const allResults: Array<{ globalPosition: number; extensionId: string; name: string }> = [];
  let nextToken: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const pageResult: PageResult = {
      page: page + 1,
      requestUrl: '',
      responseStatus: null,
      proxyStatus: null,
      resultCount: 0,
      results: [],
      nextPageToken: null,
      totalCount: 0,
      htmlLength: 0,
      error: null,
      durationMs: 0,
    };

    // Build proxy URL
    const proxyUrl = new URL('/search', config.proxyUrl);
    proxyUrl.searchParams.set('q', keyword);
    if (nextToken) proxyUrl.searchParams.set('token', nextToken);
    if (config.proxyApiKey) proxyUrl.searchParams.set('key', config.proxyApiKey);

    pageResult.requestUrl = proxyUrl.toString().replace(
      config.proxyApiKey ?? '',
      config.proxyApiKey ? '[REDACTED]' : ''
    );

    const start = Date.now();

    try {
      const response = await fetch(proxyUrl.toString());
      pageResult.responseStatus = response.status;
      pageResult.durationMs = Date.now() - start;

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errBody = await response.json() as { error?: string };
          if (errBody.error) errorMsg = errBody.error;
        } catch {
          // Not JSON
        }
        pageResult.error = errorMsg;
        pages.push(pageResult);
        break;
      }

      const data = await response.json() as {
        html: string;
        status: number;
        url: string;
        htmlLength: number;
      };
      pageResult.proxyStatus = data.status;
      pageResult.htmlLength = data.htmlLength ?? data.html.length;

      // Parse
      const searchData = parser.parse(data.html);
      pageResult.resultCount = searchData.results.length;
      pageResult.nextPageToken = searchData.nextPageToken;
      pageResult.totalCount = searchData.totalCount;

      // Offset positions for pages beyond 1
      const positionOffset = allResults.length;
      pageResult.results = searchData.results.map((r: SearchResultEntry) => ({
        position: positionOffset + r.position,
        extensionId: r.extensionId,
        name: r.name,
        userCount: r.userCount,
        rating: r.rating,
      }));

      for (const r of pageResult.results) {
        allResults.push({
          globalPosition: r.position,
          extensionId: r.extensionId,
          name: r.name,
        });
      }

      nextToken = searchData.nextPageToken;
      pages.push(pageResult);

      if (!nextToken) break;
    } catch (err) {
      pageResult.durationMs = Date.now() - start;
      pageResult.error = err instanceof Error ? err.message : String(err);
      pages.push(pageResult);
      break;
    }

    // Short delay between pages.
    // setTimeout is acceptable here: this diagnostic runs synchronously within
    // a message handler, keeping the SW alive during active async work.
    // Production scan pipeline uses chrome.alarms (see queue-processor.ts).
    if (page < maxPages - 1 && nextToken) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return {
    ok: pages.every((p) => p.error === null),
    keyword,
    proxyUrl: config.proxyUrl,
    parserVersion: parser.version,
    pages,
    allResults,
  };
}
