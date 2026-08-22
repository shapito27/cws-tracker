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
  Review,
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
  reviews: Review[];
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
  /** ISO timestamp the file was exported at, when readable. Lets the UI warn about stale backups. */
  exportedAt?: string;
}

export interface ImportProgress {
  table: string;
  done: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENT_SCHEMA_VERSION = 5;
const EXPORT_FORMAT = 'cws-tracker-v1' as const;

/** Age at which a backup is old enough that a destructive import deserves a warning. */
const STALE_EXPORT_WARNING_DAYS = 7;

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
  'reviews',
];

/**
 * Tables introduced after the export format shipped. Files written by older
 * builds legitimately lack them, so a missing key is a warning (treated as an
 * empty table) rather than a validation error.
 */
const OPTIONAL_TABLE_NAMES: ReadonlySet<keyof ExportTables> = new Set<keyof ExportTables>([
  'reviews',
]);

/**
 * Field names that contain Date objects and need revival from JSON strings.
 * Used by the JSON.parse reviver.
 *
 * IMPORTANT: the reviver matches on field name across every table, so only add
 * names that are `Date` in *all* types that use them. Indexed `YYYY-MM-DD`
 * strings (Review.postedDate, Review.devReplyDate, *.date) must NOT be listed —
 * reviving them into Date objects breaks the compound indexes built on them.
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
  // Review timestamps (schema v5)
  'firstSeenAt',
  'lastSeenAt',
  'lastChangedAt',
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
    reviews: await db.reviews.toArray(),
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
  let exportedAt: string | undefined;

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
    if (typeof meta.exportedAt === 'string' && !isNaN(new Date(meta.exportedAt).getTime())) {
      exportedAt = meta.exportedAt;
      const ageDays = exportAgeInDays(meta.exportedAt);
      if (ageDays === null) {
        // Ahead of the local clock: skew or a hand-edited file. The age can't be
        // trusted, so warn rather than staying silent — silence here is exactly
        // the failure this guard exists to prevent.
        warnings.push(
          `This backup's export date (${meta.exportedAt.slice(0, 10)}) is in the future, so its ` +
            'age cannot be verified. Importing replaces all current data.'
        );
      } else if (ageDays >= STALE_EXPORT_WARNING_DAYS) {
        warnings.push(
          `This backup is ${ageDays} days old (exported ${meta.exportedAt.slice(0, 10)}). ` +
            'Importing replaces all current data — anything recorded since then will be lost.'
        );
      }
    }
  }

  // Check tables
  if (!data.tables || typeof data.tables !== 'object') {
    errors.push('Missing or invalid "tables" field');
  } else {
    const tables = data.tables as Record<string, unknown>;
    for (const name of EXPORT_TABLE_NAMES) {
      if (!(name in tables)) {
        if (OPTIONAL_TABLE_NAMES.has(name)) {
          warnings.push(`Table "${name}" is absent (older export); it will be imported as empty.`);
          counts[name] = 0;
        } else {
          errors.push(`Missing table "${name}"`);
        }
      } else if (!Array.isArray(tables[name])) {
        errors.push(`Table "${name}" is not an array`);
      } else {
        counts[name] = (tables[name] as unknown[]).length;
      }
    }

    if (counts.projects === 0) {
      warnings.push(
        'This file contains no projects. Importing it will erase every project you currently have.'
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts,
    exportedAt,
  };
}

/** Whole days between `isoTimestamp` and now, or null if unparseable/in the future. */
function exportAgeInDays(isoTimestamp: string): number | null {
  const then = new Date(isoTimestamp).getTime();
  if (isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  return days < 0 ? null : days;
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
    // A table absent from an older export (see OPTIONAL_TABLE_NAMES) imports as empty.
    (name) => ({ name, records: data.tables[name] ?? [] })
  );
  const total = tableEntries.length;

  // Scope is derived from EXPORT_TABLE_NAMES rather than hand-listed: a table
  // added to the export but missed here would make db.table(name).clear() throw
  // NotFoundError and abort every import.
  await db.transaction(
    'rw',
    EXPORT_TABLE_NAMES.map((name) => db.table(name)),
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
