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

export interface UseSettingsReturn {
  settings: ReturnType<typeof reactive<Settings>>;
  loading: ReturnType<typeof ref<boolean>>;
  saving: ReturnType<typeof ref<boolean>>;
  error: ReturnType<typeof ref<string | null>>;
  successMessage: ReturnType<typeof ref<string | null>>;
  testingOpenAI: ReturnType<typeof ref<boolean>>;
  openAITestResult: ReturnType<typeof ref<{ success: boolean; message: string } | null>>;
  loadSettings: () => Promise<void>;
  saveSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<boolean>;
  saveMultipleSettings: (partial: Partial<Settings>) => Promise<boolean>;
  testOpenAIConnection: () => Promise<void>;
}

export function useSettings(): UseSettingsReturn {
  const settings = reactive<Settings>({ ...DEFAULT_SETTINGS });
  const loading = ref(true);
  const saving = ref(false);
  const error = ref<string | null>(null);
  const successMessage = ref<string | null>(null);
  const testingOpenAI = ref(false);
  const openAITestResult = ref<{ success: boolean; message: string } | null>(null);

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

  return {
    settings,
    loading,
    saving,
    error,
    successMessage,
    testingOpenAI,
    openAITestResult,
    loadSettings,
    saveSetting,
    saveMultipleSettings,
    testOpenAIConnection,
  };
}
