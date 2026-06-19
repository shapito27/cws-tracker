/**
 * Settings manager wrapping chrome.storage.local.
 *
 * All settings have defaults defined by DEFAULT_SETTINGS. Values stored in
 * chrome.storage.local take precedence over defaults.
 */

import type { Settings, AuditPromptVariant } from '../types/settings';

// ---------------------------------------------------------------------------
// Defaults (values from PRD Section 4.2 / 5.3.6)
// ---------------------------------------------------------------------------

/** Default translation locales for translation audit (PRD 5.3.6). */
const DEFAULT_TRANSLATION_LOCALES: string[] = [
  'en', 'es', 'fr', 'de', 'pt_BR',
  'ja', 'zh_CN', 'ko', 'ru', 'ar',
  'hi', 'it', 'nl', 'pl', 'tr',
];

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  openaiApiKey: null,
  queueDelayMs: 60_000,
  queueJitterMs: 10_000,
  dailyScanTime: '03:00',
  dailyScanEnabled: false,
  lastDailyScanDate: null,
  scanCycleStartedAt: null,
  proxyUrl: '',
  proxyApiKey: null,
  dataRetentionDays: 365,
  translationLocales: DEFAULT_TRANSLATION_LOCALES,
  parserVersion: 'v1',
  auditSystemPrompt: '',
  auditUserPromptTemplate: '',
  auditPromptVariant: 'default',
  onboardingCompleted: false,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Minimum allowed value for queueDelayMs (30 seconds). */
const MIN_QUEUE_DELAY_MS = 30_000;
/** Minimum allowed value for dataRetentionDays. */
const MIN_DATA_RETENTION_DAYS = 7;
/** Pattern for HH:MM 24-hour time. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Valid audit prompt variants. */
const VALID_AUDIT_VARIANTS: AuditPromptVariant[] = ['default', 'cot', 'rubric'];

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

/**
 * Validates a partial settings object. Throws SettingsValidationError on
 * invalid values. Only validates keys that are present.
 */
function validatePartial(partial: Partial<Settings>): void {
  if ('queueDelayMs' in partial) {
    if (typeof partial.queueDelayMs !== 'number' || partial.queueDelayMs < MIN_QUEUE_DELAY_MS) {
      throw new SettingsValidationError(
        `queueDelayMs must be >= ${MIN_QUEUE_DELAY_MS}, got ${partial.queueDelayMs}`
      );
    }
  }

  if ('queueJitterMs' in partial) {
    if (typeof partial.queueJitterMs !== 'number' || partial.queueJitterMs < 0) {
      throw new SettingsValidationError(
        `queueJitterMs must be >= 0, got ${partial.queueJitterMs}`
      );
    }
  }

  if ('dataRetentionDays' in partial) {
    if (typeof partial.dataRetentionDays !== 'number' || partial.dataRetentionDays < MIN_DATA_RETENTION_DAYS) {
      throw new SettingsValidationError(
        `dataRetentionDays must be >= ${MIN_DATA_RETENTION_DAYS}, got ${partial.dataRetentionDays}`
      );
    }
  }

  if ('dailyScanTime' in partial) {
    if (typeof partial.dailyScanTime !== 'string' || !TIME_PATTERN.test(partial.dailyScanTime)) {
      throw new SettingsValidationError(
        `dailyScanTime must be HH:MM (24-hour), got "${partial.dailyScanTime}"`
      );
    }
  }

  if ('translationLocales' in partial) {
    if (!Array.isArray(partial.translationLocales)) {
      throw new SettingsValidationError('translationLocales must be an array');
    }
    if (partial.translationLocales.length === 0) {
      throw new SettingsValidationError('translationLocales must not be empty');
    }
    if (!partial.translationLocales.every((loc) => typeof loc === 'string' && loc.length > 0)) {
      throw new SettingsValidationError('translationLocales must contain only non-empty strings');
    }
  }

  if ('parserVersion' in partial) {
    if (typeof partial.parserVersion !== 'string' || partial.parserVersion.length === 0) {
      throw new SettingsValidationError('parserVersion must be a non-empty string');
    }
  }

  if ('auditPromptVariant' in partial) {
    if (!VALID_AUDIT_VARIANTS.includes(partial.auditPromptVariant as AuditPromptVariant)) {
      throw new SettingsValidationError(
        `auditPromptVariant must be one of ${VALID_AUDIT_VARIANTS.join(', ')}, got "${partial.auditPromptVariant}"`
      );
    }
  }

  if ('proxyUrl' in partial && partial.proxyUrl) {
    try {
      new URL(partial.proxyUrl);
    } catch {
      throw new SettingsValidationError(
        `proxyUrl must be a valid URL, got "${partial.proxyUrl}"`
      );
    }
  }

  if ('openaiApiKey' in partial && partial.openaiApiKey !== null) {
    if (typeof partial.openaiApiKey !== 'string' || !partial.openaiApiKey.startsWith('sk-')) {
      throw new SettingsValidationError(
        'openaiApiKey must start with "sk-" (OpenAI API key format)'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

/** Single key under which all settings are stored in chrome.storage.local. */
const STORAGE_KEY = 'settings';

// ---------------------------------------------------------------------------
// SettingsManager
// ---------------------------------------------------------------------------

export class SettingsManager {
  /**
   * Get a single setting value. Returns the stored value or the default if
   * not set.
   */
  async get<K extends keyof Settings>(key: K): Promise<Settings[K]> {
    const all = await this.getWithDefaults();
    return all[key];
  }

  /** Get all stored settings (without defaults applied for missing keys). */
  async getAll(): Promise<Partial<Settings>> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as Partial<Settings>) ?? {};
  }

  /**
   * Set a single setting. Validates the value before persisting.
   */
  async set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    validatePartial({ [key]: value } as Partial<Settings>);
    const stored = await this.getAll();
    stored[key] = value;
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  }

  /**
   * Set multiple settings at once. Validates all values before persisting.
   */
  async setMultiple(partial: Partial<Settings>): Promise<void> {
    validatePartial(partial);
    const stored = await this.getAll();
    Object.assign(stored, partial);
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  }

  /**
   * Get all settings with defaults applied for any missing keys.
   * Stored values take precedence over defaults.
   */
  async getWithDefaults(): Promise<Settings> {
    const stored = await this.getAll();
    return { ...DEFAULT_SETTINGS, ...stored };
  }
}
