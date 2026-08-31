/**
 * Tests for event observation windows.
 *
 * The point of the window is that a polled change is bounded, not instantaneous.
 * These tests pin that down at the presentation layer: a bounded event must show
 * both edges and the width, and an unbounded one must say so rather than
 * borrowing the bounded rendering.
 */

import { describe, it, expect } from 'vitest';
import { describeEventWindow, describeEventWindowCompact } from '@/shared/utils/event-window';
import type { EventRecord } from '@/shared/types';

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    date: '2026-07-13',
    type: 'title_change',
    field: 'title',
    oldValue: 'Old',
    newValue: 'New',
    note: "Title changed from 'Old' to 'New'",
    ...overrides,
  };
}

describe('describeEventWindow', () => {
  it('reports a bounded window when both edges are present', () => {
    const result = describeEventWindow(makeEvent({
      lastSeenOldAt: new Date('2026-07-10T11:47:00'),
      firstSeenNewAt: new Date('2026-07-13T14:49:00'),
    }));

    expect(result.bounded).toBe(true);
    expect(result.label).toContain('Jul 10 11:47');
    expect(result.label).toContain('Jul 13 14:49');
    // 3 days 3h 2m ≈ 75.03h → rendered in days past the 48h threshold.
    expect(result.hours).toBeCloseTo(75, 0);
    expect(result.width).toBe('~3.1d');
  });

  it('renders a sub-day window in hours', () => {
    const result = describeEventWindow(makeEvent({
      lastSeenOldAt: new Date('2026-07-13T03:00:00'),
      firstSeenNewAt: new Date('2026-07-13T11:00:00'),
    }));

    expect(result.bounded).toBe(true);
    expect(result.hours).toBe(8);
    expect(result.width).toBe('~8h');
  });

  it('renders a sub-hour window in minutes', () => {
    const result = describeEventWindow(makeEvent({
      lastSeenOldAt: new Date('2026-07-13T03:00:00'),
      firstSeenNewAt: new Date('2026-07-13T03:45:00'),
    }));

    expect(result.width).toBe('~45m');
  });

  it('falls back to detectedAt for legacy records, marked unbounded', () => {
    const result = describeEventWindow(makeEvent({
      detectedAt: new Date('2026-07-13T14:49:00'),
    }));

    expect(result.bounded).toBe(false);
    expect(result.width).toBeNull();
    expect(result.hours).toBeNull();
    expect(result.title).toMatch(/not when it happened/i);
  });

  it('falls back to the date string when there is no timestamp at all', () => {
    const result = describeEventWindow(makeEvent());

    expect(result.bounded).toBe(false);
    expect(result.label).toBe('2026-07-13');
  });

  it('rejects an inverted window rather than rendering it backwards', () => {
    const result = describeEventWindow(makeEvent({
      lastSeenOldAt: new Date('2026-07-13T14:49:00'),
      firstSeenNewAt: new Date('2026-07-10T11:47:00'),
      detectedAt: new Date('2026-07-13T14:49:00'),
    }));

    expect(result.bounded).toBe(false);
  });

  it('treats an invalid Date as absent', () => {
    const result = describeEventWindow(makeEvent({
      lastSeenOldAt: new Date('nonsense'),
      firstSeenNewAt: new Date('2026-07-13T14:49:00'),
      detectedAt: new Date('2026-07-13T14:49:00'),
    }));

    expect(result.bounded).toBe(false);
  });
});

describe('describeEventWindowCompact', () => {
  it('anchors on first-seen and appends the width', () => {
    const result = describeEventWindowCompact(makeEvent({
      lastSeenOldAt: new Date('2026-07-13T03:00:00'),
      firstSeenNewAt: new Date('2026-07-13T11:00:00'),
    }));

    expect(result.label).toContain('within ~8h');
    // The full interval stays available on hover.
    expect(result.title).toContain('Jul 13 03:00');
  });

  it('omits the width for legacy records', () => {
    const result = describeEventWindowCompact(makeEvent({
      detectedAt: new Date('2026-07-13T14:49:00'),
    }));

    expect(result.label).not.toContain('within');
  });
});
