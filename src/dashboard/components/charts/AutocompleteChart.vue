<script setup lang="ts">
import { computed } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { AutocompleteChartSeries } from '../../composables/useAutocomplete';
import { CHART_COLORS } from '@/shared/utils/chart-colors';
import ExtensionIcon from '../ExtensionIcon.vue';

const props = defineProps<{
  series: AutocompleteChartSeries[];
}>();

const chartOptions = computed(() => ({
  chart: {
    type: 'line' as const,
    height: 320,
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
    max: 11,
    tickAmount: 10,
    labels: {
      style: { fontSize: '11px', colors: '#6b7280' },
      formatter: (val: number) => {
        if (val > 10) return '10+';
        return String(Math.round(val));
      },
    },
    title: {
      text: 'AC Position',
      style: { fontSize: '12px', color: '#374151' },
    },
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
        if (val === null || val > 10) return 'Not in autocomplete';
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
    text: 'No autocomplete data available',
    style: { fontSize: '14px', color: '#6b7280' },
  },
}));

const chartSeries = computed(() =>
  props.series.map((s) => ({
    name: s.name,
    data: s.data.map((d) => ({
      x: new Date(d.x + 'T00:00:00Z').getTime(),
      // null = not in autocomplete, show at 11 (bottom)
      y: d.y === null ? 11 : d.y,
    })),
  }))
);
</script>

<template>
  <div
    class="rounded-lg border border-gray-200 bg-white p-4"
    role="region"
    aria-label="Autocomplete position trends over time"
  >
    <VueApexCharts
      type="line"
      :height="320"
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
          aria-hidden="true"
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
