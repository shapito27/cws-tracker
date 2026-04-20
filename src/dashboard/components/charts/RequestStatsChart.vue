<script setup lang="ts">
import { computed } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { DailyRequestStat } from '../../composables/useScanLogs';

const props = defineProps<{
  stats: DailyRequestStat[];
}>();

const chartSeries = computed(() => [
  {
    name: 'Info',
    type: 'column' as const,
    data: props.stats.map((d) => ({
      x: new Date(d.date + 'T00:00:00Z').getTime(),
      y: d.infoCount,
    })),
  },
  {
    name: 'Warnings',
    type: 'column' as const,
    data: props.stats.map((d) => ({
      x: new Date(d.date + 'T00:00:00Z').getTime(),
      y: d.warnCount,
    })),
  },
  {
    name: 'Errors',
    type: 'column' as const,
    data: props.stats.map((d) => ({
      x: new Date(d.date + 'T00:00:00Z').getTime(),
      y: d.errorCount,
    })),
  },
  {
    name: 'Avg duration (ms)',
    type: 'line' as const,
    data: props.stats.map((d) => {
      const hasRequests = d.infoCount + d.warnCount + d.errorCount > 0;
      return {
        x: new Date(d.date + 'T00:00:00Z').getTime(),
        y: hasRequests ? d.avgDurationMs : null,
      };
    }),
  },
]);

const chartOptions = computed(() => ({
  chart: {
    type: 'line' as const,
    height: 280,
    stacked: true,
    stackOnlyBar: true,
    toolbar: { show: false },
    zoom: { enabled: false },
    animations: { enabled: true, easing: 'easeinout' as const, speed: 300 },
  },
  colors: ['#2563eb', '#f59e0b', '#dc2626', '#ea580c'],
  xaxis: {
    type: 'datetime' as const,
    labels: {
      style: { fontSize: '11px', colors: '#6b7280' },
      format: 'MMM dd',
    },
    axisBorder: { color: '#e5e7eb' },
    axisTicks: { color: '#e5e7eb' },
  },
  yaxis: [
    {
      seriesName: 'Info',
      title: {
        text: 'Requests',
        style: { fontSize: '12px', color: '#6b7280', fontWeight: 500 },
      },
      labels: {
        style: { fontSize: '11px', colors: '#6b7280' },
        formatter: (val: number) => String(Math.round(val)),
      },
    },
    { seriesName: 'Info', show: false },
    { seriesName: 'Info', show: false },
    {
      opposite: true,
      seriesName: 'Avg duration (ms)',
      title: {
        text: 'Avg duration (ms)',
        style: { fontSize: '12px', color: '#ea580c', fontWeight: 500 },
      },
      labels: {
        style: { fontSize: '11px', colors: '#6b7280' },
        formatter: (val: number) => `${Math.round(val)}ms`,
      },
    },
  ],
  stroke: {
    curve: 'smooth' as const,
    width: [0, 0, 0, 2],
  },
  markers: {
    size: [0, 0, 0, 4],
    hover: { sizeOffset: 2 },
  },
  plotOptions: {
    bar: {
      columnWidth: '55%',
      borderRadius: 2,
      dataLabels: {
        total: {
          enabled: true,
          offsetY: -4,
          style: { fontSize: '10px', fontWeight: 600, color: '#374151' },
          formatter: (_val: unknown, opts: { dataPointIndex: number; w: { globals: { series: number[][] } } }) => {
            const idx = opts.dataPointIndex;
            const warn = opts.w.globals.series[1]?.[idx] ?? 0;
            const err = opts.w.globals.series[2]?.[idx] ?? 0;
            const parts: string[] = [];
            if (err > 0) parts.push(`${err} err`);
            if (warn > 0) parts.push(`${warn} warn`);
            return parts.length > 0 ? parts.join(' · ') : '';
          },
        },
      },
    },
  },
  dataLabels: { enabled: false },
  tooltip: {
    shared: true,
    intersect: false,
    x: { format: 'yyyy-MM-dd' },
    y: {
      formatter: (val: number, opts: { seriesIndex: number }) => {
        if (opts.seriesIndex === 3) return `${Math.round(val)}ms`;
        return String(Math.round(val));
      },
    },
  },
  legend: {
    position: 'top' as const,
    horizontalAlign: 'left' as const,
    fontSize: '12px',
    markers: { size: 6 },
  },
  grid: {
    borderColor: '#e5e7eb',
    strokeDashArray: 4,
  },
  noData: {
    text: 'No requests in the last 7 days',
    style: { fontSize: '14px', color: '#6b7280' },
  },
}));
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <VueApexCharts
      type="line"
      :height="280"
      :options="chartOptions"
      :series="chartSeries"
    />
  </div>
</template>
