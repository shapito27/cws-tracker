/**
 * Collapsing multiple same-day samples into one value per day.
 *
 * Scanning more than once a day (see the `scansPerDay` setting) means a
 * `(date, entity)` pair can hold several snapshots. Every chart and table in
 * the app is built around one value per calendar day, and that is deliberate:
 * more samples exist to narrow *when a change happened*, not to make the trend
 * line noisier.
 *
 * The rule is **the last sample of the day wins**. It is the only rule that is
 * meaningful for listing metadata (a title is a state, not a measurement — the
 * day's value is where it ended up), and it keeps a multi-sample day directly
 * comparable with the single-sample history recorded before this existed. At
 * `scansPerDay: 1` every function here is a no-op.
 *
 * This module replaces five near-identical implementations that had drifted
 * apart, one of which picked an arbitrary sample because it omitted the
 * `scannedAt` tiebreak.
 */

/** Minimum shape needed to place a snapshot in time. */
export interface DatedSample {
  date: string;
  scannedAt: Date;
}

/** All samples recorded for one calendar day, plus the day's chosen value. */
export interface DayRollup<T> {
  date: string;
  /** The day's representative value: the LAST sample taken. */
  value: T;
  /** Every sample for the day, ascending by `scannedAt`. */
  samples: T[];
  /** `samples.length`. 1 for every day recorded before multi-sampling. */
  count: number;
}

/**
 * Group snapshots by date, newest-sample-wins, ascending by date.
 *
 * Ties on `scannedAt` fall back to insertion order, which for Dexie reads means
 * ascending `id` — i.e. the later-written row.
 */
export function rollupByDate<T extends DatedSample>(snapshots: readonly T[]): DayRollup<T>[] {
  const byDate = new Map<string, T[]>();
  for (const snap of snapshots) {
    const existing = byDate.get(snap.date);
    if (existing) existing.push(snap);
    else byDate.set(snap.date, [snap]);
  }

  const out: DayRollup<T>[] = [];
  for (const [date, samples] of byDate) {
    const sorted = [...samples].sort(
      (a, b) => a.scannedAt.getTime() - b.scannedAt.getTime()
    );
    out.push({
      date,
      value: sorted[sorted.length - 1],
      samples: sorted,
      count: sorted.length,
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * Reduce to one snapshot per day, keeping the latest `scannedAt`.
 *
 * The plain form of `rollupByDate` for callers that only want the value.
 */
export function pickLatestPerDate<T extends DatedSample>(snapshots: readonly T[]): T[] {
  return rollupByDate(snapshots).map((day) => day.value);
}

// ---------------------------------------------------------------------------
// Per-day statistics
// ---------------------------------------------------------------------------

/** Minimum shape needed to compute a position spread. */
export interface PositionedSample {
  position: number | null;
}

/**
 * What a day's samples looked like, for the intraday view.
 *
 * Positions are ranks, so **lower is better**: `best` is the smallest number.
 * `null` positions ("not in top 30") are excluded from best/worst/spread but
 * still counted — a day that went 5 → off-list → 7 had 3 samples and a spread
 * of 2 among the ones that placed.
 */
export interface PositionStats {
  /** The day's rolled-up value — what the daily view shows. */
  last: number | null;
  /** Lowest (best) position number seen, or `null` if it never placed. */
  best: number | null;
  /** Highest (worst) position number seen, or `null` if it never placed. */
  worst: number | null;
  /** `worst - best`, or `null` when fewer than 2 samples placed. */
  spread: number | null;
  /** Total samples, including ones that did not place. */
  count: number;
  /**
   * Whether the samples actually disagreed.
   *
   * Gates every intraday marker and band in the UI. Without it, turning on the
   * intraday view would light up every day in the range including the many
   * where nothing moved, which buries the days that have something to say. A
   * day of 3 identical samples renders exactly like a 1-sample day.
   */
  varied: boolean;
}

/**
 * Summarize one day's samples. Expects them in `scannedAt` order, as returned
 * by `rollupByDate`.
 */
export function positionStats(samples: readonly PositionedSample[]): PositionStats {
  if (samples.length === 0) {
    return { last: null, best: null, worst: null, spread: null, count: 0, varied: false };
  }

  const placed = samples
    .map((s) => s.position)
    .filter((p): p is number => p !== null);

  const best = placed.length > 0 ? Math.min(...placed) : null;
  const worst = placed.length > 0 ? Math.max(...placed) : null;
  const spread = placed.length > 1 && best !== null && worst !== null ? worst - best : null;

  // Any disagreement counts, including a sample that dropped off the list
  // entirely while others placed — that is exactly the volatility worth seeing.
  const distinct = new Set(samples.map((s) => s.position));
  const varied = samples.length > 1 && distinct.size > 1;

  return {
    last: samples[samples.length - 1].position,
    best,
    worst,
    spread,
    count: samples.length,
    varied,
  };
}

/**
 * Compact cell label for a day: `"#7"` normally, `"#5–9"` when the day's
 * samples disagreed. `null` positions render as `outOfRange` ("30+" for search
 * rank, "—" for autocomplete).
 */
export function formatPositionCell(stats: PositionStats, outOfRange = '30+'): string {
  const fmt = (p: number | null): string => (p === null ? outOfRange : `#${p}`);
  if (!stats.varied || stats.best === null || stats.worst === null) {
    return fmt(stats.last);
  }
  if (stats.best === stats.worst) return fmt(stats.best);
  return `#${stats.best}–${stats.worst}`;
}

/**
 * One line per sample for a tooltip: `"06:14 #9, 14:02 #5, 21:47 #7"`.
 */
export function formatSampleList<T extends DatedSample & PositionedSample>(
  samples: readonly T[],
  outOfRange = '30+'
): string {
  return samples
    .map((s) => {
      const time = s.scannedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `${time} ${s.position === null ? outOfRange : `#${s.position}`}`;
    })
    .join(', ');
}
