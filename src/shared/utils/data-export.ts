/**
 * Import/export utilities for CWS Tracker data.
 *
 * Pure functions — no Vue or Chrome API dependencies.
 * Settings are passed in/out rather than accessed directly.
 */

import type { CWSDatabase } from '../db/database';
import type {
  Project,
  Extension,
  Keyword,
  ListingSnapshot,
  RankSnapshot,
  EventRecord,
  TranslationSnapshot,
  AutocompleteSnapshot,
  AutocompleteKeywordSuggestion,
} from '../types';
import type { CachedAuditResult } from './keyword-audit';
import type { Settings } from '../types/settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportMeta {
  exportedAt: string;
  extensionVersion: string;
  schemaVersion: number;
  format: 'cws-tracker-v1';
}

export interface ExportTables {
  projects: Project[];
  extensions: Extension[];
  keywords: Keyword[];
  listing_snapshots: ListingSnapshot[];
  rank_snapshots: RankSnapshot[];
  events: EventRecord[];
  translation_snapshots: TranslationSnapshot[];
  audit_cache: CachedAuditResult[];
  autocomplete_snapshots: AutocompleteSnapshot[];
  autocomplete_keyword_suggestions: AutocompleteKeywordSuggestion[];
}

export interface ExportData {
  meta: ExportMeta;
  settings: Partial<Settings>;
  tables: ExportTables;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
}

export interface ImportProgress {
  table: string;
  done: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENT_SCHEMA_VERSION = 4;
const EXPORT_FORMAT = 'cws-tracker-v1' as const;

/** Table names included in export (excludes queue and scan_logs). */
const EXPORT_TABLE_NAMES: (keyof ExportTables)[] = [
  'projects',
  'extensions',
  'keywords',
  'listing_snapshots',
  'rank_snapshots',
  'events',
  'translation_snapshots',
  'audit_cache',
  'autocomplete_snapshots',
  'autocomplete_keyword_suggestions',
];

/**
 * Field names that contain Date objects and need revival from JSON strings.
 * Used by the JSON.parse reviver.
 */
const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'addedAt',
  'lastScannedAt',
  'scannedAt',
  'detectedAt',
  'scheduledAt',
  'startedAt',
  'completedAt',
]);

// ---------------------------------------------------------------------------
// Export functions
// ---------------------------------------------------------------------------

export async function buildExportData(
  db: CWSDatabase,
  settings: Partial<Settings>,
  extensionVersion: string
): Promise<ExportData> {
  const tables: ExportTables = {
    projects: await db.projects.toArray(),
    extensions: await db.extensions.toArray(),
    keywords: await db.keywords.toArray(),
    listing_snapshots: await db.listing_snapshots.toArray(),
    rank_snapshots: await db.rank_snapshots.toArray(),
    events: await db.events.toArray(),
    translation_snapshots: await db.translation_snapshots.toArray(),
    audit_cache: await db.audit_cache.toArray(),
    autocomplete_snapshots: await db.autocomplete_snapshots.toArray(),
    autocomplete_keyword_suggestions: await db.autocomplete_keyword_suggestions.toArray(),
  };

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      extensionVersion,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      format: EXPORT_FORMAT,
    },
    settings,
    tables,
  };
}

export function serializeExportData(data: ExportData): string {
  return JSON.stringify(data, null, 2);
}

export function deserializeExportData(json: string): ExportData {
  return JSON.parse(json, (key, value) => {
    if (DATE_FIELDS.has(key) && typeof value === 'string') {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    return value;
  }) as ExportData;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateExportFile(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts: Record<string, number> = {};

  if (raw === null || typeof raw !== 'object') {
    return { valid: false, errors: ['File is not a valid JSON object'], warnings, counts };
  }

  const data = raw as Record<string, unknown>;

  // Check meta
  if (!data.meta || typeof data.meta !== 'object') {
    errors.push('Missing or invalid "meta" field');
  } else {
    const meta = data.meta as Record<string, unknown>;
    if (meta.format !== EXPORT_FORMAT) {
      errors.push(`Invalid format: expected "${EXPORT_FORMAT}", got "${String(meta.format)}"`);
    }
    if (typeof meta.schemaVersion !== 'number') {
      errors.push('Missing or invalid "meta.schemaVersion"');
    } else if (meta.schemaVersion > CURRENT_SCHEMA_VERSION) {
      warnings.push(
        `Export schema version ${meta.schemaVersion} is newer than current ${CURRENT_SCHEMA_VERSION}. Some data may not import correctly.`
      );
    }
  }

  // Check tables
  if (!data.tables || typeof data.tables !== 'object') {
    errors.push('Missing or invalid "tables" field');
  } else {
    const tables = data.tables as Record<string, unknown>;
    for (const name of EXPORT_TABLE_NAMES) {
      if (!(name in tables)) {
        errors.push(`Missing table "${name}"`);
      } else if (!Array.isArray(tables[name])) {
        errors.push(`Table "${name}" is not an array`);
      } else {
        counts[name] = (tables[name] as unknown[]).length;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importData(
  db: CWSDatabase,
  data: ExportData,
  onProgress?: (progress: ImportProgress) => void
): Promise<void> {
  const tableEntries: Array<{ name: keyof ExportTables; records: unknown[] }> = EXPORT_TABLE_NAMES.map(
    (name) => ({ name, records: data.tables[name] })
  );
  const total = tableEntries.length;

  await db.transaction(
    'rw',
    [
      db.projects,
      db.extensions,
      db.keywords,
      db.listing_snapshots,
      db.rank_snapshots,
      db.events,
      db.translation_snapshots,
      db.audit_cache,
      db.autocomplete_snapshots,
      db.autocomplete_keyword_suggestions,
    ],
    async () => {
      for (let i = 0; i < tableEntries.length; i++) {
        const { name, records } = tableEntries[i];
        onProgress?.({ table: name, done: i, total });

        // Clear existing data
        await db.table(name).clear();

        // Insert new data
        if (records.length > 0) {
          await db.table(name).bulkPut(records);
        }
      }
      onProgress?.({ table: 'done', done: total, total });
    }
  );
}

// ---------------------------------------------------------------------------
// Filename helper
// ---------------------------------------------------------------------------

export function generateExportFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `cws-tracker-export-${yyyy}-${mm}-${dd}.json`;
}
