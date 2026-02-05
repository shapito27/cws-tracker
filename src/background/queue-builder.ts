/**
 * Queue Builder (Phase 1.6.1).
 *
 * Builds the initial set of QueueJob entries for a daily scan cycle.
 * - Creates `listing_scan` jobs: 1 per unique extension across all projects.
 * - Creates `keyword_scan` jobs: 1 per keyword (NOT deduplicated across projects).
 * - Assigns priorities: listing scans before keyword scans; own extensions before competitors.
 * - Deduplicates: if the same extension appears in multiple projects, only one listing_scan.
 */

import type { Project, Extension, Keyword, QueueJob } from '@/shared/types';

// ---------------------------------------------------------------------------
// Priority constants (lower number = higher priority)
// ---------------------------------------------------------------------------

/** Priority for listing scans of the user's own extension. */
export const PRIORITY_OWN_LISTING = 10;

/** Priority for listing scans of competitor extensions. */
export const PRIORITY_COMPETITOR_LISTING = 20;

/** Priority for keyword search scans. */
export const PRIORITY_KEYWORD_SCAN = 30;

/** Default maximum retries for queue jobs. */
const DEFAULT_MAX_RETRIES = 3;

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

  return jobs;
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
