/**
 * License management composable.
 *
 * Wraps PUT /api/license for activating LemonSqueezy license keys against
 * the CWS Tracker server, and persists the result into chrome.storage.local.
 *
 * The plan state is reactive so UI components can update (badge, tier gates)
 * as soon as a license activation succeeds.
 */

import { ref } from 'vue';
import { SERVER_URL } from '@/shared/types/settings';
import { SettingsManager } from '@/shared/utils/settings';

export type Plan = 'free' | 'pro';

export interface UseLicenseReturn {
  plan: ReturnType<typeof ref<Plan>>;
  licenseKey: ReturnType<typeof ref<string | null>>;
  loading: ReturnType<typeof ref<boolean>>;
  error: ReturnType<typeof ref<string | null>>;
  loadLicense: () => Promise<void>;
  activateLicense: (key: string) => Promise<boolean>;
  deactivateLicense: () => Promise<void>;
}

const settingsManager = new SettingsManager();

export function useLicense(): UseLicenseReturn {
  const plan = ref<Plan>('free');
  const licenseKey = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadLicense(): Promise<void> {
    const stored = await settingsManager.getWithDefaults();
    plan.value = stored.subscriptionStatus === 'pro' ? 'pro' : 'free';
    licenseKey.value = stored.lemonSqueezyLicense;
  }

  async function activateLicense(key: string): Promise<boolean> {
    error.value = null;

    const trimmed = key.trim();
    if (trimmed.length === 0) {
      error.value = 'License key is required.';
      return false;
    }

    loading.value = true;
    try {
      const stored = await settingsManager.getWithDefaults();
      if (!stored.serverApiKey) {
        error.value = 'Extension not registered with server yet. Try again shortly.';
        return false;
      }
      const response = await fetch(`${SERVER_URL}/api/license`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': stored.serverApiKey,
        },
        body: JSON.stringify({ licenseKey: trimmed }),
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const body = await response.json() as { error?: string };
          if (body.error) detail = body.error;
        } catch { /* not JSON */ }
        error.value = detail;
        return false;
      }

      await settingsManager.setMultiple({
        lemonSqueezyLicense: trimmed,
        subscriptionStatus: 'pro',
      });
      plan.value = 'pro';
      licenseKey.value = trimmed;
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function deactivateLicense(): Promise<void> {
    await settingsManager.setMultiple({
      lemonSqueezyLicense: null,
      subscriptionStatus: 'free',
    });
    plan.value = 'free';
    licenseKey.value = null;
  }

  return {
    plan,
    licenseKey,
    loading,
    error,
    loadLicense,
    activateLicense,
    deactivateLicense,
  };
}
