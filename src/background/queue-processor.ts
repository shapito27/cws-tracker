/**
 * Queue Processor (Phase 1.6.2).
 *
 * Dequeues and executes the next pending job from IndexedDB.
 * - listing_scan: fetch CWS detail page, parse, save snapshot, detect events.
 * - keyword_scan: fetch CWS search page, parse, save rank snapshots for all tracked extensions.
 *
 * Error handling:
 * - HTTP 429: retriable (rate limited)
 * - HTTP 404 (listing_scan): mark extension as 'removed', job completed
 * - HTTP 5xx: retriable
 * - Network error: retriable
 * - ParserError: retriable
 * - Max retries exceeded: terminal failure
 *
 * Delay calculation:
 * - Normal: queueDelayMs + randomJitter(-jitterMs, +jitterMs)
 * - Retry: min(baseDelay * 2^retryCount, 600000) with max 10 min cap
 */

import { db } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import { calculatePermissionRiskScore } from '@/shared/utils/permissions';
import { today } from '@/shared/utils/dates';
import { detectChanges } from '@/background/event-detector';
import { getListingParser, getSearchParser, getAutocompleteParser, ParserError } from '@/background/parsers/index';
import type { ListingData, SearchData, SearchResultEntry, AutocompleteData, AutocompleteSuggestionExtension } from '@/background/parsers/types';
import type {
  QueueJob,
  ListingScanPayload,
  KeywordScanPayload,
  AutocompleteScanPayload,
  ListingSnapshot,
  RankSnapshot,
  AutocompleteSnapshot,
  AutocompleteKeywordSuggestion,
  EventRecord,
  Extension,
  Keyword,
  Settings,
  ScanLog,
  ScanLogLevel,
  ScanProgressMessage,
} from '@/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessResult {
  /** Whether there are more jobs to process after this one. */
  hasMore: boolean;
  /** Suggested delay in milliseconds before the next job. 0 if no more jobs. */
  delayMs: number;
}

/** Error classification for retry logic. */
export type ErrorKind = 'retriable' | 'terminal';

/** CWS base URL for fetching extension detail pages. */
const CWS_DETAIL_URL = 'https://chromewebstore.google.com/detail/';

/** CWS base URL for search. */
const CWS_SEARCH_URL = 'https://chromewebstore.google.com/search/';

/** Maximum backoff delay (10 minutes). */
const MAX_BACKOFF_MS = 600_000;

/** Base delay for retry backoff (2 minutes). */
const RETRY_BASE_DELAY_MS = 120_000;

/** Maximum length of response body preview stored in scan logs. */
const SCAN_LOG_PREVIEW_LENGTH = 100;

/** Minimum alarm delay in ms (1 minute per MV3 rules). */
const MIN_ALARM_DELAY_MS = 60_000;

/** Maximum number of search result pages to fetch per keyword scan. */
const MAX_SEARCH_PAGES = 3;

/** Base delay between pagination requests in milliseconds. */
const PAGINATION_DELAY_BASE_MS = 2_000;

/** Jitter range for pagination delay in milliseconds. */
const PAGINATION_JITTER_MS = 1_000;

// ---------------------------------------------------------------------------
// CWS Fetch (proxy-aware)
// ---------------------------------------------------------------------------

interface CWSFetchResult {
  html: string;
  cwsStatus: number;
}

/**
 * Fetch a CWS page, routing through the proxy when configured.
 *
 * When `settings.proxyUrl` is set, requests go to the proxy which returns
 * JSON `{ html, status, url, fetchedAt }`. The proxy handles CORS for
 * `chrome-extension://` origins.
 *
 * When no proxy is configured, falls back to direct fetch (works in tests
 * via mocked `fetchPage`, but blocked by Chrome CORS in production).
 */
