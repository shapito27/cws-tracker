/**
 * Composable for ranking data and chart transformation.
 *
 * Loads rank snapshots from IndexedDB and transforms them into
 * ApexCharts series format for the RankChart component.
 */

import type { RankSnapshot, Extension, Keyword } from '@/shared/types';
import { db } from '@/shared/db/database';
import { daysAgo, today } from '@/shared/utils/dates';

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
 * Sorted by date ascending.
 */
function transformSnapshots(snapshots: RankSnapshot[]): ChartDataPoint[] {
  // Sort by date ascending
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map((s) => ({
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
  for (const kw of keywords) {
    if (kw.id !== undefined) {
      const ranks = await db.getLatestRankForKeyword(kw.id);
      result.set(kw.id, ranks);
    }
  }
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

  for (const ext of extensions) {
    const snapshots = await db.getRankSnapshots(keywordId, ext.id, startDate, endDate);
    const sorted = [...snapshots].sort((a, b) => b.date.localeCompare(a.date));

    const current = sorted.length > 0 ? sorted[0].position : null;
    const previous = sorted.length > 1 ? sorted[1].position : null;

    let delta: number | null = null;
    if (current !== null && previous !== null) {
      delta = previous - current; // positive = improved (lower position number = better)
    }

    result.set(ext.id, { current, previous, delta });
  }

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

export function useRankings() {
  return {
    loadRankHistory,
    loadAllKeywordLatestRanks,
    loadRankDeltas,
    buildHeatmapData,
    buildCoverageData,
    buildScatterData,
  };
}
