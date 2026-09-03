/**
 * Composable for translation audits in the dashboard (PRD 5.3.6).
 *
 * Pure async loaders reading `translation_snapshots` from the db (matching the
 * useReviews / useAutocomplete style), plus a pure report builder so the
 * numbers shown in the Translations tab are unit-testable without Vue.
 *
 * Flags are computed by the service worker as each locale lands; this module
 * only aggregates them into scores and a per-trick breakdown.
 */

import { db } from '@/shared/db/database';
import type { Extension, ManipulationFlags, TranslationSnapshot } from '@/shared/types';
import {
  ALL_TRICKS,
  TRICK_LABELS,
  TRICK_SEVERITY,
  computeManipulationScore,
  computeOverallScore,
  detectedTricks,
  scoreLabel,
  type TrickKey,
  type TrickSeverity,
} from '@/shared/utils/translation-checks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScoreLabel = ReturnType<typeof scoreLabel>;

/** One locale's row in a report. */
export interface LocaleReport {
  locale: string;
  snapshot: TranslationSnapshot;
  /**
   * False when the extension does not ship this locale, so the store served
   * the default listing. Such rows are not audited (flags stay empty).
   */
  localized: boolean;
  /** 0-100 for this locale alone. */
  score: number;
  /** Tricks detected for this locale, canonical order. */
  tricks: TrickKey[];
}

/** What one trick found, per locale. */
export interface TrickFinding {
  locale: string;
  /** Human-readable explanation (from the flag's `details`), if any. */
  detail: string | null;
  /** The flagged text itself (keyword blocks), if any. */
  excerpt: string | null;
}

/** One trick's row in the breakdown. */
export interface TrickBreakdown {
  key: TrickKey;
  label: string;
  severity: TrickSeverity;
  findings: TrickFinding[];
}

/** A full audit report for one extension on one date. */
export interface TranslationAuditReport {
  extensionId: string;
  extensionName: string;
  date: string;
  /** 0-100 across all locales (see computeOverallScore). */
  score: number;
  label: ScoreLabel;
  localeCount: number;
  flaggedLocaleCount: number;
  /** Locales served the default listing because the extension does not ship them. */
  fallbackLocaleCount: number;
  /** Which locale served as the English baseline, if one was captured. */
  baselineLocale: string | null;
  locales: LocaleReport[];
  /** Every trick, including those with no findings, in canonical order. */
  breakdown: TrickBreakdown[];
}

