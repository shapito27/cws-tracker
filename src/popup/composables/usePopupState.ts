/**
 * Popup state composable (Phase 1.9).
 *
 * Manages reactive popup state: scan status, recent rank changes, badge count,
 * and quick actions. Communicates with the service worker via chrome.runtime
 * messages and reads data directly from IndexedDB.
 *
 * This is a separate composable from the dashboard's useServiceWorker because
 * the popup is a separate Vue app with different lifecycle and lighter needs.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { ServiceWorkerMessage, RankSnapshot, AutocompleteSnapshot, ScanPhase } from '../../shared/types';
import { db } from '../../shared/db/database';
import { SettingsManager, isProxyConfigured } from '../../shared/utils/settings';
import { today, daysBetween } from '../../shared/utils/dates';
import { findEffectivePrevious, classifyDrop } from '../../shared/utils/rank-history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScanStatus = 'idle' | 'running';

/** Sentinel change value when an extension *appears* in autocomplete (prev=null → curr≥1). */
export const AC_APPEARED_SENTINEL = 11;
/** Sentinel change value when an extension *disappears* from autocomplete (prev≥1 → curr=null). */
export const AC_DISAPPEARED_SENTINEL = -11;

export interface RankChange {
  /** Discriminates between search-rank and autocomplete-position changes. */
  type: 'rank' | 'autocomplete';
  extensionId: string;
  extensionName: string;
  iconUrl: string | null;
  keyword: string;
  keywordId: number;
  previousPosition: number | null;
  currentPosition: number | null;
  /** Positive = improved (moved up in rank), negative = dropped. null = no prior data. */
  change: number | null;
  /**
   * True when a `currentPosition: null` drop is unconfirmed (first off-list
   * scan after a ranked one) — likely CWS ranking volatility rather than a real
   * drop. UI shows an amber "Unstable" hint + Re-scan instead of a red "Out".
   * Only set for `type: 'rank'`.
   */
  unstable?: boolean;
  /** Whether this extension is the user's own (vs a competitor). */
  isOwn: boolean;
  /** The project ID this rank change belongs to. */
  projectId: number | null;
  /** The date of the current rank snapshot (YYYY-MM-DD). */
  date: string;
  /** Exact timestamp of the current rank snapshot scan. */
  scannedAt: Date;
}

/** A group of rank/autocomplete changes that all occurred on the same date. */
export interface ChangesDateGroup {
  date: string;
  changes: RankChange[];
}

export interface PopupState {
  scanStatus: ScanStatus;
  scanProgress: {
    completed: number;
    total: number;
    currentJob: string;
    phase: ScanPhase;
    nextProcessingAt: string | null;
  };
  lastScanDate: string | null;
  rankChanges: RankChange[];
  isPaused: boolean;
  showScanNudge: boolean;
}

// ---------------------------------------------------------------------------
// Message validation
// ---------------------------------------------------------------------------

