/**
 * Settings stored in chrome.storage.local.
 * All fields have defaults defined in DEFAULT_SETTINGS (see settings manager).
 */

/** Audit prompt variant for A/B testing. */
export type AuditPromptVariant = 'default' | 'cot' | 'rubric';

export interface Settings {
  // -- API keys --------------------------------------------------------------

  /** User's OpenAI API key for AI features. */
  openaiApiKey: string | null;

  // -- Queue & scanning ------------------------------------------------------

  /** Base delay between CWS requests in milliseconds. Min: 30000. */
  queueDelayMs: number;
  /** Randomized jitter range in milliseconds. Actual delay = base +/- jitter. */
  queueJitterMs: number;
  /** Preferred daily scan time in HH:MM format (24-hour). */
  dailyScanTime: string;
  /** Whether automatic daily scanning is enabled. */
  dailyScanEnabled: boolean;
  /**
   * Maximum number of reviews to fetch per extension per review scan.
   * The first page (~10 newest) is always fetched; the rest are paginated
   * up to this cap. Range: 10–500.
   */
  reviewFetchLimit: number;
  /** YYYY-MM-DD date of the last completed daily scan. `null` if never scanned. */
  lastDailyScanDate: string | null;
  /**
   * ISO timestamp for when the current scan cycle started. Used to filter
   * `queue.completed`/`queue.failed` counts so the progress UI does not mix
   * jobs from prior cycles still retained in the queue table. `null` when
   * no scan cycle is active.
   */
  scanCycleStartedAt: string | null;

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

  // -- AI Audit ---------------------------------------------------------------

  /** Custom system prompt for the AI keyword audit. Empty string = use default. */
  auditSystemPrompt: string;
  /** Custom user prompt template for the AI keyword audit. Empty string = use default.
   * Supports {{placeholder}} syntax for data interpolation. */
  auditUserPromptTemplate: string;
  /** Active audit prompt variant for A/B testing. */
  auditPromptVariant: AuditPromptVariant;

  // -- UI state --------------------------------------------------------------

  /** Whether the onboarding wizard has been completed. */
  onboardingCompleted: boolean;
}
