/**
 * Queue Builder (Phase 1.6.1).
 *
 * Builds the initial set of QueueJob entries for a daily scan cycle.
 * - Creates `listing_scan` jobs: 1 per unique extension across all projects.
 * - Creates `keyword_scan` jobs: 1 per keyword (NOT deduplicated across projects).
 * - Deduplicates: if the same extension appears in multiple projects, only one listing_scan.
 * - Randomizes execution order within the cycle (see `buildDailyScanJobs`).
 */

import type { Project, Extension, Keyword, QueueJob } from '@/shared/types';

// ---------------------------------------------------------------------------
// Priority constants (lower number = higher priority)
// ---------------------------------------------------------------------------
//
// These still order the *scoped* builders below, each of which emits a single
// job type. They no longer order a full daily cycle: `buildDailyScanJobs`
// overwrites priority with a randomized sequence. See the note there.

/** Priority for listing scans of the user's own extension. */
export const PRIORITY_OWN_LISTING = 10;

/** Priority for listing scans of competitor extensions. */
export const PRIORITY_COMPETITOR_LISTING = 20;

/** Priority for keyword search scans. */
export const PRIORITY_KEYWORD_SCAN = 30;

/** Priority for autocomplete scans (after keyword scans). */
export const PRIORITY_AUTOCOMPLETE_SCAN = 40;

/** Priority for review scans (after autocomplete scans). */
export const PRIORITY_REVIEW_SCAN = 50;

/** Default maximum retries for queue jobs. */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Fisher-Yates shuffle. Returns a new array; does not mutate the input.
 */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the list of queue jobs for a daily scan (or manual refresh).
 *
 * @param projects  All projects to scan.
 * @param extensions  All known extensions (needed to look up metadata).
 * @param keywords  All keywords across all projects.
 * @returns Array of QueueJob entries ready to enqueue (without `id` set).
 */
export function buildDailyScanJobs(
  projects: Project[],
  extensions: Extension[],
  keywords: Keyword[]
): QueueJob[] {
  const now = new Date();
  const jobs: QueueJob[] = [];

  // Track which extension IDs already have a listing_scan job (deduplication).
  const seenExtensionIds = new Set<string>();

  // Collect own extension IDs across all projects for priority assignment.
  const ownExtensionIds = new Set<string>();
  for (const project of projects) {
    ownExtensionIds.add(project.ownExtensionId);
  }

  // --- Listing scan jobs ---
  // Process projects to create one listing_scan per unique extension.
  for (const project of projects) {
    // Own extension first
    if (project.ownExtensionId && !seenExtensionIds.has(project.ownExtensionId)) {
      seenExtensionIds.add(project.ownExtensionId);
      jobs.push(createListingScanJob(project.ownExtensionId, PRIORITY_OWN_LISTING, now));
    }

    // Competitor extensions
    for (const competitorId of project.competitorIds) {
      if (!seenExtensionIds.has(competitorId)) {
        seenExtensionIds.add(competitorId);
        // A competitor in one project might be the own extension in another
        const priority = ownExtensionIds.has(competitorId)
          ? PRIORITY_OWN_LISTING
          : PRIORITY_COMPETITOR_LISTING;
        jobs.push(createListingScanJob(competitorId, priority, now));
      }
    }
  }

  // --- Keyword scan jobs ---
  // One job per keyword (not deduplicated across projects per PRD Section 6.5).
  for (const keyword of keywords) {
    jobs.push(createKeywordScanJob(keyword, now));
  }

  // --- Autocomplete scan jobs ---
  // One job per keyword (runs after keyword scans, lower priority).
  for (const keyword of keywords) {
    jobs.push(createAutocompleteScanJob(keyword, now));
  }

  // --- Review scan jobs ---
  // One job per unique tracked extension (own + competitors), deduplicated —
  // reuse the set of extensions that already have a listing_scan.
  for (const extensionId of seenExtensionIds) {
    jobs.push(createReviewScanJob(extensionId, now));
  }

  // --- Randomize execution order -------------------------------------------
  //
  // Jobs used to run strictly by type: every listing scan, then every keyword
  // scan. At roughly one job a minute that put a fixed interval between an
  // extension's metadata sample and its rank sample — the same interval, in the
  // same direction, every day, for every extension.
  //
  // That is a confound, not a cosmetic detail. It makes the change log show a
  // metadata change consistently preceding a rank change by a near-constant lag,
  // which reads as a causal latency that the data does not contain. Shuffling
  // removes the pattern: across days the offset varies in both size and sign, so
  // any apparent lead-lag has to come from the store rather than from our
  // scan order.
  //
  // Cost, accepted deliberately: the own extension is no longer guaranteed to be
  // scanned first, so an interrupted cycle may not have covered it. Snapshots
  // record when they were taken, so partial cycles stay interpretable.
  return shuffle(jobs).map((job, index) => ({ ...job, priority: index }));
}

/**
 * Build only keyword_scan jobs for the given keywords.
 * Used for section-scoped manual refresh (e.g. "rescan keyword positions
 * for this project").
 */
export function buildKeywordScanJobs(keywords: Keyword[]): QueueJob[] {
  const now = new Date();
  return keywords.map((k) => createKeywordScanJob(k, now));
}

/**
 * Build only autocomplete_scan jobs for the given keywords.
 * Used for section-scoped manual refresh (e.g. "rescan AC positions
 * for this project").
 */
export function buildAutocompleteScanJobs(keywords: Keyword[]): QueueJob[] {
  const now = new Date();
  return keywords.map((k) => createAutocompleteScanJob(k, now));
}

/**
 * Build only review_scan jobs for the given extension IDs.
 * Used for section-scoped manual refresh ("refresh reviews for this project").
 * Duplicate IDs are deduplicated.
 */
export function buildReviewScanJobs(extensionIds: string[]): QueueJob[] {
  const now = new Date();
  const unique = [...new Set(extensionIds.filter((id) => !!id))];
  return unique.map((id) => createReviewScanJob(id, now));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createListingScanJob(
  extensionId: string,
  priority: number,
  scheduledAt: Date
): QueueJob {
  return {
    type: 'listing_scan',
    payload: { extensionId },
    status: 'pending',
    priority,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    scheduledAt,
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

function createKeywordScanJob(
  keyword: Keyword,
  scheduledAt: Date
): QueueJob {
  return {
    type: 'keyword_scan',
    payload: { keywordId: keyword.id!, keyword: keyword.text },
    status: 'pending',
    priority: PRIORITY_KEYWORD_SCAN,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    scheduledAt,
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

function createAutocompleteScanJob(
  keyword: Keyword,
  scheduledAt: Date
): QueueJob {
  return {
    type: 'autocomplete_scan',
    payload: { keywordId: keyword.id!, keyword: keyword.text },
    status: 'pending',
    priority: PRIORITY_AUTOCOMPLETE_SCAN,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    scheduledAt,
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

function createReviewScanJob(
  extensionId: string,
  scheduledAt: Date
): QueueJob {
  return {
    type: 'review_scan',
    payload: { extensionId },
    status: 'pending',
    priority: PRIORITY_REVIEW_SCAN,
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    scheduledAt,
    startedAt: null,
    completedAt: null,
    error: null,
  };
}