/** Runtime type guard for ServiceWorkerMessage. */
export function isServiceWorkerMessage(msg: unknown): msg is ServiceWorkerMessage {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return false;

  const m = msg as Record<string, unknown>;

  switch (m.type) {
    case 'SCAN_PROGRESS':
      return (
        typeof m.completed === 'number' &&
        typeof m.total === 'number' &&
        typeof m.currentJob === 'string' &&
        (m.phase === undefined || typeof m.phase === 'string') &&
        (m.nextProcessingAt === undefined || typeof m.nextProcessingAt === 'string')
      );
    case 'SCAN_COMPLETE':
      return (
        typeof m.date === 'string' &&
        typeof m.jobsCompleted === 'number' &&
        typeof m.jobsFailed === 'number'
      );
    case 'QUEUE_STATUS':
      return (
        typeof m.pending === 'number' &&
        typeof m.running === 'number' &&
        typeof m.failed === 'number'
      );
    case 'NEW_EVENT':
      return m.event != null && typeof m.event === 'object';
    case 'SCAN_ERROR':
      return typeof m.jobId === 'number' && typeof m.error === 'string';
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Pure data functions (testable without Vue)
// ---------------------------------------------------------------------------

/**
 * Group snapshots by `keywordId:extensionId` and sort each list ascending by
 * date. Within each date, keeps the snapshot with the latest scannedAt
 * (matches deduplicateSnapshots semantics).
 */
function buildPairHistory<
  T extends { keywordId: number; extensionId: string; date: string; scannedAt: Date }
>(snapshots: T[]): Map<string, T[]> {
  const byPairAndDate = new Map<string, Map<string, T>>();
  for (const s of snapshots) {
    const pairKey = `${s.keywordId}:${s.extensionId}`;
    let dateMap = byPairAndDate.get(pairKey);
    if (!dateMap) {
      dateMap = new Map();
      byPairAndDate.set(pairKey, dateMap);
    }
    const existing = dateMap.get(s.date);
    if (!existing || s.scannedAt > existing.scannedAt) {
      dateMap.set(s.date, s);
    }
  }
  const out = new Map<string, T[]>();
  for (const [pairKey, dateMap] of byPairAndDate) {
    const list = [...dateMap.values()];
    list.sort((a, b) => a.date.localeCompare(b.date));
    out.set(pairKey, list);
  }
  return out;
}

/**
 * Deduplicate snapshots per [keywordId, extensionId] within a date group,
 * keeping the snapshot with the latest scannedAt. Consistent with the
 * dashboard's deduplicateByDate logic.
 */
function deduplicateSnapshots(snapshots: RankSnapshot[]): RankSnapshot[] {
  const byKey = new Map<string, RankSnapshot>();
  for (const snap of snapshots) {
    const key = `${snap.keywordId}:${snap.extensionId}`;
    const existing = byKey.get(key);
    if (!existing || snap.scannedAt > existing.scannedAt) {
      byKey.set(key, snap);
    }
  }
  return [...byKey.values()];
}

/**
 * Load the top rank changes between the two most recent scan dates.
 * Returns up to `limit` changes, own extensions first, then by magnitude.
 *
 * Only includes snapshots for keywords that belong to active projects,
 * preventing cross-project data mixing when multiple projects track
 * the same keyword text with different keyword IDs.
 */
export async function loadRecentRankChanges(limit: number = 5, ownOnly = false): Promise<RankChange[]> {
  // Load projects and their keyword IDs upfront to filter snapshots
  const projects = await db.projects.toArray();
  if (projects.length === 0) return [];

  const allProjectKeywordIds = new Set<number>();
  for (const project of projects) {
    for (const kwId of project.keywordIds) {
      allProjectKeywordIds.add(kwId);
    }
  }

  const ownExtIds = new Set(projects.map((p) => p.ownExtensionId));

  // Get a batch of recent snapshots to identify the two latest scan dates.
  // A typical scan: 20 keywords x 10 extensions = 200 snapshots per date.
  // 2000 comfortably covers 2+ scan dates even for large projects.
  const recentSnapshots = await db.rank_snapshots
    .orderBy('id')
    .reverse()
    .limit(2000)
    .toArray();

  if (recentSnapshots.length === 0) return [];

  // Filter to only keywords from active projects
  const projectSnapshots = recentSnapshots.filter(
    (s) => allProjectKeywordIds.has(s.keywordId)
  );

  if (projectSnapshots.length === 0) return [];

  // Find distinct dates, sorted descending
  const dates = [...new Set(projectSnapshots.map((s) => s.date))].sort().reverse();
  if (dates.length < 2) return [];

  const currentDate = dates[0];
  const previousDate = dates[1];

  // Deduplicate per [keywordId, extensionId] within each date, keeping latest scannedAt.
  // This matches the dashboard's deduplicateByDate behavior.
  const current = deduplicateSnapshots(
    projectSnapshots.filter((s) => s.date === currentDate)
  );
  const previous = deduplicateSnapshots(
    projectSnapshots.filter((s) => s.date === previousDate)
  );

  // Per-pair history (ascending by date) of all snapshots strictly before
  // currentDate, used to look back past null-prev snapshots produced by gap
  // days (partial scans that wrote position:null for tracked extensions).
  const pairHistory = buildPairHistory(
    projectSnapshots.filter((s) => s.date < currentDate)
  );

  const changes: RankChange[] = [];

  for (const snap of current) {
    const immediatePrev = previous.find(
      (p) => p.keywordId === snap.keywordId && p.extensionId === snap.extensionId
    );
    const histKey = `${snap.keywordId}:${snap.extensionId}`;
    const prev = findEffectivePrevious(
      pairHistory.get(histKey) ?? [],
      immediatePrev,
      currentDate
    );

    let change: number | null = null;
    let unstable = false;
    if (prev) {
      if (prev.position !== null && snap.position !== null) {
        // Positive = improved (moved up in rank: was 10, now 5 = +5)
        change = prev.position - snap.position;
      } else if (prev.position === null && snap.position !== null) {
        // Entered top 30 (was 30+, now ranked)
        change = 31;
      } else if (prev.position !== null && snap.position === null) {
        // Dropped out of top 30 — flag as unstable when unconfirmed (first null).
        change = -31;
        unstable = classifyDrop(snap.position, immediatePrev?.position, prev.position) === 'provisional';
      }
      // Both null: no change (still not ranked), skip
    }

    if (change !== null && change !== 0) {
      // Find which project this extension belongs to
      const ownerProject = projects.find(
        (p) => p.ownExtensionId === snap.extensionId || p.competitorIds.includes(snap.extensionId)
      );
      changes.push({
        type: 'rank',
        extensionId: snap.extensionId,
        extensionName: '',
        iconUrl: null,
        keyword: '',
        keywordId: snap.keywordId,
        previousPosition: prev?.position ?? null,
        currentPosition: snap.position,
        change,
        unstable,
        isOwn: ownExtIds.has(snap.extensionId),
        projectId: ownerProject?.id ?? null,
        date: currentDate,
        scannedAt: snap.scannedAt,
      });
    }
  }

  // Filter to own extensions only when requested (before slice, so limit is respected correctly)
  const filtered = ownOnly ? changes.filter((c) => c.isOwn) : changes;

  // Sort: own extensions first, then by absolute change magnitude
  filtered.sort((a, b) => {
    if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
    return Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0);
  });

  // Take top N and fill in names via batch queries
  const topChanges = filtered.slice(0, limit);

  if (topChanges.length > 0) {
    const extensionIds = [...new Set(topChanges.map((c) => c.extensionId))];
    const keywordIds = [...new Set(topChanges.map((c) => c.keywordId))];

    const [extensions, keywords] = await Promise.all([
      db.extensions.where('id').anyOf(extensionIds).toArray(),
      db.keywords.where('id').anyOf(keywordIds).toArray(),
    ]);

    const extMap = new Map(extensions.map((e) => [e.id, e]));
    const kwMap = new Map(keywords.map((k) => [k.id!, k]));

    for (const c of topChanges) {
      const ext = extMap.get(c.extensionId);
      const kw = kwMap.get(c.keywordId);
      c.extensionName = ext?.name || c.extensionId.substring(0, 8) + '...';
      c.iconUrl = ext?.iconUrl ?? null;
      c.keyword = kw?.text || `Keyword #${c.keywordId}`;
    }
  }

  return topChanges;
}

/**
 * Deduplicate autocomplete snapshots per [keywordId, extensionId], keeping latest scannedAt.
 */
function deduplicateAutocompleteSnapshots(snapshots: AutocompleteSnapshot[]): AutocompleteSnapshot[] {
  const byKey = new Map<string, AutocompleteSnapshot>();
  for (const snap of snapshots) {
    const key = `${snap.keywordId}:${snap.extensionId}`;
    const existing = byKey.get(key);
    if (!existing || snap.scannedAt > existing.scannedAt) {
      byKey.set(key, snap);
    }
  }
  return [...byKey.values()];
}

/**
 * Load the top autocomplete position changes between the two most recent scan dates.
 * Returns up to `limit` changes, own extensions first, then by magnitude.
 *
 * Sentinel values for change:
 *   +11 = appeared in autocomplete (null → position 1-10)
 *   -11 = disappeared from autocomplete (position 1-10 → null)
 *   other = position shifted within autocomplete
 */
export async function loadRecentAutocompleteChanges(limit: number = 5, ownOnly = false): Promise<RankChange[]> {
  const projects = await db.projects.toArray();
  if (projects.length === 0) return [];

  const allProjectKeywordIds = new Set<number>();
  for (const project of projects) {
    for (const kwId of project.keywordIds) {
      allProjectKeywordIds.add(kwId);
    }
  }

  const ownExtIds = new Set(projects.map((p) => p.ownExtensionId));

  const recentSnapshots = await db.autocomplete_snapshots
    .orderBy('id')
    .reverse()
    .limit(2000)
    .toArray();

  if (recentSnapshots.length === 0) return [];

  const projectSnapshots = recentSnapshots.filter((s) => allProjectKeywordIds.has(s.keywordId));
  if (projectSnapshots.length === 0) return [];

  const dates = [...new Set(projectSnapshots.map((s) => s.date))].sort().reverse();
  if (dates.length < 2) return [];

  const currentDate = dates[0];
  const previousDate = dates[1];

  const current = deduplicateAutocompleteSnapshots(
    projectSnapshots.filter((s) => s.date === currentDate)
  );
  const previous = deduplicateAutocompleteSnapshots(
    projectSnapshots.filter((s) => s.date === previousDate)
  );

  // Per-pair history (ascending) of all snapshots strictly before currentDate,
  // used to skip null-prev gaps when emitting "appeared" events.
  const pairHistory = buildPairHistory(
    projectSnapshots.filter((s) => s.date < currentDate)
  );

  // Build a set of all (keywordId, extensionId) pairs seen in either date
  const allPairs = new Set<string>();
  for (const s of [...current, ...previous]) {
    allPairs.add(`${s.keywordId}:${s.extensionId}`);
  }

  const currentMap = new Map(current.map((s) => [`${s.keywordId}:${s.extensionId}`, s]));
  const previousMap = new Map(previous.map((s) => [`${s.keywordId}:${s.extensionId}`, s]));

  const changes: RankChange[] = [];

  for (const pair of allPairs) {
    const curr = currentMap.get(pair);
    const immediatePrev = previousMap.get(pair);
    const effectivePrev = findEffectivePrevious(
      pairHistory.get(pair) ?? [],
      immediatePrev,
      currentDate
    );
    const currPos = curr?.position ?? null;
    const prevPos = effectivePrev?.position ?? null;

    let change: number | null = null;
    if (currPos !== null && prevPos === null) {
      change = AC_APPEARED_SENTINEL; // appeared in autocomplete
    } else if (curr && currPos === null && prevPos !== null) {
      // Only report "disappeared" when a snapshot actually exists for today
      // (keyword was scanned, extension not found). Skip when curr is undefined
      // (keyword not yet scanned — avoids false "Out" entries mid-crawl).
      change = AC_DISAPPEARED_SENTINEL; // disappeared from autocomplete
    } else if (currPos !== null && prevPos !== null && currPos !== prevPos) {
      change = prevPos - currPos; // positive = improved (lower position number)
    }

    if (change !== null) {
      const snap = curr ?? effectivePrev ?? immediatePrev!;
      const ownerProject = projects.find(
        (p) => p.ownExtensionId === snap.extensionId || p.competitorIds.includes(snap.extensionId)
      );
      changes.push({
        type: 'autocomplete',
        extensionId: snap.extensionId,
        extensionName: '',
        iconUrl: null,
        keyword: '',
        keywordId: snap.keywordId,
        previousPosition: prevPos,
        currentPosition: currPos,
        change,
        isOwn: ownExtIds.has(snap.extensionId),
        projectId: ownerProject?.id ?? null,
        date: currentDate,
        scannedAt: snap.scannedAt,
      });
    }
  }

  // Filter to own extensions only when requested (before slice, so limit is respected correctly)
  const filteredAC = ownOnly ? changes.filter((c) => c.isOwn) : changes;

  filteredAC.sort((a, b) => {
    if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
    return Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0);
  });

  const topChanges = filteredAC.slice(0, limit);

  if (topChanges.length > 0) {
    const extensionIds = [...new Set(topChanges.map((c) => c.extensionId))];
    const keywordIds = [...new Set(topChanges.map((c) => c.keywordId))];

    const [extensions, keywords] = await Promise.all([
      db.extensions.where('id').anyOf(extensionIds).toArray(),
      db.keywords.where('id').anyOf(keywordIds).toArray(),
    ]);

    const extMap = new Map(extensions.map((e) => [e.id, e]));
    const kwMap = new Map(keywords.map((k) => [k.id!, k]));

    for (const c of topChanges) {
      const ext = extMap.get(c.extensionId);
      const kw = kwMap.get(c.keywordId);
      c.extensionName = ext?.name || c.extensionId.substring(0, 8) + '...';
      c.iconUrl = ext?.iconUrl ?? null;
      c.keyword = kw?.text || `Keyword #${c.keywordId}`;
    }
  }

  return topChanges;
}

