/**
 * Composable for ranking data and chart transformation.
 *
 * Loads rank snapshots from IndexedDB and transforms them into
 * ApexCharts series format for the RankChart component.
 */

import type { RankSnapshot, Extension, Keyword } from '@/shared/types';
import { db } from '@/shared/db/database';
import { daysAgo, today } from '@/shared/utils/dates';
import { deduplicateByDate } from '@/shared/utils/snapshot-dedup';

/** A single data point for ApexCharts. */
export interface ChartDataPoint {
  x: string; // date YYYY-MM-DD
  y: number | null; // position (null = not ranked)
}

/** One series in the chart (one line per extension). */
export interface RankChartSeries {
  name: string;
  extensionId: string;
  data: ChartDataPoint[];
}

/**
 * Load rank history for all extensions in a project for a given keyword,
 * and transform into ApexCharts series.
 */
export async function loadRankHistory(
  keywordId: number,
  extensions: Extension[],
  startDate: string,
  endDate: string
): Promise<RankChartSeries[]> {
  const series: RankChartSeries[] = [];

  for (const ext of extensions) {
    const snapshots = await db.getRankSnapshots(
      keywordId,
      ext.id,
      startDate,
      endDate
    );

    const data = transformSnapshots(snapshots);

    series.push({
      name: ext.name || ext.id,
      extensionId: ext.id,
      data,
    });
  }

  return series;
}

/**
 * Transform rank snapshots into chart data points.
 * Deduplicates by date (takes latest scannedAt per day) and sorts ascending.
 */
function transformSnapshots(snapshots: RankSnapshot[]): ChartDataPoint[] {
  const deduped = deduplicateByDate(snapshots);
  deduped.sort((a, b) => a.date.localeCompare(b.date));

  return deduped.map((s) => ({
    x: s.date,
    y: s.position,
  }));
}

/** Position delta info for a single extension. */
export interface RankDelta {
  current: number | null;
  previous: number | null;
  /** Positive = improved (moved up in rank), negative = dropped. null if no comparison possible. */
  delta: number | null;
}

/** Heatmap cell data for one keyword × extension intersection. */
export interface HeatmapCell {
  keywordId: number;
  extensionId: string;
  position: number | null;
  totalResults: number;
}

/** Coverage counts for an extension across all keywords. */
export interface CoverageData {
  extensionId: string;
  name: string;
  top3: number;
  top10: number;
  top20: number;
  top30: number;
}

/** Scatter point for keyword prioritization. */
export interface ScatterPoint {
  keywordId: number;
  keywordText: string;
  position: number | null;
  totalResults: number;
}

/**
 * Load latest rank snapshots for ALL keywords at once.
 * Returns a map: keywordId → RankSnapshot[].
 */
export async function loadAllKeywordLatestRanks(
  keywords: Keyword[]
): Promise<Map<number, RankSnapshot[]>> {
  const result = new Map<number, RankSnapshot[]>();
  const withId = keywords.filter((kw) => kw.id !== undefined);
  const ranksArray = await Promise.all(
    withId.map((kw) => db.getLatestRankForKeyword(kw.id!))
  );
  withId.forEach((kw, idx) => {
    result.set(kw.id!, ranksArray[idx]);
  });
  return result;
}

/**
 * Compute position deltas (current vs previous scan) for a keyword across extensions.
 */
export async function loadRankDeltas(
  keywordId: number,
  extensions: Extension[]
): Promise<Map<string, RankDelta>> {
  const result = new Map<string, RankDelta>();
  const startDate = daysAgo(90);
  const endDate = today();

  const snapshotsArray = await Promise.all(
    extensions.map((ext) => db.getRankSnapshots(keywordId, ext.id, startDate, endDate))
  );

  extensions.forEach((ext, idx) => {
    const sorted = deduplicateByDate(snapshotsArray[idx])
      .sort((a, b) => b.date.localeCompare(a.date));

    const current = sorted.length > 0 ? sorted[0].position : null;
    const previous = sorted.length > 1 ? sorted[1].position : null;

    let delta: number | null = null;
    if (current !== null && previous !== null) {
      delta = previous - current; // positive = improved (lower position number = better)
    }

    result.set(ext.id, { current, previous, delta });
  });

  return result;
}

/**
 * Build heatmap data from all-keyword latest ranks.
 */
export function buildHeatmapData(
  allRanks: Map<number, RankSnapshot[]>
): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (const [keywordId, snapshots] of allRanks) {
    for (const snap of snapshots) {
      cells.push({
        keywordId,
        extensionId: snap.extensionId,
        position: snap.position,
        totalResults: snap.totalResults,
      });
    }
  }
  return cells;
}

/**
 * Compute keyword coverage per extension from heatmap data.
 */
export function buildCoverageData(
  cells: HeatmapCell[],
  extensions: Extension[]
): CoverageData[] {
  const counts = new Map<string, { top3: number; top10: number; top20: number; top30: number }>();

  for (const ext of extensions) {
    counts.set(ext.id, { top3: 0, top10: 0, top20: 0, top30: 0 });
  }

  for (const cell of cells) {
    const c = counts.get(cell.extensionId);
    if (!c || cell.position === null) continue;
    if (cell.position <= 3) c.top3++;
    if (cell.position <= 10) c.top10++;
    if (cell.position <= 20) c.top20++;
    if (cell.position <= 30) c.top30++;
  }

  return extensions.map((ext) => {
    const c = counts.get(ext.id) ?? { top3: 0, top10: 0, top20: 0, top30: 0 };
    return {
      extensionId: ext.id,
      name: ext.name || ext.id,
      ...c,
    };
  });
}

