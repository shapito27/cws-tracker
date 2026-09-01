/**
 * Tests for collapsing multiple same-day samples into one value per day.
 */

import { describe, it, expect } from 'vitest';
import {
  rollupByDate,
  pickLatestPerDate,
  positionStats,
  formatPositionCell,
  formatSampleList,
} from '@/shared/utils/daily-rollup';

interface Sample {
  date: string;
  scannedAt: Date;
  position: number | null;
  label?: string;
}

function s(date: string, time: string, position: number | null, label?: string): Sample {
  return { date, scannedAt: new Date(`${date}T${time}`), position, label };
}

describe('rollupByDate', () => {
  it('returns an empty array for no input', () => {
    expect(rollupByDate([])).toEqual([]);
  });

  it('keeps the last sample of the day as the day value', () => {
    const [day] = rollupByDate([
      s('2026-08-20', '06:14:00', 9, 'morning'),
      s('2026-08-20', '21:47:00', 7, 'evening'),
      s('2026-08-20', '14:02:00', 5, 'midday'),
    ]);

    expect(day.count).toBe(3);
    expect(day.value.label).toBe('evening');
  });

  it('orders samples within a day ascending by scannedAt', () => {
    const [day] = rollupByDate([
      s('2026-08-20', '21:47:00', 7),
      s('2026-08-20', '06:14:00', 9),
      s('2026-08-20', '14:02:00', 5),
    ]);

    expect(day.samples.map((x) => x.position)).toEqual([9, 5, 7]);
  });

  it('orders days ascending by date', () => {
    const days = rollupByDate([
      s('2026-08-22', '03:00:00', 3),
      s('2026-08-20', '03:00:00', 1),
      s('2026-08-21', '03:00:00', 2),
    ]);

    expect(days.map((d) => d.date)).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
  });

  it('is a no-op shape for one sample a day', () => {
    const days = rollupByDate([s('2026-08-20', '03:00:00', 4)]);
    expect(days).toHaveLength(1);
    expect(days[0].count).toBe(1);
    expect(days[0].value.position).toBe(4);
  });
});

describe('pickLatestPerDate', () => {
  it('matches the previous deduplicateByDate behaviour', () => {
    const out = pickLatestPerDate([
      s('2026-08-20', '09:00:00', 5),
      s('2026-08-20', '17:00:00', 3),
      s('2026-08-21', '09:00:00', 4),
    ]);

    expect(out.map((x) => [x.date, x.position])).toEqual([
      ['2026-08-20', 3],
      ['2026-08-21', 4],
    ]);
  });
});

describe('positionStats', () => {
  it('reports zeros for no samples', () => {
    expect(positionStats([])).toEqual({
      last: null, best: null, worst: null, spread: null, count: 0, varied: false,
    });
  });

  it('treats a lower position number as better', () => {
    const stats = positionStats([{ position: 9 }, { position: 5 }, { position: 7 }]);

    expect(stats.best).toBe(5);
    expect(stats.worst).toBe(9);
    expect(stats.spread).toBe(4);
    expect(stats.last).toBe(7);
    expect(stats.count).toBe(3);
    expect(stats.varied).toBe(true);
  });

  it('is not varied when every sample agrees', () => {
    // This is what keeps the intraday view pointed at days that moved: three
    // identical samples must render exactly like a single sample.
    const stats = positionStats([{ position: 7 }, { position: 7 }, { position: 7 }]);

    expect(stats.varied).toBe(false);
    expect(stats.spread).toBe(0);
  });

  it('is never varied for a single sample', () => {
    expect(positionStats([{ position: 7 }]).varied).toBe(false);
  });

  it('excludes off-list samples from best/worst but still counts them', () => {
    const stats = positionStats([{ position: 5 }, { position: null }, { position: 7 }]);

    expect(stats.best).toBe(5);
    expect(stats.worst).toBe(7);
    expect(stats.spread).toBe(2);
    expect(stats.count).toBe(3);
    // Falling off the list mid-day is exactly the volatility worth surfacing.
    expect(stats.varied).toBe(true);
  });

  it('has no spread when only one sample placed', () => {
    const stats = positionStats([{ position: null }, { position: 7 }]);

    expect(stats.best).toBe(7);
    expect(stats.spread).toBeNull();
  });

  it('handles a day where nothing placed', () => {
    const stats = positionStats([{ position: null }, { position: null }]);

    expect(stats.best).toBeNull();
    expect(stats.varied).toBe(false);
    expect(stats.last).toBeNull();
  });
});

describe('formatPositionCell', () => {
  it('shows a single position when samples agree', () => {
    expect(formatPositionCell(positionStats([{ position: 7 }]))).toBe('#7');
  });

  it('shows a range when samples disagree', () => {
    expect(
      formatPositionCell(positionStats([{ position: 9 }, { position: 5 }, { position: 7 }]))
    ).toBe('#5–9');
  });

  it('renders an off-list day with the caller\'s label', () => {
    expect(formatPositionCell(positionStats([{ position: null }]))).toBe('30+');
    expect(formatPositionCell(positionStats([{ position: null }]), '—')).toBe('—');
  });
});

describe('formatSampleList', () => {
  it('lists each sample with its time', () => {
    const out = formatSampleList([
      s('2026-08-20', '06:14:00', 9),
      s('2026-08-20', '14:02:00', null),
    ]);

    expect(out).toContain('#9');
    expect(out).toContain('30+');
    expect(out.split(',')).toHaveLength(2);
  });
});
