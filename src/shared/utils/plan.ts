import type { Plan } from './tier-gates';
import { SettingsManager } from './settings';

const settingsManager = new SettingsManager();

/**
 * Read the current plan from chrome.storage.local.
 * Returns 'free' as a safe default if settings are unavailable.
 */
export async function getCurrentPlan(): Promise<Plan> {
  try {
    const settings = await settingsManager.getWithDefaults();
    return settings.subscriptionStatus === 'pro' ? 'pro' : 'free';
  } catch {
    return 'free';
  }
}
