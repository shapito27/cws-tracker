/**
 * Tests for the useTranslationAudit composable (Phase 3.6.3).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import {
  buildAuditReport,
  sortBreakdown,
  trickFinding,
  estimateAuditDurationMs,
  formatDuration,
  serializeAuditReport,
  auditExportFilename,
  loadAuditDates,
  loadAuditReport,
  loadAuditSummaries,
} from '@/dashboard/composables/useTranslationAudit';
import { emptyManipulationFlags } from '@/shared/utils/translation-checks';
import type { Extension, ManipulationFlags, TranslationSnapshot } from '@/shared/types';

const EXT = 'extaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EXT_B = 'extbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1';

function makeExtension(over: Partial<Extension> = {}): Extension {
  return {
    id: EXT, name: 'My Ext', iconUrl: null, addedAt: new Date(),
    lastScannedAt: null, status: 'active', projectRefs: [1], ...over,
  };
}

function makeSnapshot(over: Partial<TranslationSnapshot> = {}): TranslationSnapshot {
  return {
    extensionId: EXT,
    locale: 'en',
    date: '2026-09-02',
    title: 'My Ext',
    shortDescription: 'Short',
    fullDescription: 'Full description text',
    descriptionLength: 21,
    detectedLanguage: 'en',
    manipulationFlags: emptyManipulationFlags(),
    scannedAt: new Date('2026-09-02T10:00:00Z'),
    ...over,
  };
}

function flaggedFlags(): ManipulationFlags {
  const f = emptyManipulationFlags();
  f.keywordsAtEnd = { detected: true, excerpt: 'kw1\nkw2\nkw3\nkw4\nkw5' };
  f.competitorNames = { detected: true, matches: ['Rival'] };
  f.untranslatedEnglish = { detected: true, englishRatio: 0.93 };
  return f;
}

describe('buildAuditReport', () => {
  it('aggregates scores, flagged locales and the per-trick breakdown', () => {
    const report = buildAuditReport(EXT, 'My Ext', '2026-09-02', [
      makeSnapshot({ locale: 'ja', manipulationFlags: flaggedFlags() }),
      makeSnapshot({ locale: 'en' }),
      makeSnapshot({ locale: 'es' }),
    ]);

    expect(report.localeCount).toBe(3);
    expect(report.flaggedLocaleCount).toBe(1);
    expect(report.baselineLocale).toBe('en');
    // Sorted by locale code.
    expect(report.locales.map((l) => l.locale)).toEqual(['en', 'es', 'ja']);
    // ja: keywordsAtEnd 20 + competitorNames 20 + untranslated 5 = 45.
    expect(report.locales[2].score).toBe(45);
    expect(report.locales[2].tricks).toEqual(['competitorNames', 'keywordsAtEnd', 'untranslatedEnglish']);
    expect(report.score).toBe(45);
    expect(report.label).toBe('high');

    expect(report.breakdown).toHaveLength(8);
    const kw = report.breakdown.find((b) => b.key === 'keywordsAtEnd')!;
    expect(kw.severity).toBe('high');
    expect(kw.findings).toEqual([{ locale: 'ja', detail: null, excerpt: 'kw1\nkw2\nkw3\nkw4\nkw5' }]);
    const comp = report.breakdown.find((b) => b.key === 'competitorNames')!;
    expect(comp.findings[0].detail).toBe('Mentions Rival');
    const clean = report.breakdown.find((b) => b.key === 'differentName')!;
    expect(clean.findings).toEqual([]);
  });

  it('locales served the default listing are counted as fallback and never flagged', () => {
    const report = buildAuditReport(EXT, 'My Ext', '2026-09-02', [
      makeSnapshot({ locale: 'en' }),
      makeSnapshot({ locale: 'ru', isLocalized: false }),
      makeSnapshot({ locale: 'ja', manipulationFlags: flaggedFlags() }),
    ]);
    expect(report.localeCount).toBe(3);
    expect(report.fallbackLocaleCount).toBe(1);
    expect(report.flaggedLocaleCount).toBe(1);
    expect(report.locales.find((l) => l.locale === 'ru')?.localized).toBe(false);
    expect(report.locales.find((l) => l.locale === 'en')?.localized).toBe(true);
    const parsed = JSON.parse(serializeAuditReport(report)) as { fallbackLocaleCount: number; locales: Array<{ locale: string; localized: boolean }> };
    expect(parsed.fallbackLocaleCount).toBe(1);
    expect(parsed.locales.find((l) => l.locale === 'ru')?.localized).toBe(false);
  });

  it('clean snapshots give a zero score and a clean label', () => {
    const report = buildAuditReport(EXT, 'My Ext', '2026-09-02', [makeSnapshot({ locale: 'es' })]);
    expect(report.score).toBe(0);
    expect(report.label).toBe('clean');
    expect(report.flaggedLocaleCount).toBe(0);
    expect(report.baselineLocale).toBeNull();
  });

  it('empty snapshot list gives an empty report', () => {
    const report = buildAuditReport(EXT, 'My Ext', '2026-09-02', []);
    expect(report.localeCount).toBe(0);
    expect(report.locales).toEqual([]);
    expect(report.score).toBe(0);
  });
});

describe('trickFinding', () => {
  it('prefers the flag details and falls back to a metric', () => {
    const f = emptyManipulationFlags();
    f.differentName = { detected: true, similarity: 0.25, details: 'Title differs' };
    expect(trickFinding('es', f, 'differentName').detail).toBe('Title differs');
    f.differentShortDesc = { detected: true, similarity: 0.4 };
    expect(trickFinding('es', f, 'differentShortDesc').detail).toBe('Similarity 40%');
    f.extendedDescription = { detected: true, ratio: 3.2 };
    expect(trickFinding('es', f, 'extendedDescription').detail).toBe('3.2x the median length');
    f.differentDescription = { detected: true, similarity: 0.05 };
    expect(trickFinding('es', f, 'differentDescription').detail).toBe('Term overlap 5%');
    f.keywordsInline = { detected: true, excerpt: 'a, b, c' };
    expect(trickFinding('es', f, 'keywordsInline')).toEqual({ locale: 'es', detail: null, excerpt: 'a, b, c' });
    f.keywordsInline = { detected: true, excerpt: 'a, b, c', details: '5 comma-separated short phrases in one line' };
    expect(trickFinding('es', f, 'keywordsInline').detail).toBe('5 comma-separated short phrases in one line');
    f.keywordsAtEnd = { detected: true, excerpt: 'k1\nk2', details: '5 short lines after a 4-newline gap' };
    expect(trickFinding('es', f, 'keywordsAtEnd')).toEqual({
      locale: 'es', detail: '5 short lines after a 4-newline gap', excerpt: 'k1\nk2',
    });
    f.untranslatedEnglish = { detected: true, englishRatio: 0.8 };
    expect(trickFinding('es', f, 'untranslatedEnglish').detail).toBe('80% of the text reads as English');
  });
});

describe('sortBreakdown', () => {
  it('puts detected tricks first, high severity before medium', () => {
    const report = buildAuditReport(EXT, 'My Ext', '2026-09-02', [
      makeSnapshot({ locale: 'ja', manipulationFlags: flaggedFlags() }),
    ]);
    const sorted = sortBreakdown(report.breakdown);
    expect(sorted.slice(0, 3).map((b) => b.key)).toEqual(['competitorNames', 'keywordsAtEnd', 'untranslatedEnglish']);
    expect(sorted.slice(3).every((b) => b.findings.length === 0)).toBe(true);
  });
});

describe('estimates and formatting', () => {
  it('estimateAuditDurationMs is the alarm floor plus one delay per further job', () => {
    expect(estimateAuditDurationMs(0, 60_000)).toBe(0);
    expect(estimateAuditDurationMs(1, 60_000)).toBe(60_000);
    expect(estimateAuditDurationMs(10, 60_000)).toBe(60_000 + 9 * 60_000);
  });

  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('under a minute');
    expect(formatDuration(60_000)).toBe('about 1 minute');
    expect(formatDuration(12 * 60_000)).toBe('about 12 minutes');
    expect(formatDuration(150 * 60_000)).toBe('about 2.5 hours');
    expect(formatDuration(60 * 60_000)).toBe('about 1 hour');
  });

  it('serializeAuditReport produces self-contained JSON with only detected tricks in the breakdown', () => {
    const report = buildAuditReport(EXT, 'My Ext', '2026-09-02', [
      makeSnapshot({ locale: 'ja', manipulationFlags: flaggedFlags() }),
      makeSnapshot({ locale: 'en' }),
    ]);
    const parsed = JSON.parse(serializeAuditReport(report)) as {
      extensionId: string; auditDate: string; manipulationScore: number;
      breakdown: Array<{ trick: string }>; locales: Array<{ locale: string; fullDescription: string; scannedAt: string }>;
    };
    expect(parsed.extensionId).toBe(EXT);
    expect(parsed.auditDate).toBe('2026-09-02');
    expect(parsed.manipulationScore).toBe(45);
    expect(parsed.breakdown.map((b) => b.trick)).toEqual(['competitorNames', 'keywordsAtEnd', 'untranslatedEnglish']);
    expect(parsed.locales).toHaveLength(2);
    expect(parsed.locales[1].fullDescription).toBe('Full description text');
    expect(parsed.locales[1].scannedAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('auditExportFilename is filesystem-safe', () => {
    const report = buildAuditReport(EXT, 'My Ext: The Best!', '2026-09-02', []);
    expect(auditExportFilename(report)).toBe('translation-audit-my-ext-the-best-2026-09-02.json');
    const anon = buildAuditReport(EXT, '***', '2026-09-02', []);
    expect(auditExportFilename(anon)).toBe(`translation-audit-${EXT}-2026-09-02.json`);
  });
});

describe('loaders', () => {
  beforeEach(async () => {
    await db.translation_snapshots.clear();
    await db.extensions.clear();
  });

  it('loadAuditReport returns null when nothing was captured', async () => {
    expect(await loadAuditReport(EXT)).toBeNull();
    expect(await loadAuditDates(EXT)).toEqual([]);
  });

  it('loadAuditReport defaults to the latest date and uses the extension name', async () => {
    await db.extensions.put(makeExtension());
    await db.translation_snapshots.bulkAdd([
      makeSnapshot({ date: '2026-08-01', locale: 'es' }),
      makeSnapshot({ date: '2026-09-02', locale: 'es' }),
      makeSnapshot({ date: '2026-09-02', locale: 'ja', manipulationFlags: flaggedFlags() }),
    ]);

    const latest = await loadAuditReport(EXT);
    expect(latest?.date).toBe('2026-09-02');
    expect(latest?.extensionName).toBe('My Ext');
    expect(latest?.localeCount).toBe(2);
    expect(latest?.score).toBe(45);

    const older = await loadAuditReport(EXT, '2026-08-01');
    expect(older?.localeCount).toBe(1);
    expect(older?.score).toBe(0);

    expect(await loadAuditDates(EXT)).toEqual(['2026-09-02', '2026-08-01']);
  });

  it('loadAuditSummaries covers every extension, audited or not', async () => {
    await db.extensions.bulkPut([makeExtension(), makeExtension({ id: EXT_B, name: 'Rival' })]);
    await db.translation_snapshots.add(makeSnapshot({ locale: 'ja', manipulationFlags: flaggedFlags() }));

    const summaries = await loadAuditSummaries([makeExtension(), makeExtension({ id: EXT_B, name: 'Rival' })]);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ extensionId: EXT, extensionName: 'My Ext', date: '2026-09-02', score: 45, label: 'high', localeCount: 1, flaggedLocaleCount: 1 });
    expect(summaries[1]).toMatchObject({ extensionId: EXT_B, extensionName: 'Rival', date: null, score: null, label: null, localeCount: 0, flaggedLocaleCount: 0 });
  });
});
