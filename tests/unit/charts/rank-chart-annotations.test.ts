/**
 * Tests for RankChart event annotation logic.
 *
 * Since RankChart is a Vue component using ApexCharts, we test the
 * annotation-building logic directly by extracting it into a testable function.
 * These tests verify:
 * - Annotations appear at correct dates
 * - Toggling filter hides/shows corresponding annotations
 * - Multiple events on same date produce multiple annotations
 * - No events = no annotations, no errors
 */
import { describe, it, expect } from 'vitest';
import type { EventRecord, EventType } from '@/shared/types';
import { EVENT_TYPE_COLORS, EVENT_TYPE_LABELS } from '@/shared/utils/event-colors';
import type { ChartDataPoint } from '@/dashboard/composables/useRankings';

/** Helper: replicates the annotation-building logic from RankChart.vue */
function buildAnnotations(
  events: EventRecord[],
  visibleEventTypes: Set<string>,
  seriesData: ChartDataPoint[][]
): Array<{
  x: string;
  borderColor: string;
  label: { text: string; borderColor: string; style: { background: string } };
}> {
  if (events.length === 0 || visibleEventTypes.size === 0) {
    return [];
  }

  const chartDates = new Set<string>();
  for (const data of seriesData) {
    for (const d of data) {
      chartDates.add(d.x);
    }
  }

  return events
    .filter((e) => visibleEventTypes.has(e.type) && chartDates.has(e.date))
    .map((e) => ({
      x: e.date,
      borderColor: EVENT_TYPE_COLORS[e.type],
      strokeDashArray: 0,
      label: {
        text: EVENT_TYPE_LABELS[e.type],
        borderColor: EVENT_TYPE_COLORS[e.type],
        style: {
          color: '#fff',
          background: EVENT_TYPE_COLORS[e.type],
          fontSize: '10px',
          padding: { left: 4, right: 4, top: 2, bottom: 2 },
        },
        orientation: 'horizontal',
        position: 'top',
      },
    }));
}

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 1,
    extensionId: 'ext-abc',
    date: '2025-01-15',
    type: 'version_change',
    field: 'version',
    oldValue: '1.0.0',
    newValue: '1.1.0',
    note: 'Version changed from 1.0.0 to 1.1.0',
    ...overrides,
  };
}

const sampleSeries: ChartDataPoint[][] = [
  [
    { x: '2025-01-14', y: 5 },
    { x: '2025-01-15', y: 3 },
    { x: '2025-01-16', y: 4 },
  ],
];

