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
import { today, epochToDateString } from '@/shared/utils/dates';
import { findEffectivePrevious, classifyDrop, RANK_NULL_LOOKBACK_DAYS } from '@/shared/utils/rank-history';
import { detectChanges } from '@/background/event-detector';
import { getListingParser, getSearchParser, getAutocompleteParser, getReviewsParser, ParserError } from '@/background/parsers/index';
import type { ListingData, SearchData, SearchResultEntry, AutocompleteData, AutocompleteSuggestionExtension, ParsedReview } from '@/background/parsers/types';
import type {
  QueueJob,
  ListingScanPayload,
  KeywordScanPayload,
  AutocompleteScanPayload,
  ReviewScanPayload,
  ListingSnapshot,
  RankSnapshot,
  AutocompleteSnapshot,
  AutocompleteKeywordSuggestion,
  Review,
  EventRecord,
  EventType,
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
const SCAN_LOG_PREVIEW_LENGTH = 2000;

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
  const jobDetail = await getJobDescription(job);
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

  // Read the scan cycle start so stats only count jobs from the current cycle
  // (completed jobs from prior cycles are retained for 7d in the queue table).
  const cycleStartedAtIso = await deps.settings.get('scanCycleStartedAt');
  const cycleStartedAt = cycleStartedAtIso ? new Date(cycleStartedAtIso) : null;

  // Broadcast 'running' phase BEFORE executing so the UI reflects liveness
  // during the multi-second CWS fetch (not just after completion).
  try {
    const preStats = await db.getQueueStats(cycleStartedAt);
    const runningMessage: ScanProgressMessage = {
      type: 'SCAN_PROGRESS',
      completed: preStats.completed,
      // dequeueNext() has already set this job to 'running', so it's counted here.
      total: preStats.completed + preStats.pending + preStats.running,
      currentJob: await getJobDescription(job),
      phase: 'running',
    };
    deps.sendMessage(runningMessage);
  } catch {
    // Broadcast failures must never block the scan pipeline.
  }

  try {
    await executeJob(job, deps);
    await db.updateJobStatus(job.id!, 'completed');

    // Send progress message
    const stats = await db.getQueueStats(cycleStartedAt);
    const delayMs = await calculateNormalDelay(deps.settings);
    const hasPending = (await db.getPendingCount()) > 0;

    const progressMessage: ScanProgressMessage = {
      type: 'SCAN_PROGRESS',
      completed: stats.completed,
      total: stats.completed + stats.pending + stats.running,
      currentJob: await getJobDescription(job),
      nextProcessingAt: hasPending
        ? new Date(Date.now() + Math.max(delayMs, MIN_ALARM_DELAY_MS)).toISOString()
        : undefined,
      phase: hasPending ? 'waiting' : 'completing',
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
    case 'review_scan':
      await processReviewScan(job, deps);
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
        kind: 'summary',
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
        kind: 'summary',
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
        kind: 'summary',
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
      kind: 'summary',
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

  // Detect rank changes and create events (must not fail the scan)
  try {
    await detectRankChanges(rankSnapshots, keyword, project.ownExtensionId, deps);
  } catch {
    // Rank change detection is supplementary — never fail the scan pipeline
  }
}

/**
 * Compare new rank snapshots with previous ones and create rank_change events
 * for any position changes.
 */
async function detectRankChanges(
  snapshots: RankSnapshot[],
  keyword: string,
  ownExtensionId: string,
  deps: ProcessorDeps
): Promise<void> {
  // Delete any existing rank_change events for these extensions on today's date
  // to prevent duplicates on same-day re-scans (mirrors saveRankSnapshots dedup)
  const dateStr = snapshots[0]?.date;
  if (dateStr) {
    for (const snap of snapshots) {
      const existingEvents = await db.events
        .where('[extensionId+date]')
        .equals([snap.extensionId, dateStr])
        .toArray();
      const rankEventIds = existingEvents
        .filter((e) => e.type === 'rank_change' && e.note.includes(`for "${keyword}"`))
        .map((e) => e.id)
        .filter((id): id is number => id !== undefined);
      if (rankEventIds.length > 0) {
        await db.events.bulkDelete(rankEventIds);
      }
    }
  }

  for (const snap of snapshots) {
    // Find the immediately-prior snapshot (any age) for this pair.
    const immediatePrev = await db.rank_snapshots
      .where('[keywordId+extensionId+date]')
      .between(
        [snap.keywordId, snap.extensionId, ''],
        [snap.keywordId, snap.extensionId, snap.date],
        true,
        false // exclude current date
      )
      .last();

    // If the immediate prev is `position: null` (extension was scanned but
    // not found yesterday — typical for partial-scan gap days), look further
    // back through the past lookback window for a non-null position. This
    // suppresses spurious "entered top 30" events when the same ext was
    // ranked just two days ago.
    let previous = immediatePrev;
    if (immediatePrev && immediatePrev.position === null) {
      const lowerBoundDate = (() => {
        const d = new Date(snap.date + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - RANK_NULL_LOOKBACK_DAYS);
        return d.toISOString().slice(0, 10);
      })();
      const lookbackWindow = await db.rank_snapshots
        .where('[keywordId+extensionId+date]')
        .between(
          [snap.keywordId, snap.extensionId, lowerBoundDate],
          [snap.keywordId, snap.extensionId, snap.date],
          true,
          false
        )
        .toArray();
      lookbackWindow.sort((a, b) => a.date.localeCompare(b.date));
      previous = findEffectivePrevious(
        lookbackWindow,
        immediatePrev,
        snap.date,
        RANK_NULL_LOOKBACK_DAYS
      );
    }

    if (!previous) continue; // No prior data to compare

    // Skip if position unchanged
    if (previous.position === snap.position) continue;

    // Debounce volatile single-scan drops: CWS rankings fluctuate, so a
    // borderline extension can fall off the captured top-30 for a single scan.
    // Suppress the "dropped out of top 30" event until a 2nd consecutive null
    // confirms the drop (mirrors the entering-side lookback). The provisional
    // null is still recorded as a snapshot and surfaces as an "unstable" hint
    // in the UI loaders.
    if (classifyDrop(snap.position, immediatePrev?.position, previous.position) === 'provisional') {
      continue;
    }

    const formatPos = (p: number | null): string => p === null ? '30+' : `#${p}`;
    const isOwn = snap.extensionId === ownExtensionId;

    // Get extension name for a readable note
    const ext = await db.getExtension(snap.extensionId);
    const extName = ext?.name || snap.extensionId.slice(0, 8) + '...';

    let note: string;
    if (previous.position !== null && snap.position !== null) {
      const delta = previous.position - snap.position;
      const direction = delta > 0 ? 'improved' : 'dropped';
      note = `${isOwn ? '' : '[Competitor] '}${extName} ${direction} from ${formatPos(previous.position)} to ${formatPos(snap.position)} for "${keyword}"`;
    } else if (previous.position === null && snap.position !== null) {
      note = `${isOwn ? '' : '[Competitor] '}${extName} entered top 30 at ${formatPos(snap.position)} for "${keyword}"`;
    } else {
      note = `${isOwn ? '' : '[Competitor] '}${extName} dropped out of top 30 for "${keyword}"`;
    }

    const event: EventRecord = {
      extensionId: snap.extensionId,
      date: snap.date,
      type: 'rank_change',
      field: 'position',
      oldValue: String(previous.position ?? 'null'),
      newValue: String(snap.position ?? 'null'),
      note,
      detectedAt: new Date(),
    };

    try {
      const savedId = await db.saveEvent(event);
      deps.sendMessage({
        type: 'NEW_EVENT',
        event: { ...event, id: savedId },
      });
    } catch {
      // Event saving should not break the scan pipeline
    }
  }
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
  const foundExtIds = new Set<string>();

  for (const suggestion of autocompleteData.suggestions) {
    if (suggestion.type === 'extension' && trackedExtIds.has(suggestion.extensionId)) {
      foundExtIds.add(suggestion.extensionId);
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

  // Save "not found" snapshots for tracked extensions NOT in AC results
  for (const extId of trackedExtIds) {
    if (!foundExtIds.has(extId)) {
      snapshots.push({
        keywordId,
        extensionId: extId,
        date: dateStr,
        position: null,
        suggestedName: null,
        scannedAt: new Date(),
      });
    }
  }

  // Save autocomplete snapshots (position tracking for all tracked extensions)
  await db.saveAutocompleteSnapshots(snapshots);

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
  const jobDetail = await getJobDescription(job);
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

/**
 * Process a review_scan job:
 * 1. Fetch the extension's reviews via the proxy /reviews endpoint (page 1).
 * 2. Parse with the reviews parser.
 * 3. Upsert reviews (change-detecting) into the reviews table.
 * 4. Emit events for new / edited / newly-replied reviews.
 *
 * Pagination (fetching up to reviewFetchLimit) is layered on in a later phase;
 * this handler captures the newest page.
 */
async function processReviewScan(
  job: QueueJob,
  deps: ProcessorDeps
): Promise<void> {
  const payload = job.payload as ReviewScanPayload;
  const { extensionId } = payload;

  const settings = await deps.settings.getWithDefaults();

  const raw = await fetchReviewsWithLogging(extensionId, undefined, settings, deps.fetchPage, job);

  const parser = getReviewsParser();
  const parsed = parser.parse(raw);

  const now = new Date();
  const rows: Review[] = parsed.reviews.map((p) => mapParsedReviewToRow(p, extensionId, now));

  const changes = await db.saveReviews(rows);

  // Persist the CWS-reported text-review count so the UI can compute the exact
  // text-vs-empty split even when the captured corpus is capped. Best-effort.
  if (parsed.textReviewCount !== null) {
    try {
      const ext = await db.getExtension(extensionId);
      if (ext) {
        await db.saveExtension({ ...ext, reviewTextCount: parsed.textReviewCount });
      }
    } catch {
      // Metadata update is supplementary — swallow.
    }
  }

  // Emit events for detected changes. Must never fail the scan pipeline.
  try {
    await emitReviewEvents(rows, changes, deps);
  } catch {
    // Event creation is supplementary — swallow.
  }
}

/**
 * Map a parsed review to a stored Review row. `contentHash` is left blank here;
 * `db.saveReviews` computes and sets it authoritatively.
 */
function mapParsedReviewToRow(p: ParsedReview, extensionId: string, now: Date): Review {
  return {
    reviewId: p.reviewId,
    extensionId: p.extensionId || extensionId,
    reviewerName: p.reviewerName,
    reviewerAvatar: p.reviewerAvatar,
    rating: p.rating,
    text: p.text,
    postedDate: epochToDateString(p.postedAtEpoch),
    updatedDate: epochToDateString(p.updatedAtEpoch),
    postedAtEpoch: p.postedAtEpoch,
    updatedAtEpoch: p.updatedAtEpoch,
    helpfulCount: p.helpfulCount,
    devReplyAuthor: p.devReply?.author ?? null,
    devReplyText: p.devReply?.text ?? null,
    devReplyDate: p.devReply ? epochToDateString(p.devReply.atEpoch) : null,
    hasText: p.text.trim().length > 0,
    versionReviewed: p.versionReviewed,
    language: p.language,
    contentHash: '',
    firstSeenAt: now,
    lastSeenAt: now,
    lastChangedAt: null,
    isDeleted: false,
  };
}

/** Build and persist EventRecords for new / edited / newly-replied reviews. */
async function emitReviewEvents(
  rows: Review[],
  changes: { new: string[]; edited: string[]; replied: string[] },
  deps: ProcessorDeps
): Promise<void> {
  const byId = new Map(rows.map((r) => [r.reviewId, r]));
  const dateStr = today();
  const excerpt = (t: string): string => {
    const s = t.trim();
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  };

  const emit = async (reviewId: string, type: EventType, field: string, note: string): Promise<void> => {
    const review = byId.get(reviewId);
    if (!review) return;
    const event: EventRecord = {
      extensionId: review.extensionId,
      date: dateStr,
      type,
      field,
      oldValue: null,
      newValue: reviewId,
      note,
      detectedAt: new Date(),
    };
    const savedId = await db.saveEvent(event);
    deps.sendMessage({ type: 'NEW_EVENT', event: { ...event, id: savedId } });
  };

  for (const id of changes.new) {
    const r = byId.get(id);
    if (!r) continue;
    const name = r.reviewerName || 'Anonymous';
    const note = r.hasText
      ? `New ★${r.rating} review from "${name}": "${excerpt(r.text)}"`
      : `New ★${r.rating} rating from "${name}"`;
    await emit(id, 'review_new', 'rating', note);
  }
  for (const id of changes.edited) {
    const r = byId.get(id);
    if (!r) continue;
    await emit(id, 'review_edited', 'content', `Review from "${r.reviewerName || 'Anonymous'}" was edited (now ★${r.rating})`);
  }
  for (const id of changes.replied) {
    const r = byId.get(id);
    if (!r) continue;
    await emit(id, 'review_reply', 'devReply', `Developer replied to ${r.reviewerName || 'a'}'s review`);
  }
}

/**
 * Fetch reviews from the proxy /reviews endpoint, with logging.
 * Returns the raw `data` JSON string for the reviews parser.
 */
async function fetchReviewsWithLogging(
  extensionId: string,
  token: string | undefined,
  settings: Settings,
  fetchPage: (url: string) => Promise<Response>,
  job: QueueJob
): Promise<string> {
  if (!settings.proxyUrl) {
    throw new Error('Review scan requires a proxy URL to be configured');
  }

  const proxyUrl = new URL('/reviews', settings.proxyUrl);
  proxyUrl.searchParams.set('id', extensionId);
  if (token) proxyUrl.searchParams.set('token', token);
  if (settings.proxyApiKey) proxyUrl.searchParams.set('key', settings.proxyApiKey);

  // Redacted URL for logging.
  const logUrl = new URL(proxyUrl.toString());
  if (settings.proxyApiKey) logUrl.searchParams.set('key', '[REDACTED]');
  const requestUrl = logUrl.toString();
  const jobDetail = await getJobDescription(job);
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
      responsePreview: (responseData.data ?? '').slice(0, SCAN_LOG_PREVIEW_LENGTH),
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
    developerEmail: data.developerEmail,
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

  // Backfill project names: if the project name is still the raw extension ID
  // (auto-generated default), update it to the human-readable listing name.
  if (listingData.name) {
    const projects = await db.getProjectsByOwnExtensionId(extensionId);
    for (const project of projects) {
      if (project.name === extensionId) {
        await db.saveProject({
          ...project,
          name: listingData.name,
          updatedAt: new Date(),
        });
      }
    }
  }
}

async function getJobDescription(job: QueueJob): Promise<string> {
  if (job.type === 'listing_scan') {
    const payload = job.payload as ListingScanPayload;
    try {
      const ext = await db.extensions.get(payload.extensionId);
      if (ext?.name) return `Listing: ${ext.name} (${payload.extensionId})`;
    } catch {
      // DB lookup failed — fall through to ID-only description
    }
    return `Listing: ${payload.extensionId}`;
  }
  if (job.type === 'keyword_scan') {
    const payload = job.payload as KeywordScanPayload;
    return `Search: "${payload.keyword}" (kw#${payload.keywordId})`;
  }
  if (job.type === 'autocomplete_scan') {
    const payload = job.payload as AutocompleteScanPayload;
    return `Autocomplete: "${payload.keyword}" (kw#${payload.keywordId})`;
  }
  if (job.type === 'review_scan') {
    const payload = job.payload as ReviewScanPayload;
    try {
      const ext = await db.extensions.get(payload.extensionId);
      if (ext?.name) return `Reviews: ${ext.name} (${payload.extensionId})`;
    } catch {
      // DB lookup failed — fall through to ID-only description
    }
    return `Reviews: ${payload.extensionId}`;
  }
  return `Processing ${job.type}`;
}
