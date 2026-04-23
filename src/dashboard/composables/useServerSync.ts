/**
 * Server sync composable (Pro users only).
 *
 * Two capabilities:
 *
 * 1. pushScanConfig(): reads local projects + keywords from IndexedDB and
 *    PUTs them to /api/scan-configs so the server's daily cron knows what
 *    to crawl for this user.
 *
 * 2. loadCrawlStatus(): fetches latest crawl run summary from
 *    /api/crawl-status so the UI can show when the last server scan ran.
 *
 * Pulling scan results and mapping them back into local ListingSnapshot /
 * RankSnapshot / AutocompleteSnapshot is out of scope for this composable —
 * it'll be added when integrating with the dashboard's chart views.
 */

import { ref } from 'vue';
import { SERVER_URL } from '@/shared/types/settings';
import { SettingsManager } from '@/shared/utils/settings';
import { db } from '@/shared/db/database';

export interface CrawlStatus {
  lastRun: string | null;
  successful: number;
  failed: number;
  nextRun: string | null;
}

export interface UseServerSyncReturn {
  crawlStatus: ReturnType<typeof ref<CrawlStatus | null>>;
  loading: ReturnType<typeof ref<boolean>>;
  error: ReturnType<typeof ref<string | null>>;
  pushScanConfig: () => Promise<boolean>;
  loadCrawlStatus: () => Promise<void>;
}

const settingsManager = new SettingsManager();

async function readProjectConfigs(): Promise<Array<{
  id: number;
  ownExtensionId: string;
  competitorIds: string[];
  keywordTexts: string[];
}>> {
  const projects = await db.projects.toArray();
  const configs = await Promise.all(projects.map(async (p) => {
    const keywords = await db.keywords.where('projectId').equals(p.id!).toArray();
    return {
      id: p.id!,
      ownExtensionId: p.ownExtensionId,
      competitorIds: [...p.competitorIds],
      keywordTexts: keywords.map((k) => k.text),
    };
  }));
  return configs;
}

async function extractError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    if (body.error) return body.error;
  } catch { /* not JSON */ }
  return `HTTP ${response.status}`;
}

export function useServerSync(): UseServerSyncReturn {
  const crawlStatus = ref<CrawlStatus | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function pushScanConfig(): Promise<boolean> {
    error.value = null;

    const stored = await settingsManager.getWithDefaults();
    if (stored.subscriptionStatus !== 'pro') {
      return false;
    }
    if (!stored.serverApiKey) {
      error.value = 'Extension not registered with server yet.';
      return false;
    }

    loading.value = true;
    try {
      const projects = await readProjectConfigs();
      const response = await fetch(`${SERVER_URL}/api/scan-configs`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': stored.serverApiKey,
        },
        body: JSON.stringify({ projects }),
      });

      if (!response.ok) {
        error.value = await extractError(response);
        return false;
      }
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function loadCrawlStatus(): Promise<void> {
    error.value = null;

    const stored = await settingsManager.getWithDefaults();
    if (stored.subscriptionStatus !== 'pro') {
      crawlStatus.value = null;
      return;
    }
    if (!stored.serverApiKey) {
      error.value = 'Extension not registered with server yet.';
      return;
    }

    loading.value = true;
    try {
      const response = await fetch(`${SERVER_URL}/api/crawl-status`, {
        method: 'GET',
        headers: { 'X-API-Key': stored.serverApiKey },
      });

      if (!response.ok) {
        error.value = await extractError(response);
        return;
      }
      crawlStatus.value = await response.json() as CrawlStatus;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      loading.value = false;
    }
  }

  return {
    crawlStatus,
    loading,
    error,
    pushScanConfig,
    loadCrawlStatus,
  };
}