async function fetchCWSPage(
  type: 'detail' | 'search',
  params: { id?: string; q?: string; token?: string },
  settings: Settings,
  fetchPage: (url: string) => Promise<Response>
): Promise<CWSFetchResult> {
  if (settings.proxyUrl) {
    const proxyUrl = new URL(`/${type}`, settings.proxyUrl);
    if (params.id) proxyUrl.searchParams.set('id', params.id);
    if (params.q) proxyUrl.searchParams.set('q', params.q);
    if (params.token) proxyUrl.searchParams.set('token', params.token);
    if (settings.proxyApiKey) proxyUrl.searchParams.set('key', settings.proxyApiKey);

    const response = await fetchPage(proxyUrl.toString());
    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const body = await response.json() as { error?: string };
        if (body.error) errorDetail = body.error;
      } catch {
        // Body not JSON - use statusText
      }
      throw new HttpError(response.status, errorDetail);
    }
    const data = await response.json() as { html: string; status: number };
    return { html: data.html, cwsStatus: data.status };
  }

  // Direct fetch fallback (works in tests via mocked fetchPage, blocked by CORS in Chrome)
  const baseUrl = type === 'detail' ? CWS_DETAIL_URL : CWS_SEARCH_URL;
  const path = type === 'detail' ? params.id! : encodeURIComponent(params.q!);
  let url = `${baseUrl}${path}`;
  if (params.token) url += `?token=${encodeURIComponent(params.token)}`;
  const response = await fetchPage(url);
  // Only read body for successful responses or 404 (which listing_scan handles gracefully).
  // For other errors, avoid consuming the body — throw immediately.
  if (!response.ok && response.status !== 404) {
    throw new HttpError(response.status, response.statusText);
  }
  return { html: await response.text(), cwsStatus: response.status };
}

// ---------------------------------------------------------------------------
// Scan Logging
// ---------------------------------------------------------------------------

/**
 * Build the URL string that fetchCWSPage will request, for logging purposes.
 */
function buildRequestUrl(
  type: 'detail' | 'search',
  params: { id?: string; q?: string; token?: string },
  settings: Settings
): string {
  if (settings.proxyUrl) {
    const proxyUrl = new URL(`/${type}`, settings.proxyUrl);
    if (params.id) proxyUrl.searchParams.set('id', params.id);
    if (params.q) proxyUrl.searchParams.set('q', params.q);
    if (params.token) proxyUrl.searchParams.set('token', params.token);
    if (settings.proxyApiKey) proxyUrl.searchParams.set('key', '[REDACTED]');
    return proxyUrl.toString();
  }
  const baseUrl = type === 'detail' ? CWS_DETAIL_URL : CWS_SEARCH_URL;
  const path = type === 'detail' ? params.id! : encodeURIComponent(params.q!);
  let url = `${baseUrl}${path}`;
  if (params.token) url += `?token=${encodeURIComponent(params.token)}`;
  return url;
}

/**
 * Persist a scan log entry to IndexedDB. Failures are swallowed so logging
 * never breaks the scan pipeline.
 */
async function writeScanLog(log: ScanLog): Promise<void> {
  try {
    await db.saveScanLog(log);
  } catch {
    // Logging must never break the scan pipeline
  }
}

/**
 * Fetch a CWS page with timing & logging. Wraps fetchCWSPage and records
 * request URL, response status, truncated body preview, and duration.
 */
