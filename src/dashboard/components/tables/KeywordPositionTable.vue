<script setup lang="ts">
import type { KeywordPositionRow } from '../../composables/useRankings';

defineProps<{
  rows: KeywordPositionRow[];
}>();

const periodLabels = ['7d', '14d', '30d'] as const;

function formatPosition(position: number | null): string {
  if (position === null) return '30+';
  return `#${position}`;
}

function positionColorClass(position: number | null): string {
  if (position === null) return 'text-gray-400';
  if (position <= 3) return 'text-green-700';
  if (position <= 10) return 'text-blue-700';
  if (position <= 20) return 'text-gray-700';
  return 'text-orange-600';
}

function deltaArrow(delta: number | null): string {
  if (delta === null || delta === 0) return '';
  return delta > 0 ? '\u25B2' : '\u25BC';
}

function deltaColorClass(delta: number | null): string {
  if (delta === null || delta === 0) return 'text-gray-400';
  return delta > 0 ? 'text-green-600' : 'text-red-500';
}

function deltaText(delta: number | null): string {
  if (delta === null) return '-';
  if (delta === 0) return '0';
  return String(Math.abs(delta));
}

function getPeriodDelta(row: KeywordPositionRow, period: '7d' | '14d' | '30d'): number | null {
  return row.periods[period].delta;
}
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-gray-200">
    <table
      class="min-w-full divide-y divide-gray-200"
      aria-label="Keyword positions for your extension"
    >
      <thead class="bg-gray-50">
        <tr>
          <th
            scope="col"
            class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
          >
            Keyword
          </th>
          <th
            scope="col"
            class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500"
          >
            Position
          </th>
          <th
            v-for="period in periodLabels"
            :key="period"
            scope="col"
            class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500"
          >
            {{ period }}
          </th>
        </tr>
      </thead>

      <tbody class="divide-y divide-gray-100 bg-white">
        <tr
          v-for="row in rows"
          :key="row.keywordId"
          class="hover:bg-gray-50 transition-colors"
        >
          <!-- Keyword name -->
          <td class="px-4 py-3">
            <span class="text-sm font-medium text-gray-900">{{ row.keywordText }}</span>
          </td>

          <!-- Current position + daily delta -->
          <td class="px-3 py-3 text-center whitespace-nowrap">
            <div class="flex items-center justify-center gap-1.5">
              <span class="text-sm font-semibold" :class="positionColorClass(row.currentPosition)">
                {{ formatPosition(row.currentPosition) }}
              </span>
              <span
                v-if="row.dailyDelta !== null && row.dailyDelta !== 0"
                class="inline-flex items-center gap-0.5 text-[11px] font-medium"
                :class="deltaColorClass(row.dailyDelta)"
                :title="`${row.dailyDelta > 0 ? 'Up' : 'Down'} ${Math.abs(row.dailyDelta)} vs yesterday`"
              >
                <span class="text-[9px] leading-none">{{ deltaArrow(row.dailyDelta) }}</span>
                {{ deltaText(row.dailyDelta) }}
              </span>
            </div>
          </td>

          <!-- Period delta columns (7d, 14d, 30d) -->
          <td
            v-for="period in periodLabels"
            :key="period"
            class="px-3 py-3 text-center whitespace-nowrap"
          >
            <template v-if="getPeriodDelta(row, period) !== null">
              <span
                class="inline-flex items-center gap-0.5 text-sm font-medium"
                :class="deltaColorClass(getPeriodDelta(row, period))"
                :title="`Change over ${period}`"
              >
                <span class="text-[9px] leading-none">{{ deltaArrow(getPeriodDelta(row, period)) }}</span>
                {{ deltaText(getPeriodDelta(row, period)) }}
              </span>
            </template>
            <span v-else class="text-xs text-gray-300">-</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
