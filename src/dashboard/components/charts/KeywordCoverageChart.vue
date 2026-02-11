<script setup lang="ts">
import { computed } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { CoverageData } from '../../composables/useRankings';

const props = defineProps<{
  data: CoverageData[];
  ownExtensionId: string;
}>();

/** Short label for x-axis (first initial + truncated name). */
function shortLabel(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '\u2026';
}

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
    categories: props.data.map((d) => shortLabel(d.name, 14)),
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
    <template v-else>
      <VueApexCharts
        type="bar"
        :height="300"
        :options="chartOptions"
        :series="chartSeries"
      />
      <!-- Extension reference: icon + full name mapped to chart labels -->
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-gray-100 pt-3">
        <div
          v-for="item in data"
          :key="item.extensionId"
          class="inline-flex items-center gap-1.5 text-[11px]"
          :class="item.extensionId === ownExtensionId ? 'text-blue-700 font-medium' : 'text-gray-600'"
        >
          <img
            v-if="item.iconUrl"
            :src="item.iconUrl"
            :alt="item.name"
            class="h-4 w-4 rounded"
          />
          <span
            v-else
            class="inline-flex h-4 w-4 items-center justify-center rounded bg-gray-200 text-[8px] font-bold text-gray-500"
          >
            {{ item.name.charAt(0).toUpperCase() }}
          </span>
          <span>{{ item.name }}</span>
          <span v-if="item.extensionId === ownExtensionId" class="text-[10px] text-blue-400">(yours)</span>
        </div>
      </div>
    </template>
  </div>
</template>