async function fetchCWSPageWithLogging(
  type: 'detail' | 'search',
  params: { id?: string; q?: string; token?: string },
  settings: Settings,
  fetchPage: (url: string) => Promise<Response>,
  job: QueueJob,
  httpMethod: string = 'GET',
  pageNumber: number | null = null
): Promise<CWSFetchResult> {
  const requestUrl = buildRequestUrl(type, params, settings);
  const jobDetail = getJobDescription(job);
  const start = Date.now();

  try {
    const result = await fetchCWSPage(type, params, settings, fetchPage);
    const durationMs = Date.now() - start;
    const level: ScanLogLevel = result.cwsStatus >= 400 ? 'warn' : 'info';

    await writeScanLog({
      timestamp: new Date().toISOString(),
      jobId: job.id ?? null,
      jobType: job.type,
      level,
      requestUrl,
      responseStatus: result.cwsStatus,
      responsePreview: result.html.slice(0, SCAN_LOG_PREVIEW_LENGTH),
      durationMs,
      jobDetail,
      error: null,
      httpMethod,
      pageNumber,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const statusCode = error instanceof HttpError ? error.statusCode : null;

    await writeScanLog({
      timestamp: new Date().toISOString(),
      jobId: job.id ?? null,
      jobType: job.type,
      level: 'error',
      requestUrl,
      responseStatus: statusCode,
      responsePreview: '',
      durationMs,
      jobDetail,
      error: errorMessage,
      httpMethod,
      pageNumber,
    });

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Dependencies (injectable for testing)
// ---------------------------------------------------------------------------

export interface ProcessorDeps {
  fetchPage: (url: string) => Promise<Response>;
  sendMessage: (message: unknown) => void;
  settings: SettingsManager;
}

const defaultDeps: ProcessorDeps = {
  fetchPage: (url: string) => fetch(url),
  sendMessage: (message: unknown) => {
    try {
      chrome.runtime.sendMessage(message);
    } catch {
      // Dashboard may not be open - silently ignore
    }
  },
  settings: new SettingsManager(),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process the next pending job from the queue.
 *
 * @returns ProcessResult indicating if there are more jobs and suggested delay.
 */
export async function processNextJob(
  deps: ProcessorDeps = defaultDeps
): Promise<ProcessResult> {
  const job = await db.dequeueNext();

  if (job === null) {
    return { hasMore: false, delayMs: 0 };
  }

  try {
    await executeJob(job, deps);
    await db.updateJobStatus(job.id!, 'completed');

    // Send progress message
    const stats = await db.getQueueStats();
    const delayMs = await calculateNormalDelay(deps.settings);
    const hasPending = (await db.getPendingCount()) > 0;

    const progressMessage: ScanProgressMessage = {
      type: 'SCAN_PROGRESS',
      completed: stats.completed,
      total: stats.completed + stats.pending + stats.running,
      currentJob: getJobDescription(job),
      nextProcessingAt: hasPending
        ? new Date(Date.now() + Math.max(delayMs, MIN_ALARM_DELAY_MS)).toISOString()
        : undefined,
    };
    deps.sendMessage(progressMessage);

    return { hasMore: hasPending, delayMs };
  } catch (error) {
    return handleJobError(job, error, deps);
  }
}

// ---------------------------------------------------------------------------
// Job Execution
// ---------------------------------------------------------------------------

async function executeJob(
  job: QueueJob,
  deps: ProcessorDeps
): Promise<void> {
  switch (job.type) {
    case 'listing_scan':
      await processListingScan(job, deps);
      break;
    case 'keyword_scan':
      await processKeywordScan(job, deps);
      break;
    case 'autocomplete_scan':
      await processAutocompleteScan(job, deps);
      break;
    default:
      throw new Error(`Unsupported job type: ${job.type}`);
  }
}

/**
 * Process a listing_scan job:
 * 1. Fetch CWS detail page
 * 2. Parse with listing parser
 * 3. Calculate permission risk score
 * 4. Save listing snapshot
 * 5. Compare with previous snapshot, create events if changes detected
 * 6. Update extension metadata
 */
async function processListingScan(
  job: QueueJob,
  deps: ProcessorDeps
): Promise<void> {
  const payload = job.payload as ListingScanPayload;
  const { extensionId } = payload;

  const settings = await deps.settings.getWithDefaults();
  const parser = getListingParser(settings.parserVersion);

  const { html, cwsStatus } = await fetchCWSPageWithLogging(
    'detail', { id: extensionId }, settings, deps.fetchPage, job
  );

  if (cwsStatus === 404) {
    // Extension removed from CWS - mark as removed, job completes successfully
    await markExtensionRemoved(extensionId);
    return;
  }
  if (cwsStatus >= 400) {
    throw new HttpError(cwsStatus, `CWS returned HTTP ${cwsStatus}`);
  }

  const listingData = parser.parse(html);

  // Calculate permission risk score
  const permissionRiskScore = calculatePermissionRiskScore(
    listingData.permissions,
    listingData.hostPermissions
  );

  // Build snapshot
  const dateStr = today();
  const snapshot: ListingSnapshot = mapListingDataToSnapshot(
    listingData,
    extensionId,
    dateStr,
    permissionRiskScore
  );

  // Get previous snapshot for event detection
  const previousSnapshot = await db.getLatestListingSnapshot(extensionId);

  // Save snapshot
  await db.saveListingSnapshot(snapshot);

  // Detect and save events
  const events = detectChanges(previousSnapshot ?? null, snapshot);
  for (const event of events) {
    const savedId = await db.saveEvent(event);
    deps.sendMessage({
      type: 'NEW_EVENT',
      event: { ...event, id: savedId },
    });
  }

  // Update extension metadata
  await updateExtensionMetadata(extensionId, listingData);
}

/**
 * Process a keyword_scan job:
 * 1. Fetch CWS search pages (up to MAX_SEARCH_PAGES for coverage of top 30)
 * 2. Parse search results, merging across pages
 * 3. For each tracked extension in the project, record rank position
 * 4. Save all rank snapshots in a single transaction
 *
 * Pagination is best-effort: if page 1 succeeds but page 2+ fails, the
 * results from earlier pages are still saved. Extensions not found on
 * scanned pages get position: null ("30+").
 */
async function processKeywordScan(
  job: QueueJob,
  deps: ProcessorDeps
): Promise<void> {
  const payload = job.payload as KeywordScanPayload;
  const { keywordId, keyword } = payload;

  const settings = await deps.settings.getWithDefaults();
  const parser = getSearchParser(settings.parserVersion);

  // Find the keyword record to get its projectId
  const keywordRecord = await db.keywords.get(keywordId);
  if (!keywordRecord) {
    throw new Error(`Keyword ${keywordId} not found in database`);
  }

  // Get the project to find all tracked extensions
  const project = await db.getProject(keywordRecord.projectId);
  if (!project) {
    throw new Error(`Project ${keywordRecord.projectId} not found in database`);
  }

  // All tracked extension IDs for this project
  const trackedExtIds = [project.ownExtensionId, ...project.competitorIds];
  const dateStr = today();

  // Fetch search results with pagination (up to MAX_SEARCH_PAGES pages).
  // Page 1 must succeed (errors propagate). Pages 2+ are best-effort:
  // failures are logged but partial results from earlier pages are saved.
  const allResults: SearchResultEntry[] = [];
  let nextToken: string | null = null;
  let totalCount = 0;

  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    // Delay with jitter between pagination requests (not before page 1)
    if (page > 0) {
      const jitter = (Math.random() * 2 - 1) * PAGINATION_JITTER_MS;
      await paginationDelay(Math.max(0, PAGINATION_DELAY_BASE_MS + jitter));
    }

    const params: { q: string; token?: string } = { q: keyword };
    if (nextToken) {
      params.token = nextToken;
    }

    let html: string;
    let cwsStatus: number;

    try {
      const result = await fetchCWSPageWithLogging(
        'search', params, settings, deps.fetchPage, job,
        'GET', page + 1
      );
      html = result.html;
      cwsStatus = result.cwsStatus;
    } catch (error) {
      // Page 1 failure: propagate (no partial data to save)
      if (page === 0) throw error;
      // Page 2+ failure: log and stop pagination, save what we have
      const errMsg = error instanceof Error ? error.message : String(error);
      await writeScanLog({
        timestamp: new Date().toISOString(),
        jobId: job.id ?? null,
        jobType: job.type,
        level: 'warn',
        requestUrl: buildRequestUrl('search', params, settings),
        responseStatus: null,
        responsePreview: '',
        durationMs: 0,
        jobDetail: `Page ${page + 1} fetch failed for "${keyword}": ${errMsg}`,
        error: errMsg,
        httpMethod: 'GET',
        pageNumber: page + 1,
      });
      break;
    }

    if (cwsStatus >= 400) {
      // Page 1 HTTP error: propagate (no partial data to save)
      if (page === 0) {
        throw new HttpError(cwsStatus, `CWS returned HTTP ${cwsStatus}`);
      }
      // Page 2+ HTTP error: log and stop pagination, save what we have
      await writeScanLog({
        timestamp: new Date().toISOString(),
        jobId: job.id ?? null,
        jobType: job.type,
        level: 'warn',
        requestUrl: buildRequestUrl('search', params, settings),
        responseStatus: cwsStatus,
        responsePreview: html.slice(0, SCAN_LOG_PREVIEW_LENGTH),
        durationMs: 0,
        jobDetail: `Page ${page + 1} HTTP ${cwsStatus} for "${keyword}"`,
        error: `CWS returned HTTP ${cwsStatus}`,
        httpMethod: 'GET',
        pageNumber: page + 1,
      });
      break;
    }

    let searchData: SearchData;
    try {
      searchData = parser.parse(html);
    } catch (error) {
      // Page 1 parse failure: propagate
      if (page === 0) throw error;
      // Page 2+ parse failure: log and stop pagination, save what we have
      const errMsg = error instanceof Error ? error.message : String(error);
      await writeScanLog({
        timestamp: new Date().toISOString(),
        jobId: job.id ?? null,
        jobType: job.type,
        level: 'warn',
        requestUrl: buildRequestUrl('search', params, settings),
        responseStatus: cwsStatus,
        responsePreview: html.slice(0, SCAN_LOG_PREVIEW_LENGTH),
        durationMs: 0,
        jobDetail: `Page ${page + 1} parse failed for "${keyword}": ${errMsg}`,
        error: errMsg,
        httpMethod: 'GET',
        pageNumber: page + 1,
      });
      break;
    }

    // Adjust positions: offset by number of results from previous pages
    const positionOffset = allResults.length;
    for (const result of searchData.results) {
      allResults.push({
        ...result,
        position: positionOffset + result.position,
      });
    }

    // Capture totalCount from page 1 only (CWS may report different values
    // on subsequent pages, but the first page's count is canonical)
    if (page === 0) {
      totalCount = searchData.totalCount;
    }
    nextToken = searchData.nextPageToken;

    // Stop early if all tracked extensions found or no more pages
    const foundExtIds = new Set(allResults.map((r) => r.extensionId));
    const allFound = trackedExtIds.every((id) => foundExtIds.has(id));
    const trackedFound = trackedExtIds.filter((id) => foundExtIds.has(id));

    // Log per-page diagnostics
    const stopReason = allFound ? 'all_tracked_found' : !nextToken ? 'no_more_pages' : null;
    await writeScanLog({
      timestamp: new Date().toISOString(),
      jobId: job.id ?? null,
      jobType: job.type,
      level: 'info',
      requestUrl: buildRequestUrl('search', params, settings),
      responseStatus: cwsStatus,
      responsePreview: '',
      durationMs: 0,
      jobDetail: `Page ${page + 1} for "${keyword}": ${searchData.results.length} results, ` +
        `${trackedFound.length}/${trackedExtIds.length} tracked found` +
        (stopReason ? `, stopping: ${stopReason}` : ', continuing'),
      error: null,
      httpMethod: 'GET',
      pageNumber: page + 1,
    });

    if (allFound || !nextToken) {
      break;
    }
  }

  // Build rank snapshots for each tracked extension
  const rankSnapshots: RankSnapshot[] = trackedExtIds.map((extensionId) => {
    const searchEntry = allResults.find((r) => r.extensionId === extensionId);
    return {
      keywordId,
      extensionId,
      date: dateStr,
      position: searchEntry ? searchEntry.position : null,
      totalResults: totalCount,
      scannedAt: new Date(),
    };
  });

  // Save all rank snapshots atomically
  await db.saveRankSnapshots(rankSnapshots);
}

/**
 * Process an autocomplete_scan job:
 * 1. Fetch CWS autocomplete suggestions via proxy
 * 2. Parse response with autocomplete parser
 * 3. For each tracked extension that appears, record autocomplete position
 * 4. Save text suggestions for keyword discovery
 */
async function processAutocompleteScan(
  job: QueueJob,
  deps: ProcessorDeps
): Promise<void> {
  const payload = job.payload as AutocompleteScanPayload;
  const { keywordId, keyword } = payload;

  const settings = await deps.settings.getWithDefaults();

  // Find the keyword record to get its projectId
  const keywordRecord = await db.keywords.get(keywordId);
  if (!keywordRecord) {
    throw new Error(`Keyword ${keywordId} not found in database`);
  }

  // Get the project to find all tracked extensions
  const project = await db.getProject(keywordRecord.projectId);
  if (!project) {
    throw new Error(`Project ${keywordRecord.projectId} not found in database`);
  }

  const trackedExtIds = new Set([project.ownExtensionId, ...project.competitorIds]);
  const dateStr = today();

  // Fetch autocomplete data
  const data = await fetchAutocompleteWithLogging(
    keyword, settings, deps.fetchPage, job
  );

  // Parse response
  const parser = getAutocompleteParser();
  const autocompleteData = parser.parse(data);

  // Build autocomplete snapshots for tracked extensions that appear
  const snapshots: AutocompleteSnapshot[] = [];
  const textSuggestions: string[] = [];

  for (const suggestion of autocompleteData.suggestions) {
    if (suggestion.type === 'extension' && trackedExtIds.has(suggestion.extensionId)) {
      snapshots.push({
        keywordId,
        extensionId: suggestion.extensionId,
        date: dateStr,
        position: suggestion.position,
        suggestedName: suggestion.name,
        scannedAt: new Date(),
      });
    }
    if (suggestion.type === 'text') {
      textSuggestions.push(suggestion.text);
    }
  }

  // Save autocomplete snapshots (position tracking for tracked extensions)
  if (snapshots.length > 0) {
    await db.saveAutocompleteSnapshots(snapshots);
  }

  // Save text suggestions (keyword discovery)
  if (textSuggestions.length > 0) {
    await db.saveAutocompleteSuggestions({
      keywordId,
      date: dateStr,
      suggestions: textSuggestions,
      scannedAt: new Date(),
    });
  }
}

/**
 * Fetch autocomplete data from the proxy, with logging.
 */
async function fetchAutocompleteWithLogging(
  keyword: string,
  settings: Settings,
  fetchPage: (url: string) => Promise<Response>,
  job: QueueJob
): Promise<string> {
  if (!settings.proxyUrl) {
    throw new Error('Autocomplete scan requires a proxy URL to be configured');
  }

  const proxyUrl = new URL('/autocomplete', settings.proxyUrl);
  proxyUrl.searchParams.set('q', keyword);
  if (settings.proxyApiKey) proxyUrl.searchParams.set('key', settings.proxyApiKey);

  // Build a redacted URL for logging (reconstruct rather than string-replace)
  const logUrl = new URL(proxyUrl.toString());
  if (settings.proxyApiKey) logUrl.searchParams.set('key', '[REDACTED]');
  const requestUrl = logUrl.toString();
  const jobDetail = `Autocomplete for "${keyword}"`;
  const start = Date.now();

  try {
    const response = await fetchPage(proxyUrl.toString());
    const durationMs = Date.now() - start;

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const body = await response.json() as { error?: string };
        if (body.error) errorDetail = body.error;
      } catch {
        // Body not JSON - use statusText
      }

      await writeScanLog({
        timestamp: new Date().toISOString(),
        jobId: job.id ?? null,
        jobType: job.type,
        level: 'error',
        requestUrl,
        responseStatus: response.status,
        responsePreview: '',
        durationMs,
        jobDetail,
        error: errorDetail,
        httpMethod: 'GET',
      });

      throw new HttpError(response.status, errorDetail);
    }

    const responseData = await response.json() as { data: string };

    await writeScanLog({
      timestamp: new Date().toISOString(),
      jobId: job.id ?? null,
      jobType: job.type,
      level: 'info',
      requestUrl,
      responseStatus: 200,
      responsePreview: responseData.data.slice(0, SCAN_LOG_PREVIEW_LENGTH),
      durationMs,
      jobDetail,
      error: null,
      httpMethod: 'GET',
    });

    return responseData.data;
  } catch (error) {
    if (error instanceof HttpError) throw error;

    const durationMs = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);

    await writeScanLog({
      timestamp: new Date().toISOString(),
      jobId: job.id ?? null,
      jobType: job.type,
      level: 'error',
      requestUrl,
      responseStatus: null,
      responsePreview: '',
      durationMs,
      jobDetail,
      error: errorMessage,
      httpMethod: 'GET',
    });

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    statusText: string
  ) {
    super(`HTTP ${statusCode}: ${statusText}`);
    this.name = 'HttpError';
  }
}

/**
 * Classify an error as retriable or terminal.
 */
export function classifyError(error: unknown): ErrorKind {
  if (error instanceof HttpError) {
    if (error.statusCode === 429) return 'retriable';
    if (error.statusCode >= 500) return 'retriable';
    // Other HTTP errors (400, 403, etc.) - still retriable to be safe
    return 'retriable';
  }
  if (error instanceof ParserError) return 'retriable';
  if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
    return 'retriable';
  }
  // Unknown errors are retriable
  return 'retriable';
}

