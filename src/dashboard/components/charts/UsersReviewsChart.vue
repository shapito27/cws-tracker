<script setup lang="ts">
import { computed } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { ListingSnapshot } from '@/shared/types';

const props = defineProps<{
  snapshots: ListingSnapshot[];
}>();

/** Deduplicate snapshots by date, keeping the latest scannedAt per day. */
const deduped = computed(() => {
  const byDate = new Map<string, ListingSnapshot>();
  for (const snap of props.snapshots) {
    const existing = byDate.get(snap.date);
    if (!existing || snap.scannedAt > existing.scannedAt) {
      byDate.set(snap.date, snap);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
});

const chartSeries = computed(() => [
  {
    name: 'Users',
    type: 'line' as const,
    data: deduped.value.map((s) => ({
      x: new Date(s.date + 'T00:00:00Z').getTime(),
      y: s.userCountNumeric,
    })),
  },
  {
    name: 'Reviews',
    type: 'line' as const,
    data: deduped.value.map((s) => ({
      x: new Date(s.date + 'T00:00:00Z').getTime(),
      y: s.reviewCount,
    })),
  },
]);

const chartOptions = computed(() => ({
  chart: {
    type: 'line' as const,
    height: 350,
    toolbar: { show: true },
    zoom: { enabled: true },
    animations: { enabled: true, easing: 'easeinout' as const, speed: 300 },
  },
  colors: ['#2563eb', '#16a34a'],
  xaxis: {
    type: 'datetime' as const,
    labels: {
      style: { fontSize: '11px', colors: '#6b7280' },
      format: 'yyyy-MM-dd',
    },
  },
  yaxis: [
    {
      title: {
        text: 'Users',
        rotate: -90,
        style: { fontSize: '12px', color: '#2563eb' },
      },
      labels: {
        style: { fontSize: '11px', colors: '#6b7280' },
        formatter: (val: number) => {
          if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
          if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
          return String(Math.round(val));
        },
      },
    },
    {
      opposite: true,
      title: {
        text: 'Reviews',
        rotate: -90,
        style: { fontSize: '12px', color: '#16a34a' },
      },
      labels: {
        style: { fontSize: '11px', colors: '#6b7280' },
        formatter: (val: number) => {
          if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
          if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
          return String(Math.round(val));
        },
      },
    },
  ],
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
      formatter: (val: number) => val.toLocaleString(),
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
    text: 'No listing data available',
    style: { fontSize: '14px', color: '#6b7280' },
  },
}));
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <VueApexCharts
      type="line"
      :height="350"
      :options="chartOptions"
      :series="chartSeries"
    />
  </div>
</template>
