<script setup lang="ts">
import { computed } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { CoverageData } from '../../composables/useRankings';

const props = defineProps<{
  data: CoverageData[];
  ownExtensionId: string;
}>();

const chartOptions = computed(() => ({
  chart: {
    type: 'bar' as const,
    height: 300,
    toolbar: { show: false },
    animations: { enabled: true, easing: 'easeinout' as const, speed: 300 },
  },
  plotOptions: {
    bar: {
      horizontal: false,
      columnWidth: '60%',
      borderRadius: 3,
    },
  },
  dataLabels: { enabled: false },
  xaxis: {
    categories: props.data.map((d) => d.name),
    labels: {
      style: { fontSize: '10px', colors: '#6b7280' },
      rotate: -45,
      rotateAlways: props.data.length > 4,
      trim: true,
      maxHeight: 80,
    },
  },
  yaxis: {
    title: { text: 'Keywords', style: { fontSize: '11px', color: '#374151' } },
    labels: { style: { fontSize: '11px', colors: '#6b7280' } },
    min: 0,
    forceNiceScale: true,
  },
  colors: ['#16a34a', '#2563eb', '#f59e0b', '#6b7280'],
  legend: {
    position: 'top' as const,
    horizontalAlign: 'left' as const,
    fontSize: '11px',
  },
  grid: { borderColor: '#e5e7eb', strokeDashArray: 4 },
  tooltip: {
    y: {
      formatter: (val: number) => `${val} keyword${val !== 1 ? 's' : ''}`,
    },
  },
  noData: {
    text: 'No coverage data available',
    style: { fontSize: '14px', color: '#6b7280' },
  },
}));

const chartSeries = computed(() => [
  { name: 'Top 3', data: props.data.map((d) => d.top3) },
  { name: 'Top 10', data: props.data.map((d) => d.top10) },
  { name: 'Top 20', data: props.data.map((d) => d.top20) },
  { name: 'Top 30', data: props.data.map((d) => d.top30) },
]);
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <h4 class="mb-1 text-sm font-semibold text-gray-700">Keyword Coverage</h4>
    <p class="mb-3 text-xs text-gray-500">
      How many keywords each extension ranks in at different rank tiers.
    </p>
    <div v-if="data.length === 0" class="py-6 text-center text-sm text-gray-400">
      No coverage data available yet.
    </div>
    <VueApexCharts
      v-else
      type="bar"
      :height="300"
      :options="chartOptions"
      :series="chartSeries"
    />
  </div>
</template>