/**
 * Handle a job error: retry or mark terminal failure.
 */
async function handleJobError(
  job: QueueJob,
  error: unknown,
  deps: ProcessorDeps
): Promise<ProcessResult> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const kind = classifyError(error);

  if (kind === 'retriable' && job.retryCount < job.maxRetries) {
    // Retry: set back to pending with incremented retry count and backoff
    const newRetryCount = job.retryCount + 1;
    const backoffMs = calculateRetryDelay(newRetryCount);
    const nextScheduledAt = new Date(Date.now() + backoffMs);

    await db.queue.update(job.id!, {
      status: 'pending' as const,
      retryCount: newRetryCount,
      scheduledAt: nextScheduledAt,
      startedAt: null,
      error: errorMessage,
    });

    deps.sendMessage({
      type: 'SCAN_ERROR',
      jobId: job.id!,
      error: errorMessage,
      retriesLeft: job.maxRetries - newRetryCount,
    });

    const delayMs = await calculateNormalDelay(deps.settings);
    const hasPending = (await db.getPendingCount()) > 0;
    return { hasMore: hasPending, delayMs };
  }

  // Terminal failure
  await db.updateJobStatus(job.id!, 'failed', errorMessage);

  deps.sendMessage({
    type: 'SCAN_ERROR',
    jobId: job.id!,
    error: errorMessage,
    retriesLeft: 0,
  });

  const delayMs = await calculateNormalDelay(deps.settings);
  const hasPending = (await db.getPendingCount()) > 0;
  return { hasMore: hasPending, delayMs };
}

