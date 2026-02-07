<script setup lang="ts">
import { computed } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { RankChartSeries } from '../../composables/useRankings';
import type { EventRecord } from '@/shared/types';
import { EVENT_TYPE_COLORS, EVENT_TYPE_LABELS } from '@/shared/utils/event-colors';

const props = withDefaults(defineProps<{
  series: RankChartSeries[];
  events?: EventRecord[];
  visibleEventTypes?: Set<string>;
}>(), {
  events: () => [],
  visibleEventTypes: () => new Set<string>(),
});

const CHART_COLORS = [
  '#2563eb', // blue-600
  '#dc2626', // red-600
  '#16a34a', // green-600
  '#9333ea', // purple-600
  '#ea580c', // orange-600
  '#0891b2', // cyan-600
  '#ca8a04', // yellow-600
  '#db2777', // pink-600
  '#4f46e5', // indigo-600
  '#65a30d', // lime-600
];

/** Build ApexCharts xaxis annotations from visible events. */
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

  return props.events
    .filter((e) => props.visibleEventTypes.has(e.type) && chartDates.has(e.date))
    .map((e) => ({
      x: new Date(e.date + 'T00:00:00Z').getTime(),
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
        orientation: 'horizontal' as const,
        position: 'top' as const,
      },
    }));
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
    position: 'top' as const,
    horizontalAlign: 'left' as const,
    fontSize: '12px',
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
    <div class="mt-2 flex items-center gap-4 px-2">
      <div
        v-for="(s, i) in series"
        :key="`${s.extensionId}-${s.name}`"
        class="flex items-center gap-1.5 text-xs text-gray-600"
      >
        <span
          class="inline-block h-2 w-2 rounded-full"
          :style="{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }"
        />
        {{ s.name }}
      </div>
    </div>
  </div>
</template>
