<script setup lang="ts">
import { computed } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { RankChartSeries } from '../../composables/useRankings';
import type { EventRecord } from '@/shared/types';
import { EVENT_TYPE_COLORS, EVENT_TYPE_LABELS } from '@/shared/utils/event-colors';
import { CHART_COLORS } from '@/shared/utils/chart-colors';
import ExtensionIcon from '../ExtensionIcon.vue';

const props = withDefaults(defineProps<{
  series: RankChartSeries[];
  events?: EventRecord[];
  visibleEventTypes?: Set<string>;
}>(), {
  events: () => [],
  visibleEventTypes: () => new Set<string>(),
});

/** Build ApexCharts xaxis annotations from visible events. */
/**
 * Union of the observation windows of the events on a day, as epoch millis.
 *
 * Returns `null` when no event in the group carries a window (records written
 * before windows existed), so those keep the original single-line annotation
 * rather than being drawn as a band spanning nothing.
 */
function observationBounds(events: EventRecord[]): { from: number; to: number } | null {
  let from: number | null = null;
  let to: number | null = null;
  for (const e of events) {
    const start = e.lastSeenOldAt;
    const end = e.firstSeenNewAt;
    if (!(start instanceof Date) || !(end instanceof Date)) continue;
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    from = from === null ? start.getTime() : Math.min(from, start.getTime());
    to = to === null ? end.getTime() : Math.max(to, end.getTime());
  }
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}

const eventAnnotations = computed(() => {
  if (props.events.length === 0 || props.visibleEventTypes.size === 0) {
    return [];
  }

  // Collect all x-axis dates present in the chart data
  const chartDates = new Set<string>();
  for (const s of props.series) {
    for (const d of s.data) {
      chartDates.add(d.x);
    }
  }

  // Group events by date to avoid overlapping annotations
  const eventsByDate = new Map<string, EventRecord[]>();
  for (const e of props.events) {
    if (props.visibleEventTypes.has(e.type) && chartDates.has(e.date)) {
      const existing = eventsByDate.get(e.date) ?? [];
      existing.push(e);
      eventsByDate.set(e.date, existing);
    }
  }

  return [...eventsByDate.entries()].map(([date, events]) => {
    const primary = events[0];
    // Show event count or type label as the annotation marker text
    const markerText = events.length > 1
      ? String(events.length)
      : EVENT_TYPE_LABELS[primary.type].charAt(0);

    // Render the change as the interval it was actually observed in, not as a
    // line at midnight. A single line asserts a moment nobody watched: all that
    // was seen is the old value at one scan and the new value at the next. When
    // several events share a day, span the union of their windows.
    const bounds = observationBounds(events);

    return {
      x: bounds ? bounds.from : new Date(date + 'T00:00:00Z').getTime(),
      ...(bounds ? { x2: bounds.to, fillColor: EVENT_TYPE_COLORS[primary.type], opacity: 0.12 } : {}),
      borderColor: EVENT_TYPE_COLORS[primary.type],
      strokeDashArray: 2,
      label: {
        text: markerText,
        borderColor: 'transparent',
        style: {
          color: EVENT_TYPE_COLORS[primary.type],
          background: 'transparent',
          fontSize: '9px',
          fontWeight: '700',
          padding: { left: 2, right: 2, top: 0, bottom: 0 },
        },
        orientation: 'horizontal' as const,
        position: 'top' as const,
      },
    };
  });
});

const chartOptions = computed(() => ({
  chart: {
    type: 'line' as const,
    height: 400,
    toolbar: { show: true },
    zoom: { enabled: true },
    animations: { enabled: true, easing: 'easeinout' as const, speed: 300 },
  },
  colors: CHART_COLORS.slice(0, props.series.length),
  xaxis: {
    type: 'datetime' as const,
    labels: {
      style: { fontSize: '11px', colors: '#6b7280' },
      format: 'yyyy-MM-dd',
    },
  },
  yaxis: {
    reversed: true,
    min: 1,
    max: 31,
    tickAmount: 6,
    labels: {
      style: { fontSize: '11px', colors: '#6b7280' },
      formatter: (val: number) => {
        if (val > 30) return '30+';
        return String(Math.round(val));
      },
    },
    title: {
      text: 'Position',
      rotate: -90,
      style: { fontSize: '12px', color: '#374151' },
    },
  },
  annotations: {
    xaxis: eventAnnotations.value,
  },
  stroke: {
    curve: 'smooth' as const,
    width: 2,
  },
  markers: {
    size: 4,
    hover: { sizeOffset: 2 },
  },
  tooltip: {
    shared: true,
    y: {
      formatter: (val: number | null) => {
        if (val === null || val > 30) return '30+ (not in top 30)';
        return `#${val}`;
      },
    },
  },
  legend: {
    show: false,
  },
  grid: {
    borderColor: '#e5e7eb',
    strokeDashArray: 4,
  },
  noData: {
    text: 'No ranking data available',
    style: { fontSize: '14px', color: '#6b7280' },
  },
}));

const chartSeries = computed(() =>
  props.series.map((s) => ({
    name: s.name,
    data: s.data.map((d) => ({
      x: new Date(d.x + 'T00:00:00Z').getTime(),
      // ApexCharts shows null as gap. For "not ranked", use 31 to show at bottom.
      y: d.y === null ? 31 : d.y,
    })),
  }))
);
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <VueApexCharts
      type="line"
      :height="400"
      :options="chartOptions"
      :series="chartSeries"
    />
    <div class="mt-2 flex flex-wrap items-center gap-4 px-2">
      <div
        v-for="(s, i) in series"
        :key="`${s.extensionId}-${s.name}`"
        class="flex min-w-0 items-center gap-1.5 text-xs text-gray-600"
      >
        <span
          class="inline-block h-3 w-3 shrink-0 rounded-full"
          :style="{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }"
        />
        <ExtensionIcon
          v-if="s.iconUrl !== undefined"
          :icon-url="s.iconUrl ?? null"
          :name="s.name"
          size="xs"
        />
        <span class="min-w-0 truncate" :title="s.name">{{ s.name }}</span>
      </div>
    </div>
  </div>
</template>
