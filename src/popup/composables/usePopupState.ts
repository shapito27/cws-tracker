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
import type { ServiceWorkerMessage, RankSnapshot } from '../../shared/types';
import { db } from '../../shared/db/database';
import { SettingsManager } from '../../shared/utils/settings';
import { today, daysBetween } from '../../shared/utils/dates';
import type { SubscriptionStatus } from '../../shared/types/settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScanStatus = 'idle' | 'running';

export interface RankChange {
  extensionId: string;
  extensionName: string;
  iconUrl: string | null;
  keyword: string;
  keywordId: number;
  previousPosition: number | null;
  currentPosition: number | null;
  /** Positive = improved (moved up in rank), negative = dropped. null = no prior data. */
  change: number | null;
  /** Whether this extension is the user's own (vs a competitor). */
  isOwn: boolean;
  /** The project ID this rank change belongs to. */
  projectId: number | null;
  /** The date of the current rank snapshot (YYYY-MM-DD). */
  date: string;
  /** Exact timestamp of the current rank snapshot scan. */
  scannedAt: Date;
}

export interface PopupState {
  scanStatus: ScanStatus;
  scanProgress: { completed: number; total: number; currentJob: string };
  lastScanDate: string | null;
  rankChanges: RankChange[];
  subscriptionStatus: SubscriptionStatus;
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
        typeof m.currentJob === 'string'
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
export async function loadRecentRankChanges(limit: number = 5): Promise<RankChange[]> {
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

  const changes: RankChange[] = [];

  for (const snap of current) {
    const prev = previous.find(
      (p) => p.keywordId === snap.keywordId && p.extensionId === snap.extensionId
    );

    let change: number | null = null;
    if (prev) {
      if (prev.position !== null && snap.position !== null) {
        // Positive = improved (moved up in rank: was 10, now 5 = +5)
        change = prev.position - snap.position;
      } else if (prev.position === null && snap.position !== null) {
        // Entered top 30 (was 30+, now ranked)
        change = 31;
      } else if (prev.position !== null && snap.position === null) {
        // Dropped out of top 30
        change = -31;
      }
      // Both null: no change (still not ranked), skip
    }

    if (change !== null && change !== 0) {
      // Find which project this extension belongs to
      const ownerProject = projects.find(
        (p) => p.ownExtensionId === snap.extensionId || p.competitorIds.includes(snap.extensionId)
      );
      changes.push({
        extensionId: snap.extensionId,
        extensionName: '',
        iconUrl: null,
        keyword: '',
        keywordId: snap.keywordId,
        previousPosition: prev?.position ?? null,
        currentPosition: snap.position,
        change,
        isOwn: ownExtIds.has(snap.extensionId),
        projectId: ownerProject?.id ?? null,
        date: currentDate,
        scannedAt: snap.scannedAt,
      });
    }
  }

  // Sort: own extensions first, then by absolute change magnitude
  changes.sort((a, b) => {
    // Own extensions always come first
    if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
    // Within same group, sort by magnitude descending
    return Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0);
  });

  // Take top N and fill in names via batch queries
  const topChanges = changes.slice(0, limit);

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
  const scanProgress = ref({ completed: 0, total: 0, currentJob: '' });
  const lastScanDate = ref<string | null>(null);
  const rankChanges = ref<RankChange[]>([]);
  const subscriptionStatus = ref<SubscriptionStatus>('free');
  const isPaused = ref(false);

  const showScanNudge = computed(() => {
    if (subscriptionStatus.value !== 'free') return false;
    if (!lastScanDate.value) return true;
    return daysBetween(lastScanDate.value, today()) > 7;
  });

  const progressPercent = computed(() => {
    if (scanProgress.value.total === 0) return 0;
    return Math.round(
      (scanProgress.value.completed / scanProgress.value.total) * 100
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
        };
        break;
      case 'SCAN_COMPLETE':
        scanStatus.value = 'idle';
        lastScanDate.value = message.date;
        scanProgress.value = { completed: 0, total: 0, currentJob: '' };
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
      subscriptionStatus.value = s.subscriptionStatus;
      isPaused.value = !s.dailyScanEnabled;

      // Load rank changes from DB
      rankChanges.value = await loadRecentRankChanges();

      // Clear badge when popup opens
      await clearBadge();
    } catch {
      // On error, keep safe defaults so popup still renders
      rankChanges.value = [];
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
    subscriptionStatus,
    isPaused,
    showScanNudge,
    openDashboard,
    requestRefresh,
    requestPause,
    requestResume,
    clearBadge,
  };
}
