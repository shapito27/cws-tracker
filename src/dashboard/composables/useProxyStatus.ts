/**
 * Composable exposing whether a CWS proxy is configured.
 *
 * Scans cannot run without a proxy (the Chrome Web Store blocks direct
 * extension-origin fetches via CORS). This drives the "proxy required" guard in
 * the dashboard: scan buttons are disabled and a setup banner is shown until a
 * proxy URL is saved.
 *
 * State is module-level (shared across every component) and kept fresh via a
 * chrome.storage.onChanged listener, so saving the proxy URL in Settings
 * instantly unlocks scan buttons everywhere without a reload.
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { SettingsManager, isProxyConfigured } from '@/shared/utils/settings';

const settingsManager = new SettingsManager();

// Shared across all callers so the whole SPA agrees on the proxy status.
const proxyConfigured = ref(false);
const proxyLoaded = ref(false);

/**
 * True only once we have *confirmed* no proxy is configured. Gating scan
 * buttons on this (rather than `!proxyConfigured`) avoids a flash of
 * disabled-with-misleading-tooltip during the initial async settings read.
 */
const scanBlocked = computed(() => proxyLoaded.value && !proxyConfigured.value);

// Tracks an in-flight initial read so concurrent callers don't each fire a
// redundant chrome.storage.local.get during the same render pass.
let loadPromise: Promise<void> | null = null;

/** Re-read settings and update the shared proxy status. */
async function refreshProxyStatus(): Promise<void> {
  try {
    const s = await settingsManager.getWithDefaults();
    proxyConfigured.value = isProxyConfigured(s);
  } catch {
    proxyConfigured.value = false;
  } finally {
    proxyLoaded.value = true;
  }
}

let listenerRegistered = false;
function ensureStorageListener(): void {
  if (listenerRegistered) return;
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) {
        void refreshProxyStatus();
      }
    });
    listenerRegistered = true;
  } catch {
    // chrome.storage.onChanged unavailable (e.g. tests) — rely on manual refresh.
  }
}

export interface UseProxyStatusReturn {
  /** True once a non-empty proxy URL is saved. */
  proxyConfigured: Ref<boolean>;
  /** True after the first settings read completes (avoids a banner flash). */
  proxyLoaded: Ref<boolean>;
  /** True only after confirming no proxy is set — gate scan buttons on this. */
  scanBlocked: ComputedRef<boolean>;
  /** Force a re-read of the proxy status. */
  refreshProxyStatus: () => Promise<void>;
}

export function useProxyStatus(): UseProxyStatusReturn {
  ensureStorageListener();
  if (!proxyLoaded.value && !loadPromise) {
    loadPromise = refreshProxyStatus().finally(() => {
      loadPromise = null;
    });
  }
  return { proxyConfigured, proxyLoaded, scanBlocked, refreshProxyStatus };
}
