/**
 * Composable for data import/export in the dashboard.
 *
 * Wraps data-export utilities with reactive Vue state,
 * file download/upload handling, and settings integration.
 */

import { ref } from 'vue';
import { db } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import type { Settings } from '@/shared/types/settings';
import {
  buildExportData,
  serializeExportData,
  deserializeExportData,
  validateExportFile,
  importData,
  generateExportFilename,
  type ExportData,
  type ValidationResult,
  type ImportProgress,
} from '@/shared/utils/data-export';

const settingsManager = new SettingsManager();

export function useDataTransfer() {
  const exporting = ref(false);
  const importing = ref(false);
  const importProgress = ref<ImportProgress | null>(null);
  const error = ref<string | null>(null);
  const successMessage = ref<string | null>(null);
  const validationResult = ref<ValidationResult | null>(null);

  // Stored internally after validation, used by confirmImport
  let pendingImportData: ExportData | null = null;

  function getExtensionVersion(): string {
    try {
      return chrome?.runtime?.getManifest?.()?.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async function exportData(): Promise<void> {
    exporting.value = true;
    error.value = null;
    successMessage.value = null;
    try {
      const settings = await settingsManager.getWithDefaults();
      const data = await buildExportData(db, settings, getExtensionVersion());
      const json = serializeExportData(data);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = generateExportFilename();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        URL.revokeObjectURL(url);
      }
      successMessage.value = 'Data exported successfully';
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to export data';
    } finally {
      exporting.value = false;
    }
  }

  async function validateFile(file: File): Promise<void> {
    error.value = null;
    successMessage.value = null;
    validationResult.value = null;
    pendingImportData = null;

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        validationResult.value = {
          valid: false,
          errors: ['File is not valid JSON'],
          warnings: [],
          counts: {},
        };
        return;
      }

      const result = validateExportFile(parsed);
      validationResult.value = result;

      if (result.valid) {
        // Re-parse with date reviver for actual import
        pendingImportData = deserializeExportData(text);
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to read file';
    }
  }

  async function confirmImport(): Promise<void> {
    if (!pendingImportData) {
      error.value = 'No validated data to import';
      return;
    }

    importing.value = true;
    error.value = null;
    successMessage.value = null;

    try {
      await importData(db, pendingImportData, (progress) => {
        importProgress.value = { ...progress };
      });

      // Import settings (non-fatal on failure)
      if (pendingImportData.settings && Object.keys(pendingImportData.settings).length > 0) {
        try {
          await settingsManager.setMultiple(pendingImportData.settings);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          successMessage.value = `Data imported successfully. Warning: settings import failed (${msg})`;
          pendingImportData = null;
          validationResult.value = null;
          importProgress.value = null;
          return;
        }
      }

      successMessage.value = 'All data imported successfully';
      pendingImportData = null;
      validationResult.value = null;
      importProgress.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to import data';
      importProgress.value = null;
    } finally {
      importing.value = false;
    }
  }

  function cancelImport(): void {
    pendingImportData = null;
    validationResult.value = null;
    error.value = null;
    successMessage.value = null;
  }

  return {
    exporting,
    importing,
    importProgress,
    error,
    successMessage,
    validationResult,
    exportData,
    validateFile,
    confirmImport,
    cancelImport,
  };
}
