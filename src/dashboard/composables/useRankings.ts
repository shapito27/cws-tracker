/**
 * Composable for ranking data and chart transformation.
 *
 * Loads rank snapshots from IndexedDB and transforms them into
 * ApexCharts series format for the RankChart component.
 */

import type { RankSnapshot, Extension } from '@/shared/types';
import { db } from '@/shared/db/database';

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

export function useRankings() {
  return {
    loadRankHistory,
  };
}
