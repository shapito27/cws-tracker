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

const POSITION_THRESHOLD = 10;

const QUADRANT_COLORS = {
  strengths: '#16a34a',
  competitiveWins: '#2563eb',
  quickWins: '#f59e0b',
  needsWork: '#dc2626',
} as const;

const QUADRANT_BG = {
  strengths: '#f0fdf4',
  competitiveWins: '#eff6ff',
  quickWins: '#fffbeb',
  needsWork: '#fef2f2',
} as const;

interface QuadrantLabel {
  name: string;
  color: string;
}

const QUADRANT_LABELS: Record<string, QuadrantLabel> = {
  strengths: { name: 'Strengths', color: QUADRANT_COLORS.strengths },
  competitiveWins: { name: 'Competitive Wins', color: QUADRANT_COLORS.competitiveWins },
  quickWins: { name: 'Quick Wins', color: QUADRANT_COLORS.quickWins },
  needsWork: { name: 'Needs Work', color: QUADRANT_COLORS.needsWork },
};

const props = defineProps<{
  data: ScatterPoint[];
}>();

const rankedPoints = computed(() =>
  props.data.filter((p) => p.position !== null)
);

const unrankedPoints = computed(() =>
  props.data.filter((p) => p.position === null)
);

/** Median competition value used to split left/right quadrants. */
const competitionMedian = computed(() => {
  const values = rankedPoints.value.map((p) => p.totalResults).sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? Math.round((values[mid - 1] + values[mid]) / 2)
    : values[mid];
});

function getQuadrant(point: ScatterPoint): string {
  const lowComp = point.totalResults <= competitionMedian.value;
  const highRank = point.position !== null && point.position <= POSITION_THRESHOLD;
  if (highRank && lowComp) return 'strengths';
  if (highRank && !lowComp) return 'competitiveWins';
  if (!highRank && lowComp) return 'quickWins';
  return 'needsWork';
}

/** Build separate series per quadrant for color-coding. */
const chartSeries = computed(() => {
  const groups: Record<string, Array<{ x: number; y: number; meta: string }>> = {
    strengths: [],
    competitiveWins: [],
    quickWins: [],
    needsWork: [],
  };

  for (const p of rankedPoints.value) {
    const q = getQuadrant(p);
    groups[q].push({
      x: p.totalResults,
      y: p.position as number,
      meta: p.keywordText,
    });
  }

  return [
    { name: 'Strengths', data: groups.strengths },
    { name: 'Competitive Wins', data: groups.competitiveWins },
    { name: 'Quick Wins', data: groups.quickWins },
    { name: 'Needs Work', data: groups.needsWork },
  ];
});

/** Maximum x-axis value with padding. */
const xMax = computed(() => {
  const max = Math.max(...rankedPoints.value.map((p) => p.totalResults), 0);
  return Math.ceil(max * 1.1) || 100;
});

