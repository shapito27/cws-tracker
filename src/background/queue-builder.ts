/**
 * Queue Builder (Phase 1.6.1).
 *
 * Builds the initial set of QueueJob entries for a daily scan cycle.
 * - Creates `listing_scan` jobs: 1 per unique extension across all projects.
 * - Creates `keyword_scan` jobs: 1 per keyword (NOT deduplicated across projects).
 * - Deduplicates: if the same extension appears in multiple projects, only one listing_scan.
 * - Orders the cycle in two phases: per-extension stats first, then ranking
 *   (see `buildDailyScanJobs`).
 */

import type { Project, Extension, Keyword, QueueJob } from '@/shared/types';

// ---------------------------------------------------------------------------
// Priority constants (lower number = higher priority)
// ---------------------------------------------------------------------------
//
// These still order the *scoped* builders below, each of which emits a single
// job type. They no longer order a full daily cycle: `buildDailyScanJobs`
// overwrites priority with its own two-phase sequence. See the note there.

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

/**
 * Priority base for translation audit jobs (manual only, after everything a
 * scan cycle enqueues). Each job adds its ordinal so locales drain in the
 * order they were requested, extension by extension.
 */
export const PRIORITY_TRANSLATION_AUDIT = 60;

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
 * Identifies the scan cycle a set of jobs belongs to.
 *
 * Stamped onto every job so the snapshots it writes land in the right slot and
 * on the right date even if the cycle outlives midnight or a service-worker
 * restart. Omitted by callers that predate slots, which behave as slot 0 with
 * the execution-time date.
 */
export interface ScanCycleContext {
  /** 0-based scan slot within the day. */
  slot: number;
  /** YYYY-MM-DD the cycle is being run for. */
  cycleDate: string;
  /**
   * Whether to include review scans. Defaults to "only on the day's first
   * slot".
   *
   * Set explicitly by a manual full refresh, which the user asked for and which
   * should therefore refresh everything regardless of which slot it lands in.
   */
  includeReviews?: boolean;
}

/**
 * Build the list of queue jobs for a daily scan (or manual refresh).
 *
 * The cycle runs in two phases (see the ordering note at the bottom of this
 * function):
 *   1. Per-extension stats — each tracked extension's `listing_scan` (user
 *      count, rating, review count, listing text) immediately followed by its
 *      `review_scan`, extension by extension.
 *   2. Ranking — every `keyword_scan` and `autocomplete_scan`, interleaved at
 *      random.
 *
 * @param projects  All projects to scan.
 * @param extensions  All known extensions (needed to look up metadata).
 * @param keywords  All keywords across all projects.
 * @param cycle  Which scan slot/date these jobs belong to.
 * @returns Array of QueueJob entries ready to enqueue (without `id` set).
 */
export function buildDailyScanJobs(
  projects: Project[],
  extensions: Extension[],
  keywords: Keyword[],
  cycle?: ScanCycleContext
): QueueJob[] {
  const now = new Date();

  // Track which extension IDs already have a listing_scan job (deduplication).
  const seenExtensionIds = new Set<string>();

  // Collect own extension IDs across all projects for priority assignment.
  const ownExtensionIds = new Set<string>();
  for (const project of projects) {
    ownExtensionIds.add(project.ownExtensionId);
  }

  // --- Which extensions get scanned ---
  // One entry per unique extension; a competitor in one project might be the
  // own extension in another.
  for (const project of projects) {
    if (project.ownExtensionId) {
      seenExtensionIds.add(project.ownExtensionId);
    }
    for (const competitorId of project.competitorIds) {
      seenExtensionIds.add(competitorId);
    }
  }

  // Reviews only on the day's first slot. Reviews are the most expensive job
  // type and gain nothing from intraday resolution: they are already tracked as
  // entities with their own first/last-seen timestamps rather than as daily
  // snapshots, so re-fetching them 4x a day would multiply request volume for
  // no new information.
  const includeReviews = cycle?.includeReviews ?? (!cycle || cycle.slot === 0);

  // --- Phase 1: per-extension stats, one extension at a time ---
  // The listing scan carries the numbers the user watches day to day (users,
  // rating, review count); the review scan reads the reviews behind them. They
  // are queued adjacently so an extension's stats are captured as one
  // measurement rather than hours apart, and the extension is finished before
  // the next one starts — an interrupted cycle then leaves whole extensions
  // done instead of every extension half-done.
  const statsJobs: QueueJob[] = [];
  for (const extensionId of shuffle([...seenExtensionIds])) {
    const priority = ownExtensionIds.has(extensionId)
      ? PRIORITY_OWN_LISTING
      : PRIORITY_COMPETITOR_LISTING;
    statsJobs.push(createListingScanJob(extensionId, priority, now));
    if (includeReviews) {
      statsJobs.push(createReviewScanJob(extensionId, now));
    }
  }

  // --- Phase 2: ranking ---
  // One keyword_scan per keyword (not deduplicated across projects per PRD
  // Section 6.5) plus one autocomplete_scan per keyword.
  const rankingJobs: QueueJob[] = [];
  for (const keyword of keywords) {
    rankingJobs.push(createKeywordScanJob(keyword, now));
  }
  for (const keyword of keywords) {
    rankingJobs.push(createAutocompleteScanJob(keyword, now));
  }

  // --- Execution order ---------------------------------------------------
  //
  // Stats before ranking, by request: the per-extension numbers are what the
  // dashboard leads with, so they should be the part of the cycle that is
  // already in hand when a long queue is still draining, and a cycle cut short
  // by a dead worker or a re-schedule should lose keyword positions rather than
  // install counts.
  //
  // Known cost, accepted deliberately: an earlier version shuffled the whole
  // cycle because a fixed lag between an extension's metadata sample and its
  // rank sample makes the change log show metadata changes consistently
  // preceding rank changes, which reads as a causal latency the data does not
  // contain. That lag is back — every listing scan now precedes every keyword
  // scan. Read lead-lag between the two as an artifact of scan order, not as a
  // signal. What randomization is still available is kept: the extension order
  // within phase 1 and the keyword/autocomplete interleaving within phase 2 are
  // both shuffled, so no single extension or keyword is pinned to the same
  // position in the cycle every day.
  return [...statsJobs, ...shuffle(rankingJobs)].map((job, index) => ({
    ...job,
    priority: index,
    ...(cycle ? { slot: cycle.slot, cycleDate: cycle.cycleDate } : {}),
  }));
}