/**
 * Load all rank and autocomplete changes across all consecutive scan dates found in
 * recent history, grouped by date (most recent first).
 *
 * Rank changes and autocomplete changes are computed independently over their own
 * consecutive date pairs to avoid false "appeared/disappeared" artifacts when one
 * scan type has data further back in time than the other.
 *
 * @param snapshotLimit Max rows to load from each snapshot table independently.
 *   At ~200 snapshots/day (10 ext × 20 kw), the default of 10 000 covers ~50 days.
 *   Actual IndexedDB reads: up to 2 × snapshotLimit rows total (rank + autocomplete).
 */
export async function loadAllChanges(snapshotLimit: number = 10000): Promise<ChangesDateGroup[]> {
  const projects = await db.projects.toArray();
  if (projects.length === 0) return [];

  const allProjectKeywordIds = new Set<number>();
  for (const project of projects) {
    for (const kwId of project.keywordIds) {
      allProjectKeywordIds.add(kwId);
    }
  }

  const ownExtIds = new Set(projects.map((p) => p.ownExtensionId));

  const [rankSnapshots, autocompleteSnapshots] = await Promise.all([
    db.rank_snapshots.orderBy('id').reverse().limit(snapshotLimit).toArray(),
    db.autocomplete_snapshots.orderBy('id').reverse().limit(snapshotLimit).toArray(),
  ]);

  const projectRankSnaps = rankSnapshots.filter((s) => allProjectKeywordIds.has(s.keywordId));
  const projectACSnaps = autocompleteSnapshots.filter((s) => allProjectKeywordIds.has(s.keywordId));

  // Separate sorted date lists so each type only compares within its own history
  const rankDates = [...new Set(projectRankSnaps.map((s) => s.date))].sort().reverse();
  const acDates = [...new Set(projectACSnaps.map((s) => s.date))].sort().reverse();

  const allChanges: RankChange[] = [];

  // Per-pair history for both scan types (used for null-prev lookback so a
  // partial-scan day doesn't trigger a false "New" the next day).
  const rankPairHistory = buildPairHistory(projectRankSnaps);
  const acPairHistory = buildPairHistory(projectACSnaps);

  // --- Rank changes across all consecutive rank date pairs ---
  for (let i = 0; i < rankDates.length - 1; i++) {
    const currentDate = rankDates[i];
    const previousDate = rankDates[i + 1];

    const currentRank = deduplicateSnapshots(
      projectRankSnaps.filter((s) => s.date === currentDate)
    );
    const previousRank = deduplicateSnapshots(
      projectRankSnaps.filter((s) => s.date === previousDate)
    );

    for (const snap of currentRank) {
      const immediatePrev = previousRank.find(
        (p) => p.keywordId === snap.keywordId && p.extensionId === snap.extensionId
      );
      const histKey = `${snap.keywordId}:${snap.extensionId}`;
      const prev = findEffectivePrevious(
        rankPairHistory.get(histKey) ?? [],
        immediatePrev,
        currentDate
      );

      let change: number | null = null;
      let unstable = false;
      if (prev) {
        if (prev.position !== null && snap.position !== null) {
          change = prev.position - snap.position;
        } else if (prev.position === null && snap.position !== null) {
          change = 31;
        } else if (prev.position !== null && snap.position === null) {
          change = -31;
          unstable = classifyDrop(snap.position, immediatePrev?.position, prev.position) === 'provisional';
        }
      }

      if (change !== null && change !== 0) {
        const ownerProject = projects.find(
          (p) => p.ownExtensionId === snap.extensionId || p.competitorIds.includes(snap.extensionId)
        );
        allChanges.push({
          type: 'rank',
          extensionId: snap.extensionId,
          extensionName: '',
          iconUrl: null,
          keyword: '',
          keywordId: snap.keywordId,
          previousPosition: prev?.position ?? null,
          currentPosition: snap.position,
          change,
          unstable,
          isOwn: ownExtIds.has(snap.extensionId),
          projectId: ownerProject?.id ?? null,
          date: currentDate,
          scannedAt: snap.scannedAt,
        });
      }
    }
  }

  // --- Autocomplete changes across all consecutive autocomplete date pairs ---
  for (let i = 0; i < acDates.length - 1; i++) {
    const currentDate = acDates[i];
    const previousDate = acDates[i + 1];

    const currentAC = deduplicateAutocompleteSnapshots(
      projectACSnaps.filter((s) => s.date === currentDate)
    );
    const previousAC = deduplicateAutocompleteSnapshots(
      projectACSnaps.filter((s) => s.date === previousDate)
    );

    const pairsAC = new Set<string>();
    for (const s of [...currentAC, ...previousAC]) {
      pairsAC.add(`${s.keywordId}:${s.extensionId}`);
    }

    const currentACMap = new Map(currentAC.map((s) => [`${s.keywordId}:${s.extensionId}`, s]));
    const previousACMap = new Map(previousAC.map((s) => [`${s.keywordId}:${s.extensionId}`, s]));

    for (const pair of pairsAC) {
      const curr = currentACMap.get(pair);
      const immediatePrev = previousACMap.get(pair);
      const effectivePrev = findEffectivePrevious(
        acPairHistory.get(pair) ?? [],
        immediatePrev,
        currentDate
      );
      const currPos = curr?.position ?? null;
      const prevPos = effectivePrev?.position ?? null;

      let change: number | null = null;
      if (currPos !== null && prevPos === null) {
        change = AC_APPEARED_SENTINEL;
      } else if (curr && currPos === null && prevPos !== null) {
        // Only report "disappeared" when a snapshot exists for today
        // (keyword was scanned, extension not found). Skip when curr is undefined
        // (keyword not yet scanned — avoids false "Out" entries mid-crawl).
        change = AC_DISAPPEARED_SENTINEL;
      } else if (currPos !== null && prevPos !== null && currPos !== prevPos) {
        change = prevPos - currPos;
      }

      if (change !== null) {
        const snap = curr ?? effectivePrev ?? immediatePrev!;
        const ownerProject = projects.find(
          (p) => p.ownExtensionId === snap.extensionId || p.competitorIds.includes(snap.extensionId)
        );
        allChanges.push({
          type: 'autocomplete',
          extensionId: snap.extensionId,
          extensionName: '',
          iconUrl: null,
          keyword: '',
          keywordId: snap.keywordId,
          previousPosition: prevPos,
          currentPosition: currPos,
          change,
          isOwn: ownExtIds.has(snap.extensionId),
          projectId: ownerProject?.id ?? null,
          date: currentDate,
          scannedAt: snap.scannedAt,
        });
      }
    }
  }

  // Batch-load extension and keyword names
  if (allChanges.length > 0) {
    const extensionIds = [...new Set(allChanges.map((c) => c.extensionId))];
    const keywordIds = [...new Set(allChanges.map((c) => c.keywordId))];

    const [extensions, keywords] = await Promise.all([
      db.extensions.where('id').anyOf(extensionIds).toArray(),
      db.keywords.where('id').anyOf(keywordIds).toArray(),
    ]);

    const extMap = new Map(extensions.map((e) => [e.id, e]));
    const kwMap = new Map(keywords.map((k) => [k.id!, k]));

    for (const c of allChanges) {
      const ext = extMap.get(c.extensionId);
      const kw = kwMap.get(c.keywordId);
      c.extensionName = ext?.name || c.extensionId.substring(0, 8) + '...';
      c.iconUrl = ext?.iconUrl ?? null;
      c.keyword = kw?.text || `Keyword #${c.keywordId}`;
    }
  }

  // Group by date, sort each group (own first, then by magnitude)
  const byDate = new Map<string, RankChange[]>();
  for (const change of allChanges) {
    if (!byDate.has(change.date)) byDate.set(change.date, []);
    byDate.get(change.date)!.push(change);
  }
  for (const dateChanges of byDate.values()) {
    dateChanges.sort((a, b) => {
      if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
      return Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0);
    });
  }

  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, changes]) => ({ date, changes }));
}

