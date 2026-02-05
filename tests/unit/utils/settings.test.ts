/**
 * Tests for SettingsManager (Phase 1.3).
 *
 * Uses the chrome.storage.local mock from tests/mocks/chrome.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resetChromeMock } from '../../mocks/chrome';
import {
  SettingsManager,
  SettingsValidationError,
  DEFAULT_SETTINGS,
} from '../../../src/shared/utils/settings';

let settings: SettingsManager;

beforeEach(() => {
  resetChromeMock();
  settings = new SettingsManager();
});

// ---------------------------------------------------------------------------
// getAll / getWithDefaults
// ---------------------------------------------------------------------------

describe('getAll()', () => {
  it('returns empty object when storage is empty', async () => {
    const result = await settings.getAll();
    expect(result).toEqual({});
  });
});

describe('getWithDefaults()', () => {
  it('returns defaults when storage is empty', async () => {
    const result = await settings.getWithDefaults();
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it('merges stored values with defaults (stored values win)', async () => {
    await settings.set('queueDelayMs', 90_000);
    const result = await settings.getWithDefaults();
    expect(result.queueDelayMs).toBe(90_000);
    // Other defaults remain
    expect(result.dataRetentionDays).toBe(DEFAULT_SETTINGS.dataRetentionDays);
    expect(result.dailyScanTime).toBe(DEFAULT_SETTINGS.dailyScanTime);
    expect(result.subscriptionStatus).toBe('free');
  });
});

// ---------------------------------------------------------------------------
// get / set
// ---------------------------------------------------------------------------

describe('set() then get()', () => {
  it('returns the set value', async () => {
    await settings.set('queueDelayMs', 120_000);
    const value = await settings.get('queueDelayMs');
    expect(value).toBe(120_000);
  });

  it('persists string values', async () => {
    await settings.set('dailyScanTime', '14:30');
    const value = await settings.get('dailyScanTime');
    expect(value).toBe('14:30');
  });

  it('persists null values', async () => {
    await settings.set('openaiApiKey', 'sk-test123');
    expect(await settings.get('openaiApiKey')).toBe('sk-test123');

    await settings.set('openaiApiKey', null);
    expect(await settings.get('openaiApiKey')).toBeNull();
  });

  it('persists boolean values', async () => {
    await settings.set('dailyScanEnabled', true);
    expect(await settings.get('dailyScanEnabled')).toBe(true);
  });

  it('persists array values', async () => {
    const locales = ['en', 'de', 'fr'];
    await settings.set('translationLocales', locales);
    expect(await settings.get('translationLocales')).toEqual(locales);
  });
});

describe('get() for non-existent key', () => {
  it('returns default value when key has not been set', async () => {
    const value = await settings.get('queueDelayMs');
    expect(value).toBe(DEFAULT_SETTINGS.queueDelayMs);
  });

  it('returns null default for nullable keys', async () => {
    const value = await settings.get('openaiApiKey');
    expect(value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setMultiple
// ---------------------------------------------------------------------------

describe('setMultiple()', () => {
  it('sets multiple keys at once', async () => {
    await settings.setMultiple({
      queueDelayMs: 90_000,
      dataRetentionDays: 180,
      dailyScanTime: '06:00',
    });

    expect(await settings.get('queueDelayMs')).toBe(90_000);
    expect(await settings.get('dataRetentionDays')).toBe(180);
    expect(await settings.get('dailyScanTime')).toBe('06:00');
  });

  it('does not overwrite keys not in the partial', async () => {
    await settings.set('queueDelayMs', 90_000);
    await settings.setMultiple({ dataRetentionDays: 30 });

    expect(await settings.get('queueDelayMs')).toBe(90_000);
    expect(await settings.get('dataRetentionDays')).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('Validation', () => {
  it('rejects queueDelayMs below 30000', async () => {
    await expect(settings.set('queueDelayMs', 5000)).rejects.toThrow(
      SettingsValidationError
    );
    await expect(settings.set('queueDelayMs', 5000)).rejects.toThrow(
      'queueDelayMs must be >= 30000'
    );
  });

  it('rejects queueDelayMs of 0', async () => {
    await expect(settings.set('queueDelayMs', 0)).rejects.toThrow(
      SettingsValidationError
    );
  });

  it('accepts queueDelayMs at exactly 30000', async () => {
    await expect(settings.set('queueDelayMs', 30_000)).resolves.toBeUndefined();
    expect(await settings.get('queueDelayMs')).toBe(30_000);
  });

  it('rejects dataRetentionDays below 7', async () => {
    await expect(settings.set('dataRetentionDays', 0)).rejects.toThrow(
      SettingsValidationError
    );
    await expect(settings.set('dataRetentionDays', 6)).rejects.toThrow(
      'dataRetentionDays must be >= 7'
    );
  });

  it('accepts dataRetentionDays at exactly 7', async () => {
    await expect(settings.set('dataRetentionDays', 7)).resolves.toBeUndefined();
    expect(await settings.get('dataRetentionDays')).toBe(7);
  });

  it('rejects negative queueJitterMs', async () => {
    await expect(settings.set('queueJitterMs', -1)).rejects.toThrow(
      SettingsValidationError
    );
  });

  it('accepts queueJitterMs of 0', async () => {
    await expect(settings.set('queueJitterMs', 0)).resolves.toBeUndefined();
  });

  it('rejects invalid dailyScanTime format', async () => {
    await expect(settings.set('dailyScanTime', '25:00')).rejects.toThrow(
      SettingsValidationError
    );
    await expect(settings.set('dailyScanTime', '3:00')).rejects.toThrow(
      SettingsValidationError
    );
    await expect(settings.set('dailyScanTime', 'noon')).rejects.toThrow(
      SettingsValidationError
    );
  });

  it('accepts valid dailyScanTime values', async () => {
    await expect(settings.set('dailyScanTime', '00:00')).resolves.toBeUndefined();
    await expect(settings.set('dailyScanTime', '23:59')).resolves.toBeUndefined();
    await expect(settings.set('dailyScanTime', '12:30')).resolves.toBeUndefined();
  });

  it('rejects non-array translationLocales', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings.set('translationLocales', 'en' as any)
    ).rejects.toThrow(SettingsValidationError);
  });

  it('validates all keys in setMultiple', async () => {
    await expect(
      settings.setMultiple({
        queueDelayMs: 5000,
        dataRetentionDays: 365,
      })
    ).rejects.toThrow(SettingsValidationError);

    // None of the values should have been persisted
    const stored = await settings.getAll();
    expect(stored).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SETTINGS sanity checks
// ---------------------------------------------------------------------------

describe('DEFAULT_SETTINGS', () => {
  it('has expected default values from PRD', () => {
    expect(DEFAULT_SETTINGS.queueDelayMs).toBe(60_000);
    expect(DEFAULT_SETTINGS.queueJitterMs).toBe(10_000);
    expect(DEFAULT_SETTINGS.dailyScanTime).toBe('03:00');
    expect(DEFAULT_SETTINGS.dailyScanEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.dataRetentionDays).toBe(365);
    expect(DEFAULT_SETTINGS.subscriptionStatus).toBe('free');
    expect(DEFAULT_SETTINGS.parserVersion).toBe('v1');
    expect(DEFAULT_SETTINGS.onboardingCompleted).toBe(false);
    expect(DEFAULT_SETTINGS.openaiApiKey).toBeNull();
    expect(DEFAULT_SETTINGS.lemonSqueezyLicense).toBeNull();
    expect(DEFAULT_SETTINGS.lastDailyScanDate).toBeNull();
    expect(DEFAULT_SETTINGS.proxyUrl).toBe('');
    expect(DEFAULT_SETTINGS.proxyApiKey).toBeNull();
  });

  it('has 15 default translation locales per PRD 5.3.6', () => {
    expect(DEFAULT_SETTINGS.translationLocales).toHaveLength(15);
    expect(DEFAULT_SETTINGS.translationLocales).toContain('en');
    expect(DEFAULT_SETTINGS.translationLocales).toContain('zh_CN');
    expect(DEFAULT_SETTINGS.translationLocales).toContain('pt_BR');
  });
});
