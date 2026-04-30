/**
 * Unit tests for rank-history lookback helpers.
 *
 * Pure-function tests — no DB or async involved. Covers the gap-day fix
 * where a partial scan writes `position: null` snapshots that would
 * otherwise produce false "entered top 30" / "appeared in autocomplete"
 * events on the next real scan.
 */

import { describe, it, expect } from 'vitest';
import {
  findEffectivePrevious,
  dayDiff,
  RANK_NULL_LOOKBACK_DAYS,
} from '../../../src/shared/utils/rank-history';

interface Snap {
  date: string;
  position: number | null;
}

const snap = (date: string, position: number | null): Snap => ({ date, position });

describe('dayDiff', () => {
  it('returns 0 for equal dates', () => {
    expect(dayDiff('2026-04-29', '2026-04-29')).toBe(0);
  });

  it('returns positive when a > b', () => {
    expect(dayDiff('2026-04-30', '2026-04-29')).toBe(1);
  });

  it('returns negative when a < b', () => {
    expect(dayDiff('2026-04-28', '2026-04-30')).toBe(-2);
  });

  it('handles month boundary', () => {
    expect(dayDiff('2026-05-01', '2026-04-29')).toBe(2);
  });
});

describe('findEffectivePrevious', () => {
  it('returns undefined when immediatePrev is undefined', () => {
    expect(findEffectivePrevious([], undefined, '2026-04-29')).toBeUndefined();
  });

  it('returns immediatePrev unchanged when its position is non-null', () => {
    const prev = snap('2026-04-28', 1);
    expect(findEffectivePrevious([prev], prev, '2026-04-29')).toBe(prev);
  });

  it('looks back past null prev to most recent non-null within window', () => {
    // Apr 27 #1, Apr 28 null (gap day), today Apr 29 — should resolve to Apr 27.
    const apr27 = snap('2026-04-27', 1);
    const apr28 = snap('2026-04-28', null);
    const result = findEffectivePrevious([apr27, apr28], apr28, '2026-04-29');
    expect(result).toBe(apr27);
  });

  it('walks past multiple null gap days to find non-null', () => {
    // Apr 25 #2, Apr 26 null, Apr 27 null, Apr 28 null, today Apr 29.
    const apr25 = snap('2026-04-25', 2);
    const apr26 = snap('2026-04-26', null);
    const apr27 = snap('2026-04-27', null);
    const apr28 = snap('2026-04-28', null);
    const result = findEffectivePrevious(
      [apr25, apr26, apr27, apr28],
      apr28,
      '2026-04-29'
    );
    expect(result).toBe(apr25);
  });

  it('falls back to immediatePrev when no non-null within window', () => {
    // Non-null is 30 days old (outside 14-day window) — keep immediatePrev null.
    const old = snap('2026-03-30', 1);
    const apr28 = snap('2026-04-28', null);
    const result = findEffectivePrevious([old, apr28], apr28, '2026-04-29');
    expect(result).toBe(apr28);
  });

  it('falls back to immediatePrev when no non-null exists at all', () => {
    // First-ever appearance of a tracked ext — should keep null prev so the
    // caller emits a legitimate "appeared" event.
    const apr28 = snap('2026-04-28', null);
    const result = findEffectivePrevious([apr28], apr28, '2026-04-29');
    expect(result).toBe(apr28);
  });

  it('respects the lookbackDays bound exactly', () => {
    // Snapshot exactly RANK_NULL_LOOKBACK_DAYS days old is INCLUDED.
    const today = '2026-04-29';
    const onBoundary = (() => {
      const d = new Date(today + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - RANK_NULL_LOOKBACK_DAYS);
      return d.toISOString().slice(0, 10);
    })();
    const onBoundarySnap = snap(onBoundary, 5);
    const apr28 = snap('2026-04-28', null);
    const result = findEffectivePrevious(
      [onBoundarySnap, apr28],
      apr28,
      today
    );
    expect(result).toBe(onBoundarySnap);
  });

  it('excludes snapshots one day past the lookback window', () => {
    const today = '2026-04-29';
    const justOutside = (() => {
      const d = new Date(today + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - (RANK_NULL_LOOKBACK_DAYS + 1));
      return d.toISOString().slice(0, 10);
    })();
    const apr28 = snap('2026-04-28', null);
    const result = findEffectivePrevious(
      [snap(justOutside, 5), apr28],
      apr28,
      today
    );
    expect(result).toBe(apr28);
  });

  it('ignores history entries on or after currentDate', () => {
    // Defensive: if pairHistory accidentally includes today/future rows,
    // they should be skipped.
    const today = '2026-04-29';
    const futureSnap = snap('2026-04-30', 1);
    const apr27 = snap('2026-04-27', 1);
    const apr28 = snap('2026-04-28', null);
    const result = findEffectivePrevious(
      [apr27, apr28, futureSnap],
      apr28,
      today
    );
    expect(result).toBe(apr27);
  });

  it('picks the MOST RECENT non-null within window when multiple exist', () => {
    const apr20 = snap('2026-04-20', 9);
    const apr25 = snap('2026-04-25', 3);
    const apr28 = snap('2026-04-28', null);
    const result = findEffectivePrevious(
      [apr20, apr25, apr28],
      apr28,
      '2026-04-29'
    );
    expect(result).toBe(apr25);
  });

  it('honors a custom lookbackDays argument', () => {
    // Use a 3-day window — Apr 25 (4 days before Apr 29) is outside.
    const apr25 = snap('2026-04-25', 5);
    const apr28 = snap('2026-04-28', null);
    expect(
      findEffectivePrevious([apr25, apr28], apr28, '2026-04-29', 3)
    ).toBe(apr28);
    // With a 5-day window, Apr 25 IS inside.
    expect(
      findEffectivePrevious([apr25, apr28], apr28, '2026-04-29', 5)
    ).toBe(apr25);
  });
});