/** Per-extension summary card data. */
export interface AuditSummary {
  extensionId: string;
  extensionName: string;
  iconUrl: string | null;
  /** Most recent audit date, or null when never audited. */
  date: string | null;
  score: number | null;
  label: ScoreLabel | null;
  localeCount: number;
  flaggedLocaleCount: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** What a flag has to say for itself, shaped for display. */
export function trickFinding(locale: string, flags: ManipulationFlags, key: TrickKey): TrickFinding {
  switch (key) {
    case 'differentName':
    case 'differentShortDesc': {
      const f = flags[key];
      return {
        locale,
        detail: f.details ?? `Similarity ${Math.round(f.similarity * 100)}%`,
        excerpt: null,
      };
    }
    case 'differentDescription': {
      const f = flags.differentDescription;
      return {
        locale,
        detail: f.details ?? `Term overlap ${Math.round(f.similarity * 100)}%`,
        excerpt: null,
      };
    }
    case 'extendedDescription': {
      const f = flags.extendedDescription;
      return {
        locale,
        detail: f.details ?? `${f.ratio.toFixed(1)}x the median length`,
        excerpt: null,
      };
    }
    case 'competitorNames':
      return {
        locale,
        detail: flags.competitorNames.matches.length > 0
          ? `Mentions ${flags.competitorNames.matches.join(', ')}`
          : null,
        excerpt: null,
      };
    case 'keywordsAtEnd':
      return {
        locale,
        detail: flags.keywordsAtEnd.details ?? null,
        excerpt: flags.keywordsAtEnd.excerpt ?? null,
      };
    case 'keywordsInline':
      return {
        locale,
        detail: flags.keywordsInline.details ?? null,
        excerpt: flags.keywordsInline.excerpt ?? null,
      };
    case 'untranslatedEnglish':
      return {
        locale,
        detail: `${Math.round(flags.untranslatedEnglish.englishRatio * 100)}% of the text reads as English`,
        excerpt: null,
      };
    default:
      return { locale, detail: null, excerpt: null };
  }
}

/**
 * Build a report from one extension's snapshots for one date.
 *
 * Pure: the shape the Translations tab renders, computed from stored rows.
 */
export function buildAuditReport(
  extensionId: string,
  extensionName: string,
  date: string,
  snapshots: TranslationSnapshot[]
): TranslationAuditReport {
  const sorted = [...snapshots].sort((a, b) => a.locale.localeCompare(b.locale));
  const locales: LocaleReport[] = sorted.map((s) => ({
    locale: s.locale,
    snapshot: s,
    localized: s.isLocalized !== false,
    score: computeManipulationScore(s.manipulationFlags),
    tricks: detectedTricks(s.manipulationFlags),
  }));

  const breakdown: TrickBreakdown[] = ALL_TRICKS.map((key) => ({
    key,
    label: TRICK_LABELS[key],
    severity: TRICK_SEVERITY[key],
    findings: locales
      .filter((l) => l.snapshot.manipulationFlags[key].detected)
      .map((l) => trickFinding(l.locale, l.snapshot.manipulationFlags, key)),
  }));

  const score = computeOverallScore(locales.map((l) => l.score));
  const baseline = sorted.find((s) => s.locale.toLowerCase().split(/[_-]/)[0] === 'en');

  return {
    extensionId,
    extensionName,
    date,
    score,
    label: scoreLabel(score),
    localeCount: locales.length,
    flaggedLocaleCount: locales.filter((l) => l.tricks.length > 0).length,
    fallbackLocaleCount: locales.filter((l) => !l.localized).length,
    baselineLocale: baseline?.locale ?? null,
    locales,
    breakdown,
  };
}

/** Sort tricks with findings first, by severity (high > medium > low), then canonical order. */
export function sortBreakdown(breakdown: TrickBreakdown[]): TrickBreakdown[] {
  const rank: Record<TrickSeverity, number> = { high: 0, medium: 1, low: 2 };
  return [...breakdown].sort((a, b) => {
    const aHas = a.findings.length > 0 ? 0 : 1;
    const bHas = b.findings.length > 0 ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return ALL_TRICKS.indexOf(a.key) - ALL_TRICKS.indexOf(b.key);
  });
}

/**
 * Rough wall-clock estimate for an audit: one CWS request per job at the
 * configured base delay. Jitter averages out; the first job waits for the
 * 1-minute alarm floor.
 */
export function estimateAuditDurationMs(jobCount: number, queueDelayMs: number): number {
  if (jobCount <= 0) return 0;
  return 60_000 + Math.max(0, jobCount - 1) * queueDelayMs;
}

/** "about 2 hours", "about 12 minutes", "under a minute". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * JSON export of a report, for evidence / reporting (PRD 5.3.6). Includes the
 * captured texts so the file stands on its own.
 */
export function serializeAuditReport(report: TranslationAuditReport): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    extensionId: report.extensionId,
    extensionName: report.extensionName,
    auditDate: report.date,
    manipulationScore: report.score,
    scoreLabel: report.label,
    localeCount: report.localeCount,
    flaggedLocaleCount: report.flaggedLocaleCount,
    fallbackLocaleCount: report.fallbackLocaleCount,
    baselineLocale: report.baselineLocale,
    breakdown: report.breakdown
      .filter((b) => b.findings.length > 0)
      .map((b) => ({ trick: b.key, label: b.label, severity: b.severity, findings: b.findings })),
    locales: report.locales.map((l) => ({
      locale: l.locale,
      localized: l.localized,
      score: l.score,
      detectedTricks: l.tricks,
      detectedLanguage: l.snapshot.detectedLanguage,
      title: l.snapshot.title,
      shortDescription: l.snapshot.shortDescription,
      fullDescription: l.snapshot.fullDescription,
      descriptionLength: l.snapshot.descriptionLength,
      scannedAt: l.snapshot.scannedAt instanceof Date ? l.snapshot.scannedAt.toISOString() : l.snapshot.scannedAt,
      flags: l.snapshot.manipulationFlags,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/** File name for an exported report. */
export function auditExportFilename(report: TranslationAuditReport): string {
  const safe = report.extensionName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || report.extensionId;
  return `translation-audit-${safe}-${report.date}.json`;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** Distinct audit dates for an extension, newest first. */
export async function loadAuditDates(extensionId: string): Promise<string[]> {
  return db.getTranslationAuditDates(extensionId);
}

/**
 * The report for an extension on a date (defaults to the latest audit), or
 * `null` when no audit has been captured.
 */
export async function loadAuditReport(
  extensionId: string,
  date?: string
): Promise<TranslationAuditReport | null> {
  const targetDate = date ?? (await db.getLatestTranslationAuditDate(extensionId));
  if (!targetDate) return null;
  const [snapshots, ext] = await Promise.all([
    db.getTranslationSnapshots(extensionId, targetDate),
    db.getExtension(extensionId),
  ]);
  if (snapshots.length === 0) return null;
  return buildAuditReport(extensionId, ext?.name || extensionId, targetDate, snapshots);
}

/** Latest-audit summary for each extension, in the order given. */
export async function loadAuditSummaries(extensions: Extension[]): Promise<AuditSummary[]> {
  const out: AuditSummary[] = [];
  for (const ext of extensions) {
    const report = await loadAuditReport(ext.id);
    out.push({
      extensionId: ext.id,
      extensionName: ext.name || ext.id,
      iconUrl: ext.iconUrl,
      date: report?.date ?? null,
      score: report?.score ?? null,
      label: report?.label ?? null,
      localeCount: report?.localeCount ?? 0,
      flaggedLocaleCount: report?.flaggedLocaleCount ?? 0,
    });
  }
  return out;
}

/** Trigger a browser download of the report as JSON. Dashboard context only. */
export function downloadAuditReport(report: TranslationAuditReport): void {
  const blob = new Blob([serializeAuditReport(report)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = auditExportFilename(report);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
