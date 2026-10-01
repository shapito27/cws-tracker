/**
 * Date-range presets for history charts (Overview tab, competitor page).
 *
 * The charts plot one point per day, so even "all" stays cheap to render;
 * the range exists to keep the default view focused, not to protect the DB.
 */

import { daysAgo } from './dates';

export type ChartRange = '7' | '30' | '90' | '365' | 'all';

export const CHART_RANGES: readonly ChartRange[] = ['7', '30', '90', '365', 'all'];

export const DEFAULT_CHART_RANGE: ChartRange = '30';

/**
 * Lower bound (YYYY-MM-DD, inclusive) for a range's DB query.
 *
 * "all" returns a date earlier than any snapshot can carry, so the
 * compound-index `between` query becomes an open lower bound.
 */
export function chartRangeStartDate(range: ChartRange): string {
  if (range === 'all') return '0000-01-01';
  return daysAgo(Number(range));
}

/** Short button label: "30d", "All". */
export function chartRangeButtonLabel(range: ChartRange): string {
  return range === 'all' ? 'All' : `${range}d`;
}

/** Heading suffix: "Last 30 Days", "All Time". */
export function chartRangeTitle(range: ChartRange): string {
  return range === 'all' ? 'All Time' : `Last ${range} Days`;
}
