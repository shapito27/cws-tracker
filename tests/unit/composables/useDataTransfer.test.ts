/**
 * Tests for the import/export composable.
 *
 * Focus: restoring a backup must not silently overwrite live settings. An
 * export carries the proxy URL, proxy API key and OpenAI key that were current
 * when it was taken; writing those over working credentials breaks scanning in
 * a way that is very hard to trace back to the import.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetChromeMock } from '../../mocks/chrome';
import { db } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import { useDataTransfer } from '@/dashboard/composables/useDataTransfer';
import type { ExportData } from '@/shared/utils/data-export';

const settingsManager = new SettingsManager();

function makeExportPayload(overrides: Partial<ExportData> = {}): ExportData {
  return {
    meta: {
      exportedAt: new Date().toISOString(),
      extensionVersion: '0.37.1',
      schemaVersion: 5,
      format: 'cws-tracker-v1',
    },
    settings: { proxyUrl: 'https://stale-proxy.example.com', queueDelayMs: 90000 },
    tables: {
      projects: [
        {
          name: 'Restored',
          ownExtensionId: 'ext-1',
          competitorIds: [],
          keywordIds: [],
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      extensions: [],
      keywords: [],
      listing_snapshots: [],
      rank_snapshots: [],
      events: [],
      translation_snapshots: [],
      audit_cache: [],
      autocomplete_snapshots: [],
      autocomplete_keyword_suggestions: [],
      reviews: [],
    },
    ...overrides,
  };
}

/** Feed a payload through validateFile so confirmImport has pending data. */
async function stageImport(
  transfer: ReturnType<typeof useDataTransfer>,
  payload: ExportData
): Promise<void> {
  const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
  await transfer.validateFile(file);
  expect(transfer.validationResult.value?.valid).toBe(true);
}

beforeEach(async () => {
  resetChromeMock();
  for (const table of db.tables) {
    await table.clear();
  }
  await settingsManager.setMultiple({
    proxyUrl: 'https://live-proxy.example.com',
    queueDelayMs: 60000,
  });
});

describe('useDataTransfer > confirmImport', () => {
  it('restores table data without touching settings by default', async () => {
    const transfer = useDataTransfer();
    await stageImport(transfer, makeExportPayload());

    await transfer.confirmImport();

    // Table data restored...
    expect(await db.projects.count()).toBe(1);
    // ...but the live credentials survive.
    const settings = await settingsManager.getAll();
    expect(settings.proxyUrl).toBe('https://live-proxy.example.com');
    expect(settings.queueDelayMs).toBe(60000);
  });

  it('restores settings only when explicitly opted in', async () => {
    const transfer = useDataTransfer();
    await stageImport(transfer, makeExportPayload());

    await transfer.confirmImport({ restoreSettings: true });

    expect(await db.projects.count()).toBe(1);
    const settings = await settingsManager.getAll();
    expect(settings.proxyUrl).toBe('https://stale-proxy.example.com');
    expect(settings.queueDelayMs).toBe(90000);
  });

  it('says settings were skipped so a restore onto a fresh profile is not misread', async () => {
    const transfer = useDataTransfer();
    await stageImport(transfer, makeExportPayload());

    await transfer.confirmImport();

    expect(transfer.successMessage.value).toContain('Settings were not restored');
  });

  it('does not mention skipped settings when the backup carried none', async () => {
    const transfer = useDataTransfer();
    await stageImport(transfer, makeExportPayload({ settings: {} }));

    await transfer.confirmImport();

    expect(transfer.successMessage.value).toBe('All data imported successfully');
  });

  it('leaves settings alone when restoreSettings is explicitly false', async () => {
    const transfer = useDataTransfer();
    await stageImport(transfer, makeExportPayload());

    await transfer.confirmImport({ restoreSettings: false });

    const settings = await settingsManager.getAll();
    expect(settings.proxyUrl).toBe('https://live-proxy.example.com');
  });
});

describe('useDataTransfer > validateFile', () => {
  it('flags a backup with no projects as about to erase existing projects', async () => {
    const transfer = useDataTransfer();
    const payload = makeExportPayload();
    payload.tables.projects = [];
    const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });

    await transfer.validateFile(file);

    expect(transfer.validationResult.value?.valid).toBe(true);
    expect(
      transfer.validationResult.value?.warnings.some((w) => w.includes('no projects'))
    ).toBe(true);
  });

  it('flags a stale backup and surfaces its export date', async () => {
    const transfer = useDataTransfer();
    const payload = makeExportPayload();
    payload.meta.exportedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const file = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });

    await transfer.validateFile(file);

    expect(transfer.validationResult.value?.warnings.some((w) => w.includes('60 days old'))).toBe(
      true
    );
    expect(transfer.validationResult.value?.exportedAt).toBe(payload.meta.exportedAt);
  });
});