// ---------------------------------------------------------------------------
// Delay Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the normal delay between jobs (base + random jitter).
 */
async function calculateNormalDelay(settings: SettingsManager): Promise<number> {
  const config = await settings.getWithDefaults();
  const jitter = (Math.random() * 2 - 1) * config.queueJitterMs;
  return Math.max(0, config.queueDelayMs + jitter);
}

/**
 * Calculate retry backoff delay: min(baseDelay * 2^retryCount, MAX_BACKOFF_MS).
 * Retry 1 = 2 min, Retry 2 = 4 min, Retry 3 = 8 min (per PRD 6.2).
 */
export function calculateRetryDelay(retryCount: number): number {
  const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount - 1);
  return Math.min(delay, MAX_BACKOFF_MS);
}

/**
 * Short delay for pagination within a single keyword scan job.
 * Uses setTimeout since the SW stays alive during active job processing.
 */
function paginationDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapListingDataToSnapshot(
  data: ListingData,
  extensionId: string,
  date: string,
  permissionRiskScore: number
): ListingSnapshot {
  return {
    extensionId,
    date,
    title: data.name,
    shortDescription: data.shortDescription,
    fullDescription: data.fullDescription,
    rating: data.rating,
    ratingCount: data.ratingCount,
    reviewCount: data.reviewCount,
    userCount: data.userCount,
    userCountNumeric: data.userCountNumeric,
    version: data.version,
    lastUpdated: data.lastUpdated,
    size: data.size,
    permissions: data.permissions,
    hostPermissions: data.hostPermissions,
    permissionRiskScore,
    badgeFlags: data.badgeFlags,
    screenshotCount: data.screenshotCount,
    hasPromoVideo: data.hasPromoVideo,
    translationCount: data.translationCount,
    availableLocales: data.availableLocales,
    category: data.category,
    developerName: data.developerName,
    developerVerified: data.developerVerified,
    listingQualityScore: null,
    scannedAt: new Date(),
  };
}

async function markExtensionRemoved(extensionId: string): Promise<void> {
  const ext = await db.getExtension(extensionId);
  if (ext) {
    await db.saveExtension({ ...ext, status: 'removed' });
  }
}

async function updateExtensionMetadata(
  extensionId: string,
  listingData: ListingData
): Promise<void> {
  const ext = await db.getExtension(extensionId);
  if (ext) {
    await db.saveExtension({
      ...ext,
      name: listingData.name,
      iconUrl: listingData.iconUrl,
      lastScannedAt: new Date(),
      status: 'active',
    });
  }
}

function getJobDescription(job: QueueJob): string {
  if (job.type === 'listing_scan') {
    const payload = job.payload as ListingScanPayload;
    return `Scanning extension ${payload.extensionId.slice(0, 8)}...`;
  }
  if (job.type === 'keyword_scan') {
    const payload = job.payload as KeywordScanPayload;
    return `Searching "${payload.keyword}"`;
  }
  if (job.type === 'autocomplete_scan') {
    const payload = job.payload as AutocompleteScanPayload;
    return `Autocomplete "${payload.keyword}"`;
  }
  return `Processing ${job.type}`;
}
