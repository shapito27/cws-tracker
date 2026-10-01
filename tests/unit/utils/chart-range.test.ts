import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CHART_RANGES,
  DEFAULT_CHART_RANGE,
  chartRangeButtonLabel,
  chartRangeStartDate,
  chartRangeTitle,
} from '@/shared/utils/chart-range';

describe('chart-range', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to 30 days, matching the previous fixed window', () => {
    expect(DEFAULT_CHART_RANGE).toBe('30');
    expect(CHART_RANGES).toContain(DEFAULT_CHART_RANGE);
  });

  it('computes the start date N days back for numeric ranges', () => {
    expect(chartRangeStartDate('7')).toBe('2026-09-23');
    expect(chartRangeStartDate('30')).toBe('2026-08-31');
    expect(chartRangeStartDate('90')).toBe('2026-07-02');
    expect(chartRangeStartDate('365')).toBe('2025-09-30');
  });

  it('uses an open lower bound for "all" that sorts before any real date', () => {
    const start = chartRangeStartDate('all');
    expect(start < '1970-01-01').toBe(true);
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('labels buttons and headings', () => {
    expect(chartRangeButtonLabel('90')).toBe('90d');
    expect(chartRangeButtonLabel('all')).toBe('All');
    expect(chartRangeTitle('30')).toBe('Last 30 Days');
    expect(chartRangeTitle('all')).toBe('All Time');
  });
});
