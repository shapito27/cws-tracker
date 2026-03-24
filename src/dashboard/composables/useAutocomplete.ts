/**
 * Composable for autocomplete tracking data.
 *
 * Loads autocomplete snapshots from IndexedDB and transforms them
 * for display in the dashboard.
 */

import type {
  AutocompleteSnapshot,
  AutocompleteKeywordSuggestion,
  Extension,
  Keyword,
} from '@/shared/types';
import { db } from '@/shared/db/database';
import { daysAgo, today } from '@/shared/utils/dates';

/** Autocomplete position data for one extension on one keyword. */
export interface AutocompletePosition {
  keywordId: number;
  extensionId: string;
  /** 1-10 position in autocomplete, or null if not present. */
  position: number | null;
  /** Extension name as shown in autocomplete. */
  suggestedName: string | null;
}

/** A single data point for autocomplete position over time. */
export interface AutocompleteChartPoint {
  x: string; // date YYYY-MM-DD
  y: number | null; // position (null = not in autocomplete)
}

/** One series in autocomplete chart (one line per extension or per keyword). */
export interface AutocompleteChartSeries {
  name: string;
  extensionId: string;
  /**
   * Extension icon URL for the chart legend.
   * Present (string | null) for extension-per-line mode.
   * Absent (undefined) for keyword-per-line mode.
   * AutocompleteChart uses this to decide whether to render an ExtensionIcon.
   */
  iconUrl?: string | null;
  data: AutocompleteChartPoint[];
}

/**
 * Load the latest autocomplete positions for all tracked extensions
 * across a single keyword.
 */
export async function loadAutocompletePositions(
  keywordId: number,
  extensions: Extension[]
): Promise<AutocompletePosition[]> {
  const snapshots = await db.getLatestAutocompleteForKeyword(keywordId);

  const snapshotMap = new Map<string, AutocompleteSnapshot>();
  for (const snap of snapshots) {
    snapshotMap.set(snap.extensionId, snap);
  }

  return extensions.map((ext) => {
    const snap = snapshotMap.get(ext.id);
    return {
      keywordId,
      extensionId: ext.id,
      position: snap?.position ?? null,
      suggestedName: snap?.suggestedName ?? null,
    };
  });
}

/**
 * Load autocomplete position history for extensions on a keyword over time.
 */
export async function loadAutocompleteHistory(
  keywordId: number,
  extensions: Extension[],
  startDate: string,
  endDate: string
): Promise<AutocompleteChartSeries[]> {
  const series: AutocompleteChartSeries[] = [];

  for (const ext of extensions) {
    const snapshots = await db.getAutocompleteSnapshots(
      keywordId,
      ext.id,
      startDate,
      endDate
    );

    // Deduplicate by date (keep latest scannedAt per day)
    const byDate = new Map<string, AutocompleteSnapshot>();
    for (const snap of snapshots) {
      const existing = byDate.get(snap.date);
      if (!existing || snap.scannedAt > existing.scannedAt) {
        byDate.set(snap.date, snap);
      }
    }

    const sorted = [...byDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const data: AutocompleteChartPoint[] = sorted.map((s) => ({
      x: s.date,
      y: s.position,
    }));

    series.push({
      name: ext.name || ext.id,
      extensionId: ext.id,
      iconUrl: ext.iconUrl,
      data,
    });
  }

  return series;
}

/**
 * Load autocomplete position history for ALL keywords for a single extension
 * (the user's own). Returns one series per keyword.
 */
export async function loadOwnExtensionAutocompleteHistory(
  keywords: Keyword[],
  ownExtensionId: string,
  startDate: string,
  endDate: string
): Promise<AutocompleteChartSeries[]> {
  const withId = keywords.filter((kw) => kw.id !== undefined);

  const snapshotsArray = await Promise.all(
    withId.map((kw) =>
      db.getAutocompleteSnapshots(kw.id!, ownExtensionId, startDate, endDate)
    )
  );

  const series: AutocompleteChartSeries[] = [];
  withId.forEach((kw, idx) => {
    // Deduplicate by date
    const byDate = new Map<string, AutocompleteSnapshot>();
    for (const snap of snapshotsArray[idx]) {
      const existing = byDate.get(snap.date);
      if (!existing || snap.scannedAt > existing.scannedAt) {
        byDate.set(snap.date, snap);
      }
    }

    const sorted = [...byDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    if (sorted.length === 0) return;

    series.push({
      name: kw.text,
      extensionId: ownExtensionId,
      // iconUrl intentionally omitted: keyword-per-line mode shows no icon in legend
      data: sorted.map((s) => ({ x: s.date, y: s.position })),
    });
  });

  return series;
}

/**
 * Load text suggestions for keyword discovery.
 */
export async function loadKeywordSuggestions(
  keywordId: number,
  rangeDays: number = 7
): Promise<AutocompleteKeywordSuggestion[]> {
  const startDate = daysAgo(rangeDays);
  const endDate = today();
  return db.getAutocompleteSuggestions(keywordId, startDate, endDate);
}

/** Summary of autocomplete presence across all keywords. */
export interface AutocompleteCoverageData {
  extensionId: string;
  name: string;
  iconUrl: string | null;
  /** Number of keywords where this extension appears in autocomplete. */
  appearsIn: number;
  /** Total keywords checked. */
  totalKeywords: number;
}

/**
 * Build autocomplete coverage data: how many keywords each extension appears in.
 */
export async function loadAutocompleteCoverage(
  keywords: Keyword[],
  extensions: Extension[]
): Promise<AutocompleteCoverageData[]> {
  const withId = keywords.filter((kw) => kw.id !== undefined);

  const allSnapshotsArray = await Promise.all(
    withId.map((kw) => db.getLatestAutocompleteForKeyword(kw.id!))
  );

  // Count per extension
  const counts = new Map<string, number>();
  for (const ext of extensions) {
    counts.set(ext.id, 0);
  }

  for (const snapshots of allSnapshotsArray) {
    for (const snap of snapshots) {
      if (snap.position !== null && counts.has(snap.extensionId)) {
        counts.set(snap.extensionId, (counts.get(snap.extensionId) ?? 0) + 1);
      }
    }
  }

  return extensions.map((ext) => ({
    extensionId: ext.id,
    name: ext.name || ext.id,
    iconUrl: ext.iconUrl,
    appearsIn: counts.get(ext.id) ?? 0,
    totalKeywords: withId.length,
  }));
}

export function useAutocomplete() {
  return {
    loadAutocompletePositions,
    loadAutocompleteHistory,
    loadOwnExtensionAutocompleteHistory,
    loadKeywordSuggestions,
    loadAutocompleteCoverage,
  };
}
