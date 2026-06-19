/**
 * Tests for useSettings composable.
 *
 * Verifies:
 * - Loading settings from chrome.storage.local
 * - Saving individual and multiple settings with validation
 * - Validation errors displayed correctly
 * - OpenAI test connection flow
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetChromeMock } from '../../mocks/chrome';
import { useSettings } from '@/dashboard/composables/useSettings';
import { DEFAULT_SETTINGS } from '@/shared/utils/settings';

describe('useSettings', () => {
  beforeEach(() => {
    resetChromeMock();
  });

  describe('loadSettings', () => {
    it('should load default settings when storage is empty', async () => {
      const { settings, loading, loadSettings } = useSettings();

      await loadSettings();

      expect(loading.value).toBe(false);
      expect(settings.queueDelayMs).toBe(DEFAULT_SETTINGS.queueDelayMs);
      expect(settings.dailyScanEnabled).toBe(false);
      expect(settings.dailyScanTime).toBe('03:00');
      expect(settings.dataRetentionDays).toBe(365);
      expect(settings.openaiApiKey).toBeNull();
    });

    it('should load stored settings with defaults for missing keys', async () => {
      await chrome.storage.local.set({
        settings: { queueDelayMs: 90000, dailyScanEnabled: true },
      });

      const { settings, loadSettings } = useSettings();
      await loadSettings();

      expect(settings.queueDelayMs).toBe(90000);
      expect(settings.dailyScanEnabled).toBe(true);
      // Defaults for non-stored keys
      expect(settings.dailyScanTime).toBe('03:00');
    });
  });

  describe('saveSetting', () => {
    it('should save a valid setting', async () => {
      const { settings, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('queueDelayMs', 90000);

      expect(result).toBe(true);
      expect(settings.queueDelayMs).toBe(90000);

      // Verify persisted
      const stored = await chrome.storage.local.get('settings');
      expect((stored.settings as Record<string, unknown>).queueDelayMs).toBe(90000);
    });

    it('should reject invalid setting and return false', async () => {
      const { error, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('queueDelayMs', 1000); // < 30000 min

      expect(result).toBe(false);
      expect(error.value).toContain('queueDelayMs must be >= 30000');
    });

    it('should save dailyScanEnabled toggle', async () => {
      const { settings, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      await saveSetting('dailyScanEnabled', true);

      expect(settings.dailyScanEnabled).toBe(true);
    });

    it('should reject invalid dailyScanTime format', async () => {
      const { error, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('dailyScanTime', '25:00');

      expect(result).toBe(false);
      expect(error.value).toContain('dailyScanTime must be HH:MM');
    });

    it('should reject dataRetentionDays below 7', async () => {
      const { error, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('dataRetentionDays', 3);

      expect(result).toBe(false);
      expect(error.value).toContain('dataRetentionDays must be >= 7');
    });

    it('should save valid dataRetentionDays', async () => {
      const { settings, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('dataRetentionDays', 30);

      expect(result).toBe(true);
      expect(settings.dataRetentionDays).toBe(30);
    });

    it('should save OpenAI key starting with sk-', async () => {
      const { settings, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('openaiApiKey', 'sk-test123');

      expect(result).toBe(true);
      expect(settings.openaiApiKey).toBe('sk-test123');
    });

    it('should reject OpenAI key not starting with sk-', async () => {
      const { error, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('openaiApiKey', 'invalid-key');

      expect(result).toBe(false);
      expect(error.value).toContain('openaiApiKey must start with "sk-"');
    });

    it('should allow null OpenAI key (clearing)', async () => {
      const { settings, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('openaiApiKey', null);

      expect(result).toBe(true);
      expect(settings.openaiApiKey).toBeNull();
    });

    it('should save translationLocales array', async () => {
      const { settings, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('translationLocales', ['en', 'es', 'fr']);

      expect(result).toBe(true);
      expect(settings.translationLocales).toEqual(['en', 'es', 'fr']);
    });

    it('should reject empty translationLocales', async () => {
      const { error, saveSetting, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveSetting('translationLocales', []);

      expect(result).toBe(false);
      expect(error.value).toContain('translationLocales must not be empty');
    });
  });

  describe('saveMultipleSettings', () => {
    it('should save multiple settings at once', async () => {
      const { settings, saveMultipleSettings, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveMultipleSettings({
        queueDelayMs: 120000,
        dailyScanEnabled: true,
        dailyScanTime: '14:30',
      });

      expect(result).toBe(true);
      expect(settings.queueDelayMs).toBe(120000);
      expect(settings.dailyScanEnabled).toBe(true);
      expect(settings.dailyScanTime).toBe('14:30');
    });

    it('should reject if any setting in batch is invalid', async () => {
      const { error, saveMultipleSettings, loadSettings } = useSettings();
      await loadSettings();

      const result = await saveMultipleSettings({
        queueDelayMs: 5000, // invalid
        dailyScanEnabled: true,
      });

      expect(result).toBe(false);
      expect(error.value).toBeDefined();
    });

    it('should set successMessage on successful save', async () => {
      const { successMessage, saveMultipleSettings, loadSettings } = useSettings();
      await loadSettings();

      await saveMultipleSettings({ dailyScanEnabled: true });

      expect(successMessage.value).toBe('Settings saved');
    });
  });

  describe('testOpenAIConnection', () => {
    it('should report error when no API key is set', async () => {
      const { openAITestResult, testOpenAIConnection, loadSettings } = useSettings();
      await loadSettings();

      await testOpenAIConnection();

      expect(openAITestResult.value).toEqual({
        success: false,
        message: 'No API key provided',
      });
    });

    it('should report success on HTTP 200', async () => {
      const { settings, openAITestResult, testOpenAIConnection, saveSetting, loadSettings } = useSettings();
      await loadSettings();
      await saveSetting('openaiApiKey', 'sk-test-key-123');

      // Mock fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      await testOpenAIConnection();

      expect(openAITestResult.value).toEqual({
        success: true,
        message: 'Connection successful',
      });

      globalThis.fetch = originalFetch;
    });

    it('should report invalid key on HTTP 401', async () => {
      const { openAITestResult, testOpenAIConnection, saveSetting, loadSettings } = useSettings();
      await loadSettings();
      await saveSetting('openaiApiKey', 'sk-test-key-invalid');

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      await testOpenAIConnection();

      expect(openAITestResult.value).toEqual({
        success: false,
        message: 'Invalid API key',
      });

      globalThis.fetch = originalFetch;
    });

    it('should report network error', async () => {
      const { openAITestResult, testOpenAIConnection, saveSetting, loadSettings } = useSettings();
      await loadSettings();
      await saveSetting('openaiApiKey', 'sk-test-key-network');

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      await testOpenAIConnection();

      expect(openAITestResult.value).toEqual({
        success: false,
        message: 'Network failure',
      });

      globalThis.fetch = originalFetch;
    });

    it('should set testingOpenAI to false after completion', async () => {
      const { testingOpenAI, testOpenAIConnection, loadSettings } = useSettings();
      await loadSettings();

      await testOpenAIConnection();

      expect(testingOpenAI.value).toBe(false);
    });
  });

  describe('testProxyConnection', () => {
    const PROXY_URL = 'https://cws-proxy.example.workers.dev';

    it('should report error when no URL is provided', async () => {
      const { proxyTestResult, testProxyConnection } = useSettings();

      await testProxyConnection('   ', 'somekey');

      expect(proxyTestResult.value).toEqual({
        success: false,
        message: 'Enter a proxy URL first',
      });
    });

    it('should report error for an invalid URL', async () => {
      const { proxyTestResult, testProxyConnection } = useSettings();

      await testProxyConnection('not-a-url', 'somekey');

      expect(proxyTestResult.value).toEqual({
        success: false,
        message: 'Proxy URL is not a valid URL',
      });
    });

    it('should report success on HTTP 200 and hit /detail with id + key', async () => {
      const { proxyTestResult, testProxyConnection } = useSettings();

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      globalThis.fetch = fetchMock;

      await testProxyConnection(PROXY_URL, 'valid-key');

      expect(proxyTestResult.value).toEqual({
        success: true,
        message: 'Connection successful — proxy and API key are working',
      });
      const calledUrl = String(fetchMock.mock.calls[0][0]);
      expect(calledUrl).toContain(`${PROXY_URL}/detail`);
      expect(calledUrl).toContain('id=cjpalhdlnbpafiamejdnhcphjbkeiagm');
      expect(calledUrl).toContain('key=valid-key');

      globalThis.fetch = originalFetch;
    });

    it('should report a rejected key on HTTP 403', async () => {
      const { proxyTestResult, testProxyConnection } = useSettings();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

      await testProxyConnection(PROXY_URL, 'wrong-key');

      expect(proxyTestResult.value).toEqual({
        success: false,
        message: 'Proxy reachable, but the API key was rejected — check it matches the proxy',
      });

      globalThis.fetch = originalFetch;
    });

    it('should report a missing key on HTTP 401', async () => {
      const { proxyTestResult, testProxyConnection } = useSettings();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

      await testProxyConnection(PROXY_URL, null);

      expect(proxyTestResult.value).toEqual({
        success: false,
        message: 'Proxy reachable, but no API key was provided — add your Proxy API Key',
      });

      globalThis.fetch = originalFetch;
    });

    it('should report a generic network failure', async () => {
      const { proxyTestResult, testProxyConnection } = useSettings();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

      await testProxyConnection(PROXY_URL, 'valid-key');

      expect(proxyTestResult.value).toEqual({
        success: false,
        message: 'Could not reach the proxy URL — check that it is correct',
      });

      globalThis.fetch = originalFetch;
    });

    it('should report a timeout when the request aborts', async () => {
      const { proxyTestResult, testProxyConnection } = useSettings();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new DOMException('aborted', 'AbortError'));

      await testProxyConnection(PROXY_URL, 'valid-key');

      expect(proxyTestResult.value).toEqual({
        success: false,
        message: 'Connection timed out — check the proxy URL',
      });

      globalThis.fetch = originalFetch;
    });

    it('should set testingProxy to false after completion', async () => {
      const { testingProxy, testProxyConnection } = useSettings();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      await testProxyConnection(PROXY_URL, 'valid-key');

      expect(testingProxy.value).toBe(false);

      globalThis.fetch = originalFetch;
    });
  });
});