/**
 * Update the extension icon badge count.
 * Shows the count of notable changes; clears when count is 0.
 */
export async function updateBadgeCount(count: number): Promise<void> {
  if (count > 0) {
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Clear the extension icon badge.
 */
export async function clearBadge(): Promise<void> {
  await chrome.action.setBadgeText({ text: '' });
}

/**
 * Open the dashboard in a new tab.
 */
export function openDashboard(): void {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/dashboard/index.html'),
  });
}

/**
 * Open the dashboard Settings page (where the proxy is configured) in a new tab.
 */
export function openSettings(): void {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/dashboard/index.html#/settings'),
  });
}

/**
 * Send a TRIGGER_REFRESH message to the service worker.
 */
export function requestRefresh(): void {
  try {
    chrome.runtime.sendMessage({ type: 'TRIGGER_REFRESH' });
  } catch {
    // Service worker may not be listening; fail silently
  }
}

/**
 * Send a PAUSE_SCAN message to the service worker.
 */
export function requestPause(): void {
  try {
    chrome.runtime.sendMessage({ type: 'PAUSE_SCAN' });
  } catch {
    // fail silently
  }
}

/**
 * Send a RESUME_SCAN message to the service worker.
 */
export function requestResume(): void {
  try {
    chrome.runtime.sendMessage({ type: 'RESUME_SCAN' });
  } catch {
    // fail silently
  }
}