/**
 * Load rank history for ALL keywords for a single extension (the user's own).
 * Returns one series per keyword, suitable for showing on the overview tab.
 */
export async function loadOwnExtensionRankHistory(
  keywords: Keyword[],
  ownExtensionId: string,
  startDate: string,
  endDate: string
): Promise<RankChartSeries[]> {
  const withId = keywords.filter((kw) => kw.id !== undefined);

  const snapshotsArray = await Promise.all(
    withId.map((kw) =>
      db.getRankSnapshots(kw.id!, ownExtensionId, startDate, endDate)
    )
  );

  const series: RankChartSeries[] = [];
  withId.forEach((kw, idx) => {
    const data = transformSnapshots(snapshotsArray[idx]);
    if (data.length === 0) return;

    series.push({
      name: kw.text,
      extensionId: ownExtensionId,
      data,
    });
  });

  return series;
}

/**
 * Build scatter plot data for keyword prioritization (own extension only).
 */
export function buildScatterData(
  allRanks: Map<number, RankSnapshot[]>,
  keywords: Keyword[],
  ownExtensionId: string
): ScatterPoint[] {
  const points: ScatterPoint[] = [];

  for (const kw of keywords) {
    if (kw.id === undefined) continue;
    const snapshots = allRanks.get(kw.id) ?? [];
    // Find own extension's snapshot or use the first for totalResults
    const ownSnap = snapshots.find((s) => s.extensionId === ownExtensionId);
    const anySnap = snapshots[0];

    points.push({
      keywordId: kw.id,
      keywordText: kw.text,
      position: ownSnap?.position ?? null,
      totalResults: ownSnap?.totalResults ?? anySnap?.totalResults ?? 0,
    });
  }

  return points;
}

/** A cell in the keyword position table for a single time period. */
export interface PositionPeriodCell {
  /** Change in position over this period. Positive = improved. null if no data. */
  delta: number | null;
}

/** One row in the keyword position table. */
export interface KeywordPositionRow {
  keywordId: number;
  keywordText: string;
  /** Latest position for this keyword. null = not in top 30. */
  currentPosition: number | null;
  /** Change vs previous day. Positive = improved. null if no comparison. */
  dailyDelta: number | null;
  periods: {
    '7d': PositionPeriodCell;
    '14d': PositionPeriodCell;
    '30d': PositionPeriodCell;
  };
}

/**
 * Load keyword position table data for the user's own extension.
 * For each keyword, returns current position, daily delta, and
 * deltas over 7d/14d/30d windows.
 */
export async function loadKeywordPositionTable(
  keywords: Keyword[],
  ownExtensionId: string
): Promise<KeywordPositionRow[]> {
  const withId = keywords.filter((kw) => kw.id !== undefined);
  const endDate = today();
  const startDate = daysAgo(31); // 31 days to ensure we have data for 30d comparison

  // Load all snapshots for the last 31 days for each keyword
  const snapshotsArray = await Promise.all(
    withId.map((kw) =>
      db.getRankSnapshots(kw.id!, ownExtensionId, startDate, endDate)
    )
  );

  const rows: KeywordPositionRow[] = [];

  withId.forEach((kw, idx) => {
    const sorted = deduplicateByDate(snapshotsArray[idx])
      .sort((a, b) => a.date.localeCompare(b.date));

    const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    const currentPosition = latest?.position ?? null;

    // Daily delta: compare last two data points
    let dailyDelta: number | null = null;
    if (sorted.length >= 2) {
      const prev = sorted[sorted.length - 2].position;
      const curr = sorted[sorted.length - 1].position;
      if (prev !== null && curr !== null) {
        dailyDelta = prev - curr; // positive = improved (lower rank number)
      }
    }

    // Compute delta for each period window
    function periodDelta(daysBack: number): PositionPeriodCell {
      const cutoff = daysAgo(daysBack);
      // Find the earliest snapshot at or after the cutoff
      const oldSnap = sorted.find((s) => s.date >= cutoff);
      if (!oldSnap || !latest) return { delta: null };
      if (oldSnap.position === null || currentPosition === null) return { delta: null };
      // If the old snap IS the latest, no meaningful delta
      if (oldSnap.date === latest.date && sorted.indexOf(oldSnap) === sorted.length - 1) {
        return { delta: null };
      }
      return { delta: oldSnap.position - currentPosition };
    }

    rows.push({
      keywordId: kw.id!,
      keywordText: kw.text,
      currentPosition,
      dailyDelta,
      periods: {
        '7d': periodDelta(7),
        '14d': periodDelta(14),
        '30d': periodDelta(30),
      },
    });
  });

  return rows;
}

export function useRankings() {
  return {
    loadRankHistory,
    loadOwnExtensionRankHistory,
    loadAllKeywordLatestRanks,
    loadRankDeltas,
    buildHeatmapData,
    buildCoverageData,
    buildScatterData,
    loadKeywordPositionTable,
  };
}
