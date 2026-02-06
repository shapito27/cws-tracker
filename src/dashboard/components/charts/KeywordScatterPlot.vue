<script setup lang="ts">
import { computed } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { ScatterPoint } from '../../composables/useRankings';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const props = defineProps<{
  data: ScatterPoint[];
}>();

/** Only include keywords where the own extension has a position. */
const rankedPoints = computed(() =>
  props.data.filter((p) => p.position !== null)
);

const unrankedPoints = computed(() =>
  props.data.filter((p) => p.position === null)
);

const chartOptions = computed(() => ({
  chart: {
    type: 'scatter' as const,
    height: 350,
    toolbar: { show: true },
    zoom: { enabled: true },
    animations: { enabled: true, easing: 'easeinout' as const, speed: 300 },
  },
  xaxis: {
    title: { text: 'Competition (total results)', style: { fontSize: '11px', color: '#374151' } },
    labels: { style: { fontSize: '10px', colors: '#6b7280' } },
    min: 0,
    tickAmount: 6,
  },
  yaxis: {
    reversed: true,
    min: 1,
    max: 31,
    tickAmount: 6,
    title: { text: 'Your Position', style: { fontSize: '11px', color: '#374151' } },
    labels: {
      style: { fontSize: '10px', colors: '#6b7280' },
      formatter: (val: number) => {
        if (val > 30) return '30+';
        return String(Math.round(val));
      },
    },
  },
  colors: ['#2563eb'],
  markers: {
    size: 8,
    hover: { sizeOffset: 3 },
  },
  tooltip: {
    custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
      const point = rankedPoints.value[dataPointIndex];
      if (!point) return '';
      const pos = point.position !== null ? `#${point.position}` : '30+';
      return `<div class="px-3 py-2 text-xs">
        <strong>${escapeHtml(point.keywordText)}</strong><br/>
        Position: ${pos}<br/>
        Competition: ${point.totalResults} results
      </div>`;
    },
  },
  legend: { show: false },
  grid: { borderColor: '#e5e7eb', strokeDashArray: 4 },
  annotations: {
    yaxis: [
      {
        y: 10,
        borderColor: '#f59e0b',
        strokeDashArray: 4,
        label: {
          text: 'Top 10 threshold',
          position: 'front' as const,
          style: { fontSize: '10px', color: '#92400e', background: '#fef3c7' },
        },
      },
    ],
  },
  noData: {
    text: 'No scatter data available',
    style: { fontSize: '14px', color: '#6b7280' },
  },
}));

const chartSeries = computed(() => [
  {
    name: 'Keywords',
    data: rankedPoints.value.map((p) => ({
      x: p.totalResults,
      y: p.position,
    })),
  },
]);
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <h4 class="mb-1 text-sm font-semibold text-gray-700">Keyword Prioritization</h4>
    <p class="mb-3 text-xs text-gray-500">
      Your position vs. competition level. Keywords in the top-left quadrant (low competition, high rank) are your strengths.
      Bottom-right keywords are improvement opportunities.
    </p>
    <div v-if="rankedPoints.length === 0 && unrankedPoints.length === 0" class="py-6 text-center text-sm text-gray-400">
      No keyword data available yet.
    </div>
    <template v-else>
      <VueApexCharts
        v-if="rankedPoints.length > 0"
        type="scatter"
        :height="350"
        :options="chartOptions"
        :series="chartSeries"
      />
      <div v-if="unrankedPoints.length > 0" class="mt-3 text-xs text-gray-500">
        <span class="font-medium">Not ranked (30+):</span>
        <span v-if="unrankedPoints.length <= 5">
          {{ unrankedPoints.map(p => p.keywordText).join(', ') }}
        </span>
        <span v-else>
          {{ unrankedPoints.length }} keywords
        </span>
      </div>
    </template>
  </div>
</template>
