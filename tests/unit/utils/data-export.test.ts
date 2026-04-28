/**
 * Tests for data export/import utilities.
 *
 * Uses fake-indexeddb (loaded via test setup) for database operations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CWSDatabase } from '@/shared/db/database';
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
} from '@/shared/types';
import type { CachedAuditResult } from '@/shared/utils/keyword-audit';
import type { Settings } from '@/shared/types/settings';
import {
  buildExportData,
  serializeExportData,
  deserializeExportData,
  validateExportFile,
  importData,
  generateExportFilename,
  type ExportData,
} from '@/shared/utils/data-export';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: 'Test Project',
    ownExtensionId: 'ext-own-123',
    competitorIds: ['ext-comp-456'],
    keywordIds: [1],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

function makeExtension(overrides: Partial<Extension> = {}): Extension {
  return {
    id: 'ext-own-123',
    name: 'Test Extension',
    iconUrl: null,
    addedAt: new Date('2026-01-01T00:00:00Z'),
    lastScannedAt: new Date('2026-01-15T10:00:00Z'),
    status: 'active',
    projectRefs: [1],
    ...overrides,
  };
}

function makeKeyword(overrides: Partial<Keyword> = {}): Keyword {
  return {
    text: 'test keyword',
    projectId: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeListingSnapshot(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    extensionId: 'ext-own-123',
    date: '2026-01-15',
    title: 'Test Extension',
    shortDescription: 'A test extension',
    fullDescription: 'Full description here',
    rating: 4.5,
    ratingCount: 100,
    reviewCount: 100,
    userCount: '10,000+',
    userCountNumeric: 10000,
    version: '1.0.0',
    lastUpdated: '2026-01-10',
    size: '1.5MiB',
    permissions: ['storage'],
    hostPermissions: [],
    permissionRiskScore: 10,
    badgeFlags: { featured: true },
    screenshotCount: 3,
    hasPromoVideo: false,
    translationCount: 5,
    availableLocales: ['en', 'es', 'fr', 'de', 'ja'],
    category: 'Productivity',
    developerName: 'Test Dev',
    developerEmail: null,
    developerVerified: false,
    listingQualityScore: 75,
    scannedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeRankSnapshot(overrides: Partial<RankSnapshot> = {}): RankSnapshot {
  return {
    keywordId: 1,
    extensionId: 'ext-own-123',
    date: '2026-01-15',
    position: 5,
    totalResults: 30,
    scannedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    extensionId: 'ext-own-123',
    date: '2026-01-15',
    type: 'title_change',
    field: 'title',
    oldValue: 'Old Title',
    newValue: 'New Title',
    note: 'Title changed',
    detectedAt: new Date('2026-01-15T10:05:00Z'),
    ...overrides,
  };
}

function makeSettings(): Partial<Settings> {
  return {
    queueDelayMs: 60000,
    queueJitterMs: 10000,
    dailyScanTime: '03:00',
    dailyScanEnabled: true,
    dataRetentionDays: 365,
    proxyUrl: 'https://proxy.example.com',
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let testDb: CWSDatabase;
let dbCounter = 0;

beforeEach(async () => {
  dbCounter++;
  testDb = new CWSDatabase(`TestExportDB_${dbCounter}`);
  await testDb.open();
});

describe('buildExportData', () => {
  it('reads all 10 tables and sets correct meta', async () => {
    await testDb.projects.add(makeProject());
    await testDb.extensions.add(makeExtension());

    const result = await buildExportData(testDb, makeSettings(), '0.21.0');

    expect(result.meta.format).toBe('cws-tracker-v1');
    expect(result.meta.extensionVersion).toBe('0.21.0');
    expect(result.meta.schemaVersion).toBe(4);
    expect(result.meta.exportedAt).toBeTruthy();

    expect(result.tables.projects).toHaveLength(1);
    expect(result.tables.extensions).toHaveLength(1);
    expect(result.tables.keywords).toHaveLength(0);
    expect(result.tables.listing_snapshots).toHaveLength(0);
    expect(result.tables.rank_snapshots).toHaveLength(0);
    expect(result.tables.events).toHaveLength(0);
    expect(result.tables.translation_snapshots).toHaveLength(0);
    expect(result.tables.audit_cache).toHaveLength(0);
    expect(result.tables.autocomplete_snapshots).toHaveLength(0);
    expect(result.tables.autocomplete_keyword_suggestions).toHaveLength(0);
  });

  it('excludes queue and scan_logs tables', async () => {
    const result = await buildExportData(testDb, {}, '0.21.0');
    const tableKeys = Object.keys(result.tables);
    expect(tableKeys).not.toContain('queue');
    expect(tableKeys).not.toContain('scan_logs');
  });

  it('includes settings in export', async () => {
    const settings = makeSettings();
    const result = await buildExportData(testDb, settings, '0.21.0');
    expect(result.settings).toEqual(settings);
  });
});

describe('serializeExportData / deserializeExportData', () => {
  it('round-trips Date objects correctly', async () => {
    const project = makeProject();
    await testDb.projects.add(project);

    const data = await buildExportData(testDb, {}, '0.21.0');
    const json = serializeExportData(data);
    const restored = deserializeExportData(json);

    expect(restored.tables.projects[0].createdAt).toBeInstanceOf(Date);
    expect(restored.tables.projects[0].createdAt.getTime()).toBe(
      project.createdAt.getTime()
    );
    expect(restored.tables.projects[0].updatedAt).toBeInstanceOf(Date);
  });

  it('handles null Date fields', async () => {
    const ext = makeExtension({ lastScannedAt: null });
    await testDb.extensions.add(ext);

    const data = await buildExportData(testDb, {}, '0.21.0');
    const json = serializeExportData(data);
    const restored = deserializeExportData(json);

    expect(restored.tables.extensions[0].lastScannedAt).toBeNull();
  });

  it('preserves scannedAt on snapshots', async () => {
    const snap = makeListingSnapshot();
    await testDb.listing_snapshots.add(snap);

    const data = await buildExportData(testDb, {}, '0.21.0');
    const json = serializeExportData(data);
    const restored = deserializeExportData(json);

    expect(restored.tables.listing_snapshots[0].scannedAt).toBeInstanceOf(Date);
    expect(restored.tables.listing_snapshots[0].scannedAt.getTime()).toBe(
      snap.scannedAt.getTime()
    );
  });

  it('preserves detectedAt on events', async () => {
    const event = makeEvent();
    await testDb.events.add(event);

    const data = await buildExportData(testDb, {}, '0.21.0');
    const json = serializeExportData(data);
    const restored = deserializeExportData(json);

    expect(restored.tables.events[0].detectedAt).toBeInstanceOf(Date);
  });
});

describe('validateExportFile', () => {
  function makeValidRaw(): Record<string, unknown> {
    return {
      meta: {
        exportedAt: '2026-01-15T10:00:00Z',
        extensionVersion: '0.21.0',
        schemaVersion: 4,
        format: 'cws-tracker-v1',
      },
      settings: {},
      tables: {
        projects: [],
        extensions: [],
        keywords: [],
        listing_snapshots: [],
        rank_snapshots: [],
        events: [],
        translation_snapshots: [],
        audit_cache: [],
        autocomplete_snapshots: [],
        autocomplete_keyword_suggestions: [],
      },
    };
  }

  it('passes for a valid file', () => {
    const result = validateExportFile(makeValidRaw());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails if not an object', () => {
    expect(validateExportFile(null).valid).toBe(false);
    expect(validateExportFile('string').valid).toBe(false);
    expect(validateExportFile(42).valid).toBe(false);
  });

  it('fails if meta is missing', () => {
    const raw = makeValidRaw();
    delete raw.meta;
    const result = validateExportFile(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing or invalid "meta" field');
  });

  it('fails if format is wrong', () => {
    const raw = makeValidRaw();
    (raw.meta as Record<string, unknown>).format = 'wrong-format';
    const result = validateExportFile(raw);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid format');
  });

  it('fails if tables field is missing', () => {
    const raw = makeValidRaw();
    delete raw.tables;
    const result = validateExportFile(raw);
    expect(result.valid).toBe(false);
  });

  it('fails if a table key is missing', () => {
    const raw = makeValidRaw();
    delete (raw.tables as Record<string, unknown>).projects;
    const result = validateExportFile(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing table "projects"');
  });

  it('fails if a table value is not an array', () => {
    const raw = makeValidRaw();
    (raw.tables as Record<string, unknown>).projects = 'not-array';
    const result = validateExportFile(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Table "projects" is not an array');
  });

  it('warns if schemaVersion is higher than current', () => {
    const raw = makeValidRaw();
    (raw.meta as Record<string, unknown>).schemaVersion = 99;
    const result = validateExportFile(raw);
    expect(result.valid).toBe(true); // Still valid, just a warning
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('newer');
  });

  it('reports record counts', () => {
    const raw = makeValidRaw();
    (raw.tables as Record<string, unknown[]>).projects = [{}, {}, {}];
    (raw.tables as Record<string, unknown[]>).keywords = [{}];
    const result = validateExportFile(raw);
    expect(result.counts.projects).toBe(3);
    expect(result.counts.keywords).toBe(1);
    expect(result.counts.extensions).toBe(0);
  });
});

describe('importData', () => {
  it('clears existing data and inserts new records', async () => {
    // Add pre-existing data
    await testDb.projects.add(makeProject({ name: 'Old Project' }));
    expect(await testDb.projects.count()).toBe(1);

    const importPayload: ExportData = {
      meta: {
        exportedAt: '2026-01-15T10:00:00Z',
        extensionVersion: '0.21.0',
        schemaVersion: 4,
        format: 'cws-tracker-v1',
      },
      settings: {},
      tables: {
        projects: [makeProject({ name: 'Imported 1' }), makeProject({ name: 'Imported 2' })],
        extensions: [],
        keywords: [],
        listing_snapshots: [],
        rank_snapshots: [],
        events: [],
        translation_snapshots: [],
        audit_cache: [],
        autocomplete_snapshots: [],
        autocomplete_keyword_suggestions: [],
      },
    };

    await importData(testDb, importPayload);

    const projects = await testDb.projects.toArray();
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.name).sort()).toEqual(['Imported 1', 'Imported 2']);
  });

  it('fires progress callback per table', async () => {
    const importPayload: ExportData = {
      meta: { exportedAt: '', extensionVersion: '', schemaVersion: 4, format: 'cws-tracker-v1' },
      settings: {},
      tables: {
        projects: [],
        extensions: [],
        keywords: [],
        listing_snapshots: [],
        rank_snapshots: [],
        events: [],
        translation_snapshots: [],
        audit_cache: [],
        autocomplete_snapshots: [],
        autocomplete_keyword_suggestions: [],
      },
    };

    const progressCalls: Array<{ table: string; done: number; total: number }> = [];
    await importData(testDb, importPayload, (p) => progressCalls.push({ ...p }));

    // 10 tables + final "done" = 11 calls
    expect(progressCalls).toHaveLength(11);
    expect(progressCalls[0].table).toBe('projects');
    expect(progressCalls[0].done).toBe(0);
    expect(progressCalls[0].total).toBe(10);
    expect(progressCalls[10].table).toBe('done');
    expect(progressCalls[10].done).toBe(10);
  });

  it('preserves IDs when present', async () => {
    const importPayload: ExportData = {
      meta: { exportedAt: '', extensionVersion: '', schemaVersion: 4, format: 'cws-tracker-v1' },
      settings: {},
      tables: {
        projects: [makeProject({ id: 42, name: 'With ID' })],
        extensions: [makeExtension({ id: 'custom-ext-id' })],
        keywords: [],
        listing_snapshots: [],
        rank_snapshots: [],
        events: [],
        translation_snapshots: [],
        audit_cache: [],
        autocomplete_snapshots: [],
        autocomplete_keyword_suggestions: [],
      },
    };

    await importData(testDb, importPayload);

    const project = await testDb.projects.get(42);
    expect(project).toBeDefined();
    expect(project!.name).toBe('With ID');

    const ext = await testDb.extensions.get('custom-ext-id');
    expect(ext).toBeDefined();
  });
});

describe('generateExportFilename', () => {
  it('returns correct format', () => {
    const filename = generateExportFilename();
    expect(filename).toMatch(/^cws-tracker-export-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe('full round-trip', () => {
  it('populate → export → clear → import → verify', async () => {
    // Populate
    const projectId = await testDb.projects.add(makeProject());
    await testDb.extensions.add(makeExtension());
    const keywordId = await testDb.keywords.add(makeKeyword());
    await testDb.listing_snapshots.add(makeListingSnapshot());
    await testDb.rank_snapshots.add(makeRankSnapshot({ keywordId }));
    await testDb.events.add(makeEvent());

    // Export
    const settings = makeSettings();
    const exportResult = await buildExportData(testDb, settings, '0.21.0');
    const json = serializeExportData(exportResult);

    // Clear all tables
    await testDb.projects.clear();
    await testDb.extensions.clear();
    await testDb.keywords.clear();
    await testDb.listing_snapshots.clear();
    await testDb.rank_snapshots.clear();
    await testDb.events.clear();

    // Verify cleared
    expect(await testDb.projects.count()).toBe(0);
    expect(await testDb.extensions.count()).toBe(0);

    // Import
    const restored = deserializeExportData(json);
    await importData(testDb, restored);

    // Verify restored
    const projects = await testDb.projects.toArray();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Test Project');
    expect(projects[0].createdAt).toBeInstanceOf(Date);

    const extensions = await testDb.extensions.toArray();
    expect(extensions).toHaveLength(1);
    expect(extensions[0].id).toBe('ext-own-123');
    expect(extensions[0].addedAt).toBeInstanceOf(Date);

    const keywords = await testDb.keywords.toArray();
    expect(keywords).toHaveLength(1);

    const listings = await testDb.listing_snapshots.toArray();
    expect(listings).toHaveLength(1);
    expect(listings[0].scannedAt).toBeInstanceOf(Date);
    expect(listings[0].rating).toBe(4.5);

    const ranks = await testDb.rank_snapshots.toArray();
    expect(ranks).toHaveLength(1);
    expect(ranks[0].position).toBe(5);

    const events = await testDb.events.toArray();
    expect(events).toHaveLength(1);
    expect(events[0].detectedAt).toBeInstanceOf(Date);
  });
});
