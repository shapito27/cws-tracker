/**
 * Composable for settings management in the dashboard.
 *
 * Wraps SettingsManager with reactive Vue state and handles
 * loading, saving, validation, and OpenAI API key testing.
 */

import { ref, reactive } from 'vue';
import type { Settings } from '@/shared/types/settings';
import { SettingsManager, DEFAULT_SETTINGS, SettingsValidationError } from '@/shared/utils/settings';

const settingsManager = new SettingsManager();

/** uBlock Origin — a stable, always-present extension used to probe the proxy. */
const PROXY_TEST_EXTENSION_ID = 'cjpalhdlnbpafiamejdnhcphjbkeiagm';
/** Abort the proxy probe after this long (the proxy itself times out CWS at 15s). */
const PROXY_TEST_TIMEOUT_MS = 12000;

/** Map a proxy HTTP status to a human-readable connection-test message. */
function proxyConnectionMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Proxy reachable, but no API key was provided — add your Proxy API Key';
    case 403:
      return 'Proxy reachable, but the API key was rejected — check it matches the proxy';
    case 429:
      return 'Rate limited by the proxy — wait a minute and try again';
    case 502:
      return 'Proxy and key are OK, but it could not reach the Chrome Web Store';
    case 504:
      return 'Proxy timed out reaching the Chrome Web Store — try again';
    case 404:
      return 'That URL responded but is not a CWS Tracker proxy (404) — check the URL';
    default:
      return `Proxy returned an unexpected status (${status})`;
  }
}

/** True if a thrown value is a fetch AbortError (our timeout firing). */
function isAbortError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    (e as { name: unknown }).name === 'AbortError'
  );
}

export interface UseSettingsReturn {
  settings: ReturnType<typeof reactive<Settings>>;
  loading: ReturnType<typeof ref<boolean>>;
  saving: ReturnType<typeof ref<boolean>>;
  error: ReturnType<typeof ref<string | null>>;
  successMessage: ReturnType<typeof ref<string | null>>;
  testingOpenAI: ReturnType<typeof ref<boolean>>;
  openAITestResult: ReturnType<typeof ref<{ success: boolean; message: string } | null>>;
  testingProxy: ReturnType<typeof ref<boolean>>;
  proxyTestResult: ReturnType<typeof ref<{ success: boolean; message: string } | null>>;
  loadSettings: () => Promise<void>;
  saveSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<boolean>;
  saveMultipleSettings: (partial: Partial<Settings>) => Promise<boolean>;
  testOpenAIConnection: () => Promise<void>;
  testProxyConnection: (url: string, apiKey: string | null) => Promise<void>;
}

export function useSettings(): UseSettingsReturn {
  const settings = reactive<Settings>({ ...DEFAULT_SETTINGS });
  const loading = ref(true);
  const saving = ref(false);
  const error = ref<string | null>(null);
  const successMessage = ref<string | null>(null);
  const testingOpenAI = ref(false);
  const openAITestResult = ref<{ success: boolean; message: string } | null>(null);
  const testingProxy = ref(false);
  const proxyTestResult = ref<{ success: boolean; message: string } | null>(null);

  async function loadSettings(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const loaded = await settingsManager.getWithDefaults();
      Object.assign(settings, loaded);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load settings';
    } finally {
      loading.value = false;
    }
  }

  async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<boolean> {
    saving.value = true;
    error.value = null;
    successMessage.value = null;
    try {
      await settingsManager.set(key, value);
      (settings as Settings)[key] = value;
      successMessage.value = 'Setting saved';
      return true;
    } catch (e) {
      if (e instanceof SettingsValidationError) {
        error.value = e.message;
      } else {
        error.value = e instanceof Error ? e.message : 'Failed to save setting';
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function saveMultipleSettings(partial: Partial<Settings>): Promise<boolean> {
    saving.value = true;
    error.value = null;
    successMessage.value = null;
    try {
      await settingsManager.setMultiple(partial);
      Object.assign(settings, partial);
      successMessage.value = 'Settings saved';
      return true;
    } catch (e) {
      if (e instanceof SettingsValidationError) {
        error.value = e.message;
      } else {
        error.value = e instanceof Error ? e.message : 'Failed to save settings';
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function testOpenAIConnection(): Promise<void> {
    testingOpenAI.value = true;
    openAITestResult.value = null;

    const apiKey = settings.openaiApiKey;
    if (!apiKey) {
      openAITestResult.value = { success: false, message: 'No API key provided' };
      testingOpenAI.value = false;
      return;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        openAITestResult.value = { success: true, message: 'Connection successful' };
      } else if (response.status === 401) {
        openAITestResult.value = { success: false, message: 'Invalid API key' };
      } else {
        openAITestResult.value = {
          success: false,
          message: `API returned status ${response.status}`,
        };
      }
    } catch (e) {
      openAITestResult.value = {
        success: false,
        message: e instanceof Error ? e.message : 'Network error',
      };
    } finally {
      testingOpenAI.value = false;
    }
  }

  /**
   * Probe the proxy at `url` with `apiKey` by fetching a stable extension's
   * detail page (the exact path scans use). Maps the HTTP status to a friendly
   * message so the user can tell URL problems from key problems at a glance.
   * Tests the values passed in (current form input), not the saved settings.
   */
  async function testProxyConnection(url: string, apiKey: string | null): Promise<void> {
    testingProxy.value = true;
    proxyTestResult.value = null;

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      proxyTestResult.value = { success: false, message: 'Enter a proxy URL first' };
      testingProxy.value = false;
      return;
    }

    let detailUrl: URL;
    try {
      detailUrl = new URL('/detail', trimmedUrl);
    } catch {
      proxyTestResult.value = { success: false, message: 'Proxy URL is not a valid URL' };
      testingProxy.value = false;
      return;
    }
    detailUrl.searchParams.set('id', PROXY_TEST_EXTENSION_ID);
    if (apiKey) detailUrl.searchParams.set('key', apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TEST_TIMEOUT_MS);

    try {
      const response = await fetch(detailUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
      });

      proxyTestResult.value = response.ok
        ? { success: true, message: 'Connection successful — proxy and API key are working' }
        : { success: false, message: proxyConnectionMessage(response.status) };
    } catch (e) {
      proxyTestResult.value = {
        success: false,
        message: isAbortError(e)
          ? 'Connection timed out — check the proxy URL'
          : 'Could not reach the proxy URL — check that it is correct',
      };
    } finally {
      clearTimeout(timer);
      testingProxy.value = false;
    }
  }

  return {
    settings,
    loading,
    saving,
    error,
    successMessage,
    testingOpenAI,
    openAITestResult,
    testingProxy,
    proxyTestResult,
    loadSettings,
    saveSetting,
    saveMultipleSettings,
    testOpenAIConnection,
    testProxyConnection,
  };
}