/**
 * Build only keyword_scan jobs for the given keywords.
 * Used for section-scoped manual refresh (e.g. "rescan keyword positions
 * for this project").
 */
export function buildKeywordScanJobs(
  keywords: Keyword[],
  cycle?: ScanCycleContext
): QueueJob[] {
  const now = new Date();
  return keywords.map((k) => withCycle(createKeywordScanJob(k, now), cycle));
}

/**
 * Build only autocomplete_scan jobs for the given keywords.
 * Used for section-scoped manual refresh (e.g. "rescan AC positions
 * for this project").
 */
export function buildAutocompleteScanJobs(
  keywords: Keyword[],
  cycle?: ScanCycleContext
): QueueJob[] {
  const now = new Date();
  return keywords.map((k) => withCycle(createAutocompleteScanJob(k, now), cycle));
}

/**
 * Build only review_scan jobs for the given extension IDs.
 * Used for section-scoped manual refresh ("refresh reviews for this project").
 * Duplicate IDs are deduplicated.
 */
export function buildReviewScanJobs(
  extensionIds: string[],
  cycle?: ScanCycleContext
): QueueJob[] {
  const now = new Date();
  const unique = [...new Set(extensionIds.filter((id) => !!id))];
  return unique.map((id) => withCycle(createReviewScanJob(id, now), cycle));
}

/**
 * Build translation_audit jobs: one per extension x locale (PRD 5.3.6).
 *
 * Manual only - never part of the daily cycle. Jobs are ordered extension-major
 * so one extension's locales land together and its report completes early,
 * rather than every extension staying half-audited until the very end.
 * Duplicate IDs / locales are deduplicated; blanks are dropped.
 */
export function buildTranslationAuditJobs(
  extensionIds: string[],
  locales: string[],
  cycle?: ScanCycleContext
): QueueJob[] {
  const now = new Date();
  const uniqueExtensions = [...new Set(extensionIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  const uniqueLocales = [...new Set(locales.map((l) => l.trim()).filter((l) => l.length > 0))];
  const jobs: QueueJob[] = [];
  let order = 0;
  for (const extensionId of uniqueExtensions) {
    for (const locale of uniqueLocales) {
      jobs.push(withCycle(createTranslationAuditJob(extensionId, locale, PRIORITY_TRANSLATION_AUDIT + order, now), cycle));
      order += 1;
    }
  }
  return jobs;
}

/** Stamp a job with its scan cycle, if one was supplied. */
function withCycle(job: QueueJob, cycle?: ScanCycleContext): QueueJob {
  if (!cycle) return job;
  return { ...job, slot: cycle.slot, cycleDate: cycle.cycleDate };
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

function createTranslationAuditJob(
  extensionId: string,
  locale: string,
  priority: number,
  scheduledAt: Date
): QueueJob {
  return {
    type: 'translation_audit',
    payload: { extensionId, locale },
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
