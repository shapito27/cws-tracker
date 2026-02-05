/**
 * Settings stored in chrome.storage.local.
 * All fields have defaults defined in DEFAULT_SETTINGS (see settings manager).
 */

/** Subscription / license status. */
export type SubscriptionStatus = 'free' | 'pro' | 'expired';

export interface Settings {
  // -- API keys & licensing --------------------------------------------------

  /** User's OpenAI API key for AI features. */
  openaiApiKey: string | null;
  /** LemonSqueezy license key for Pro tier. */
  lemonSqueezyLicense: string | null;
  /** Current subscription status. */
  subscriptionStatus: SubscriptionStatus;

  // -- Queue & scanning ------------------------------------------------------

  /** Base delay between CWS requests in milliseconds. Min: 30000. */
  queueDelayMs: number;
  /** Randomized jitter range in milliseconds. Actual delay = base +/- jitter. */
  queueJitterMs: number;
  /** Preferred daily scan time in HH:MM format (24-hour). */
  dailyScanTime: string;
  /** Whether automatic daily scanning is enabled. */
  dailyScanEnabled: boolean;
  /** YYYY-MM-DD date of the last completed daily scan. `null` if never scanned. */
  lastDailyScanDate: string | null;

  // -- Proxy -----------------------------------------------------------------

  /** URL of the CWS proxy server (Cloudflare Worker). */
  proxyUrl: string;
  /** API key for authenticating with the proxy. */
  proxyApiKey: string | null;

  // -- Data management -------------------------------------------------------

  /** How many days of snapshot data to retain. Min: 7. */
  dataRetentionDays: number;

  // -- Translation audit -----------------------------------------------------

  /** Default locales to check during translation audits. */
  translationLocales: string[];

  // -- Parser ----------------------------------------------------------------

  /** Active parser version identifier. */
  parserVersion: string;

  // -- UI state --------------------------------------------------------------

  /** Whether the onboarding wizard has been completed. */
  onboardingCompleted: boolean;
}