// ---------------------------------------------------------------------------
// Vue composable
// ---------------------------------------------------------------------------

export function usePopupState() {
  const scanStatus = ref<ScanStatus>('idle');
  const scanProgress = ref<{
    completed: number;
    total: number;
    currentJob: string;
    phase: ScanPhase;
    nextProcessingAt: string | null;
  }>({ completed: 0, total: 0, currentJob: '', phase: 'running', nextProcessingAt: null });
  const lastScanDate = ref<string | null>(null);
  const rankChanges = ref<RankChange[]>([]);
  const isPaused = ref(false);
  const proxyConfigured = ref(false);
  const proxyChecked = ref(false);

  const showScanNudge = computed(() => {
    if (!lastScanDate.value) return true;
    return daysBetween(lastScanDate.value, today()) > 7;
  });

  // True only once we've confirmed no proxy is set — gates the warning banner
  // and Refresh button so neither flashes before init() reads settings.
  const scanBlocked = computed(() => proxyChecked.value && !proxyConfigured.value);

  const progressPercent = computed(() => {
    if (scanProgress.value.total === 0) return 0;
    const inFlight = scanProgress.value.phase === 'running' ? 0.5 : 0;
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(((scanProgress.value.completed + inFlight) / scanProgress.value.total) * 100)
      )
    );
  });

  const settings = new SettingsManager();

  function handleMessage(
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    _sendResponse: (response?: unknown) => void
  ): void {
    if (!isServiceWorkerMessage(message)) return;

    switch (message.type) {
      case 'SCAN_PROGRESS':
        scanStatus.value = 'running';
        scanProgress.value = {
          completed: message.completed,
          total: message.total,
          currentJob: message.currentJob,
          phase: message.phase ?? 'running',
          nextProcessingAt: message.nextProcessingAt ?? null,
        };
        break;
      case 'SCAN_COMPLETE':
        scanStatus.value = 'idle';
        lastScanDate.value = message.date;
        scanProgress.value = {
          completed: 0,
          total: 0,
          currentJob: '',
          phase: 'running',
          nextProcessingAt: null,
        };
        // Reload rank changes after scan completes (fire-and-forget)
        loadRecentRankChanges()
          .then((changes) => { rankChanges.value = changes; })
          .catch(() => { /* keep existing value */ });
        break;
      case 'QUEUE_STATUS':
        if (message.pending === 0 && message.running === 0) {
          scanStatus.value = 'idle';
        } else if (message.running > 0) {
          scanStatus.value = 'running';
        }
        break;
    }
  }

  async function init(): Promise<void> {
    try {
      // Load settings
      const s = await settings.getWithDefaults();
      lastScanDate.value = s.lastDailyScanDate;
      isPaused.value = !s.dailyScanEnabled;
      proxyConfigured.value = isProxyConfigured(s);

      // Load rank changes from DB
      rankChanges.value = await loadRecentRankChanges();

      // Clear badge when popup opens
      await clearBadge();
    } catch {
      // On error, keep safe defaults so popup still renders
      rankChanges.value = [];
    } finally {
      // Mark the proxy status as checked either way, so the warning banner
      // reflects a real read rather than the initial `false` placeholder.
      proxyChecked.value = true;
    }
  }

  onMounted(() => {
    chrome.runtime.onMessage.addListener(handleMessage);
    init();
  });

  onUnmounted(() => {
    chrome.runtime.onMessage.removeListener(handleMessage);
  });

  return {
    scanStatus,
    scanProgress,
    progressPercent,
    lastScanDate,
    rankChanges,
    isPaused,
    proxyConfigured,
    scanBlocked,
    showScanNudge,
    openDashboard,
    openSettings,
    requestRefresh,
    requestPause,
    requestResume,
    clearBadge,
  };
}
