/**
 * Tests for date utilities (Phase 1.5.3).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  today,
  daysAgo,
  isToday,
  daysBetween,
} from '../../../src/shared/utils/dates';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as YYYY-MM-DD for comparison. */
function formatYMD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// today()
// ---------------------------------------------------------------------------

describe('today()', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = today();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the current date', () => {
    const expected = formatYMD(new Date());
    expect(today()).toBe(expected);
  });

  it('returns correct date for a known fixed time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T10:30:00'));
    expect(today()).toBe('2026-03-15');
  });
});

// ---------------------------------------------------------------------------
// daysAgo()
// ---------------------------------------------------------------------------

describe('daysAgo()', () => {
  it('daysAgo(0) equals today()', () => {
    expect(daysAgo(0)).toBe(today());
  });

  it('daysAgo(1) returns yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-05T12:00:00'));
    expect(daysAgo(1)).toBe('2026-02-04');
  });

  it('handles month boundary correctly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00'));
    expect(daysAgo(1)).toBe('2026-02-28');
  });

  it('handles year boundary correctly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00'));
    expect(daysAgo(1)).toBe('2025-12-31');
  });

  it('handles large values (365 days ago)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00'));
    expect(daysAgo(365)).toBe('2025-06-15');
  });
});

// ---------------------------------------------------------------------------
// isToday()
// ---------------------------------------------------------------------------

describe('isToday()', () => {
  it('returns true for today', () => {
    expect(isToday(today())).toBe(true);
  });

  it('returns false for yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-05T12:00:00'));
    expect(isToday('2026-02-04')).toBe(false);
  });

  it('returns false for tomorrow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-05T12:00:00'));
    expect(isToday('2026-02-06')).toBe(false);
  });

  it('returns false for a distant date', () => {
    expect(isToday('2020-01-01')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// daysBetween()
// ---------------------------------------------------------------------------

describe('daysBetween()', () => {
  it('returns 9 for Jan 1 to Jan 10', () => {
    expect(daysBetween('2026-01-01', '2026-01-10')).toBe(9);
  });

  it('returns 0 for same date', () => {
    expect(daysBetween('2026-05-15', '2026-05-15')).toBe(0);
  });

  it('is symmetric (order does not matter)', () => {
    expect(daysBetween('2026-01-01', '2026-01-10')).toBe(
      daysBetween('2026-01-10', '2026-01-01')
    );
  });

  it('works across month boundaries', () => {
    // Jan 28 to Feb 5 = 8 days
    expect(daysBetween('2026-01-28', '2026-02-05')).toBe(8);
  });

  it('works across year boundaries', () => {
    // Dec 30 to Jan 2 = 3 days
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3);
  });

  it('handles leap year', () => {
    // 2024 is a leap year: Feb 28 to Mar 1 = 2 days
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('handles non-leap year', () => {
    // 2026 is NOT a leap year: Feb 28 to Mar 1 = 1 day
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('handles large spans (full year)', () => {
    expect(daysBetween('2025-01-01', '2026-01-01')).toBe(365);
  });
});