const chartOptions = computed(() => ({
  chart: {
    type: 'scatter' as const,
    height: 400,
    toolbar: { show: true },
    zoom: { enabled: true },
    animations: { enabled: true, easing: 'easeinout' as const, speed: 300 },
  },
  xaxis: {
    title: {
      text: 'Competition (total results)',
      style: { fontSize: '12px', fontWeight: '600', color: '#374151' },
    },
    labels: { style: { fontSize: '10px', colors: '#6b7280' } },
    min: 0,
    max: xMax.value,
    tickAmount: 6,
  },
  yaxis: {
    reversed: true,
    min: 1,
    max: 31,
    tickAmount: 6,
    title: {
      text: 'Your Position (lower is better)',
      style: { fontSize: '12px', fontWeight: '600', color: '#374151' },
    },
    labels: {
      style: { fontSize: '10px', colors: '#6b7280' },
      formatter: (val: number) => {
        if (val > 30) return '30+';
        return String(Math.round(val));
      },
    },
  },
  colors: [
    QUADRANT_COLORS.strengths,
    QUADRANT_COLORS.competitiveWins,
    QUADRANT_COLORS.quickWins,
    QUADRANT_COLORS.needsWork,
  ],
  markers: {
    size: 10,
    strokeWidth: 2,
    strokeColors: '#ffffff',
    hover: { sizeOffset: 4 },
  },
  dataLabels: {
    enabled: true,
    textAnchor: 'start' as const,
    offsetX: 8,
    offsetY: -6,
    style: {
      fontSize: '10px',
      fontWeight: '500',
      colors: ['#374151'],
    },
    background: {
      enabled: true,
      foreColor: '#374151',
      borderRadius: 2,
      padding: 3,
      borderWidth: 0,
      opacity: 0.85,
      dropShadow: { enabled: false },
    },
    formatter: (_val: number, opts: { w: { config: { series: Array<{ data: Array<{ meta: string }> }> } }; seriesIndex: number; dataPointIndex: number }) => {
      const series = opts.w.config.series[opts.seriesIndex];
      const point = series?.data?.[opts.dataPointIndex];
      if (!point?.meta) return '';
      const text = point.meta as string;
      return text.length > 16 ? text.slice(0, 14) + '…' : text;
    },
  },
  tooltip: {
    custom: ({ seriesIndex, dataPointIndex }: { seriesIndex: number; dataPointIndex: number }) => {
      const series = chartSeries.value[seriesIndex];
      const point = series?.data?.[dataPointIndex];
      if (!point) return '';
      const quadrantKey = ['strengths', 'competitiveWins', 'quickWins', 'needsWork'][seriesIndex];
      const label = QUADRANT_LABELS[quadrantKey];
      return `<div class="px-3 py-2 text-xs" style="border-left: 3px solid ${label.color}">
        <strong>${escapeHtml(point.meta)}</strong><br/>
        Position: <strong>#${point.y}</strong><br/>
        Competition: <strong>${point.x.toLocaleString()}</strong> results<br/>
        <span style="color: ${label.color}; font-weight: 600">${label.name}</span>
      </div>`;
    },
  },
  legend: {
    show: true,
    position: 'top' as const,
    horizontalAlign: 'center' as const,
    fontSize: '11px',
    markers: { size: 6, strokeWidth: 0 },
    itemMargin: { horizontal: 12, vertical: 4 },
  },
  grid: {
    borderColor: '#e5e7eb',
    strokeDashArray: 4,
  },
  annotations: {
    yaxis: [
      {
        y: 1,
        y2: POSITION_THRESHOLD,
        x: 0,
        x2: competitionMedian.value,
        fillColor: QUADRANT_BG.strengths,
        opacity: 0.35,
        label: {
          text: '',
        },
      },
      {
        y: 1,
        y2: POSITION_THRESHOLD,
        fillColor: QUADRANT_BG.competitiveWins,
        opacity: 0.35,
        label: {
          text: '',
        },
      },
      {
        y: POSITION_THRESHOLD,
        y2: 31,
        fillColor: QUADRANT_BG.quickWins,
        opacity: 0.35,
        label: {
          text: '',
        },
      },
      {
        y: POSITION_THRESHOLD,
        borderColor: '#f59e0b',
        strokeDashArray: 4,
        label: {
          text: 'Top 10 threshold',
          position: 'front' as const,
          style: { fontSize: '10px', color: '#92400e', background: '#fef3c7', padding: { left: 4, right: 4, top: 2, bottom: 2 } },
        },
      },
    ],
    xaxis: [
      {
        x: competitionMedian.value,
        borderColor: '#9ca3af',
        strokeDashArray: 4,
        label: {
          text: `Median: ${competitionMedian.value.toLocaleString()}`,
          orientation: 'horizontal' as const,
          position: 'top' as const,
          style: { fontSize: '10px', color: '#4b5563', background: '#f3f4f6', padding: { left: 4, right: 4, top: 2, bottom: 2 } },
        },
      },
    ],
  },
  noData: {
    text: 'No scatter data available',
    style: { fontSize: '14px', color: '#6b7280' },
  },
}));
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <h4 class="mb-1 text-sm font-semibold text-gray-700">Keyword Prioritization</h4>
    <p class="mb-3 text-xs text-gray-500">
      Position vs. competition split into four quadrants.
      <span class="font-medium" style="color: #16a34a">Strengths</span> (top-left): high rank, low competition.
      <span class="font-medium" style="color: #f59e0b">Quick Wins</span> (bottom-left): low competition, room to climb.
      <span class="font-medium" style="color: #dc2626">Needs Work</span> (bottom-right): high competition, low rank.
    </p>
    <div v-if="rankedPoints.length === 0 && unrankedPoints.length === 0" class="py-6 text-center text-sm text-gray-400">
      No keyword data available yet.
    </div>
    <template v-else>
      <VueApexCharts
        v-if="rankedPoints.length > 0"
        type="scatter"
        :height="400"
        :options="chartOptions"
        :series="chartSeries"
      />
      <div v-if="unrankedPoints.length > 0" class="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
        <span class="font-medium text-gray-600">Not ranked (30+):</span>
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
