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
  /** Preferred daily scan time in HH:MM format (24-hour). Anchors slot 0. */
  dailyScanTime: string;
  /** Whether automatic daily scanning is enabled. */
  dailyScanEnabled: boolean;
  /**
   * How many scan cycles to run per day. Range: 1–4. Default 1.
   *
   * Slot 0 fires at `dailyScanTime`; each later slot follows `24/N` hours after
   * the previous one, with per-slot jitter. Above 1, a change's observation
   * window narrows correspondingly — 3 scans a day bounds a change to ~8h
   * instead of ~24h.
   *
   * Costs one full cycle of CWS requests per scan, so raising it multiplies
   * request volume. Capped at 4 to keep `24/N` a whole number of hours and to
   * bound that volume.
   */
  scansPerDay: number;
  /**
   * Maximum number of reviews to fetch per extension per review scan.
   * The first page (~10 newest) is always fetched; the rest are paginated
   * up to this cap. Range: 10–500.
   */
  reviewFetchLimit: number;
  /** YYYY-MM-DD date of the last completed daily scan. `null` if never scanned. */
  lastDailyScanDate: string | null;
  /**
   * Which scan slot last completed, as `"YYYY-MM-DD#slot"`. `null` if never.
   *
   * `lastDailyScanDate` cannot express "slot 1 already ran today", so it can't
   * gate a schedule with more than one slot. This is the field the
   * already-scanned guards key on; `lastDailyScanDate` is still maintained for
   * the popup's "last scanned" display.
   */
  lastScanSlotKey: string | null;
  /**
   * ISO timestamp for when the current scan cycle started. Used to filter
   * `queue.completed`/`queue.failed` counts so the progress UI does not mix
   * jobs from prior cycles still retained in the queue table. `null` when
   * no scan cycle is active.
   */
  scanCycleStartedAt: string | null;
  /**
   * The `"YYYY-MM-DD#slot"` key of the in-flight scan cycle, or `null` when no
   * cycle is active.
   *
   * Set when a cycle is enqueued and stamped into `lastScanSlotKey` when it
   * drains. Recomputing the slot at drain time instead would attribute the run
   * to the wrong slot whenever a cycle outlives its own slot boundary, which is
   * routine at `scansPerDay: 4` with many keywords.
   */
  scanCycleSlotKey: string | null;

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
  /**
   * Whether charts and tables expand a multi-sample day into its samples.
   *
   * Off (default): one point per day, the day's last sample — identical to how
   * everything read before multi-sampling. On: the day opens into its individual
   * samples and their spread. Only surfaced when the visible range actually
   * contains a day with more than one sample.
   */
  intradayView: boolean;
}
