<script setup lang="ts">
import { CHART_RANGES, chartRangeButtonLabel, type ChartRange } from '@/shared/utils/chart-range';

const range = defineModel<ChartRange>({ required: true });

defineProps<{
  disabled?: boolean;
}>();
</script>

<template>
  <div class="flex rounded-md border border-gray-300" role="group" aria-label="Chart date range">
    <button
      v-for="option in CHART_RANGES"
      :key="option"
      type="button"
      class="px-3 py-1.5 text-xs font-medium first:rounded-l-md last:rounded-r-md disabled:opacity-50 disabled:cursor-not-allowed"
      :class="range === option
        ? 'bg-blue-600 text-white'
        : 'bg-white text-gray-700 hover:bg-gray-50'"
      :aria-pressed="range === option"
      :disabled="disabled"
      @click="range = option"
    >
      {{ chartRangeButtonLabel(option) }}
    </button>
  </div>
</template>