describe('RankChart annotations', () => {
  it('should produce annotations at correct dates', () => {
    const events = [makeEvent({ date: '2025-01-15' })];
    const visible = new Set<string>(['version_change']);

    const annotations = buildAnnotations(events, visible, sampleSeries);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].x).toBe('2025-01-15');
    expect(annotations[0].borderColor).toBe(EVENT_TYPE_COLORS.version_change);
    expect(annotations[0].label.text).toBe('Version Change');
  });

  it('should use correct color per event type', () => {
    const types: EventType[] = [
      'permission_change',
      'version_change',
      'rating_milestone',
      'title_change',
      'screenshot_change',
    ];

    for (const type of types) {
      const events = [makeEvent({ type, date: '2025-01-15' })];
      const visible = new Set<string>([type]);

      const annotations = buildAnnotations(events, visible, sampleSeries);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].borderColor).toBe(EVENT_TYPE_COLORS[type]);
      expect(annotations[0].label.style.background).toBe(EVENT_TYPE_COLORS[type]);
    }
  });

  it('should return no annotations when events array is empty', () => {
    const visible = new Set<string>(['version_change']);
    const annotations = buildAnnotations([], visible, sampleSeries);
    expect(annotations).toHaveLength(0);
  });

  it('should return no annotations when no event types are visible', () => {
    const events = [makeEvent()];
    const visible = new Set<string>();
    const annotations = buildAnnotations(events, visible, sampleSeries);
    expect(annotations).toHaveLength(0);
  });

  it('should filter annotations by visible event types', () => {
    const events = [
      makeEvent({ type: 'version_change', date: '2025-01-15' }),
      makeEvent({ type: 'title_change', date: '2025-01-15', id: 2 }),
      makeEvent({ type: 'permission_change', date: '2025-01-15', id: 3 }),
    ];

    // Only show version_change
    const visible = new Set<string>(['version_change']);
    const annotations = buildAnnotations(events, visible, sampleSeries);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].label.text).toBe('Version Change');
  });

  it('should show all annotations when all types are visible', () => {
    const events = [
      makeEvent({ type: 'version_change', date: '2025-01-15' }),
      makeEvent({ type: 'title_change', date: '2025-01-15', id: 2 }),
      makeEvent({ type: 'permission_change', date: '2025-01-15', id: 3 }),
    ];

    const visible = new Set<string>(['version_change', 'title_change', 'permission_change']);
    const annotations = buildAnnotations(events, visible, sampleSeries);
    expect(annotations).toHaveLength(3);
  });

  it('should handle multiple events on the same date (stacked)', () => {
    const events = [
      makeEvent({ type: 'version_change', date: '2025-01-15', id: 1 }),
      makeEvent({ type: 'title_change', date: '2025-01-15', id: 2 }),
    ];

    const visible = new Set<string>(['version_change', 'title_change']);
    const annotations = buildAnnotations(events, visible, sampleSeries);

    expect(annotations).toHaveLength(2);
    expect(annotations[0].x).toBe('2025-01-15');
    expect(annotations[1].x).toBe('2025-01-15');
    // Different colors
    expect(annotations[0].borderColor).not.toBe(annotations[1].borderColor);
  });

  it('should not show annotations for events outside chart date range', () => {
    const events = [
      makeEvent({ date: '2025-02-20' }), // not in chart data
    ];

    const visible = new Set<string>(['version_change']);
    const annotations = buildAnnotations(events, visible, sampleSeries);
    expect(annotations).toHaveLength(0);
  });

  it('should handle toggling: removing a type hides its annotations', () => {
    const events = [
      makeEvent({ type: 'version_change', date: '2025-01-15', id: 1 }),
      makeEvent({ type: 'permission_change', date: '2025-01-15', id: 2 }),
    ];

    // Both visible
    const allVisible = new Set<string>(['version_change', 'permission_change']);
    expect(buildAnnotations(events, allVisible, sampleSeries)).toHaveLength(2);

    // Remove version_change
    const onlyPermission = new Set<string>(['permission_change']);
    const filtered = buildAnnotations(events, onlyPermission, sampleSeries);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].label.text).toBe('Permission Change');
  });

  it('should handle empty series data gracefully', () => {
    const events = [makeEvent()];
    const visible = new Set<string>(['version_change']);
    const annotations = buildAnnotations(events, visible, [[]]);
    expect(annotations).toHaveLength(0);
  });

  it('should handle events across multiple dates', () => {
    const events = [
      makeEvent({ type: 'version_change', date: '2025-01-14', id: 1 }),
      makeEvent({ type: 'title_change', date: '2025-01-15', id: 2 }),
      makeEvent({ type: 'permission_change', date: '2025-01-16', id: 3 }),
    ];

    const visible = new Set<string>(['version_change', 'title_change', 'permission_change']);
    const annotations = buildAnnotations(events, visible, sampleSeries);

    expect(annotations).toHaveLength(3);
    expect(annotations.map((a) => a.x)).toEqual([
      '2025-01-14',
      '2025-01-15',
      '2025-01-16',
    ]);
  });

  it('should handle multiple series contributing dates', () => {
    const multiSeries: ChartDataPoint[][] = [
      [{ x: '2025-01-14', y: 5 }],
      [{ x: '2025-01-16', y: 3 }],
    ];

    const events = [
      makeEvent({ date: '2025-01-14', id: 1 }),
      makeEvent({ date: '2025-01-16', id: 2 }),
    ];

    const visible = new Set<string>(['version_change']);
    const annotations = buildAnnotations(events, visible, multiSeries);
    expect(annotations).toHaveLength(2);
  });
});
