<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { Keyword } from '@/shared/types';
import type { KeywordPositionRow, KeywordDayCell } from '../../composables/useRankings';
import { loadKeywordPositionTable } from '../../composables/useRankings';
import { loadAutocompletePositions } from '../../composables/useAutocomplete';
import { daysAgo } from '@/shared/utils/dates';
import { db } from '@/shared/db/database';

type DateRange = 7 | 14 | 30;

const props = defineProps<{
  keywords: Keyword[];
  ownExtensionId: string;
}>();

const rows = ref<KeywordPositionRow[]>([]);
/** Autocomplete position per keyword for own extension. keywordId -> position (1-10 or null). */
const acPositions = ref<Map<number, number | null>>(new Map());
const loading = ref(false);
const dateRange = ref<DateRange>(7);

const rangeOptions: { label: string; value: DateRange }[] = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
];

/** Sorted visible date strings for the selected range. */
const dateColumns = computed<string[]>(() => {
  const dates: string[] = [];
  for (let i = dateRange.value - 1; i >= 0; i--) {
    dates.push(daysAgo(i));
  }
  return dates;
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    rows.value = await loadKeywordPositionTable(
      props.keywords,
      props.ownExtensionId,
      dateRange.value
    );

    // Load autocomplete positions for own extension across all keywords in parallel
    const ownExt = await db.extensions.get(props.ownExtensionId);
    const map = new Map<number, number | null>();
    if (ownExt) {
      const keywordsWithId = props.keywords.filter((kw) => kw.id !== undefined);
      const positionsArray = await Promise.all(
        keywordsWithId.map((kw) => loadAutocompletePositions(kw.id!, [ownExt]))
      );
      keywordsWithId.forEach((kw, idx) => {
        const own = positionsArray[idx]?.find(
          (p) => p.extensionId === props.ownExtensionId
        );
        map.set(kw.id!, own?.position ?? null);
      });
    }
    acPositions.value = map;
  } finally {
    loading.value = false;
  }
}

async function setRange(range: DateRange): Promise<void> {
  dateRange.value = range;
  await load();
}

onMounted(load);
watch(() => props.keywords, load);

function getCell(row: KeywordPositionRow, date: string): KeywordDayCell | null {
  return row.days.get(date) ?? null;
}

function formatPosition(position: number | null): string {
  if (position === null) return '30+';
  return `#${position}`;
}

function positionColorClass(position: number | null): string {
  if (position === null) return 'text-gray-400';
  if (position <= 3) return 'text-green-700 font-bold';
  if (position <= 10) return 'text-blue-700';
  if (position <= 20) return 'text-gray-700';
  return 'text-orange-600';
}

function positionBgClass(position: number | null): string {
  if (position === null) return '';
  if (position <= 3) return 'bg-green-50/60';
  if (position <= 10) return 'bg-blue-50/40';
  return '';
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
  if (delta === null || delta === 0) return '';
  return String(Math.abs(delta));
}

function getAcPosition(keywordId: number): number | null {
  return acPositions.value.get(keywordId) ?? null;
}

function formatAcBadge(position: number | null): string {
  if (position === null) return '-';
  return `AC: #${position}`;
}

function acBadgeClasses(position: number | null): string {
  if (position === null) return 'text-gray-400 bg-gray-50';
  if (position <= 3) return 'text-green-700 bg-green-50 border-green-200';
  if (position <= 5) return 'text-blue-700 bg-blue-50 border-blue-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
}

/** Format date header: "Feb 7" from "2026-02-07" */
function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
</script>

<template>
  <div>
    <!-- Header with range switcher -->
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-base font-semibold text-gray-900">Keyword Positions</h3>
      <div class="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
        <button
          v-for="opt in rangeOptions"
          :key="opt.value"
          :aria-label="`Show ${opt.label} of data`"
          :aria-pressed="dateRange === opt.value"
          class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
          :class="dateRange === opt.value
            ? 'bg-blue-600 text-white'
            : 'text-gray-600 hover:bg-gray-100'"
          @click="setRange(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-8">
      <p class="text-sm text-gray-500">Loading keyword positions...</p>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="rows.length === 0"
      class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center"
    >
      <p class="text-sm text-gray-500">
        No keyword data yet. Add keywords and run a scan.
      </p>
    </div>

    <!-- Table -->
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200">
      <table
        class="min-w-full divide-y divide-gray-200"
        aria-label="Keyword positions per day for your extension"
      >
        <thead class="bg-gray-50">
          <tr>
            <th
              scope="col"
              class="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500 border-r border-gray-200"
            >
              Keyword
            </th>
            <th
              scope="col"
              class="px-2 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap border-r border-gray-100"
              aria-label="Autocomplete position (1 to 10)"
            >
              <abbr title="Autocomplete position (1-10)">AC</abbr>
            </th>
            <th
              v-for="date in dateColumns"
              :key="date"
              scope="col"
              class="px-2 py-2.5 text-center text-xs font-medium text-gray-500 whitespace-nowrap"
            >
              {{ formatDateHeader(date) }}
            </th>
          </tr>
        </thead>

        <tbody class="divide-y divide-gray-100 bg-white">
          <tr
            v-for="row in rows"
            :key="row.keywordId"
            class="hover:bg-gray-50/50 transition-colors"
          >
            <!-- Sticky keyword column -->
            <td
              class="sticky left-0 z-10 bg-white px-4 py-2.5 border-r border-gray-200 min-w-[140px]"
            >
              <span class="text-sm font-medium text-gray-900 truncate block" :title="row.keywordText">
                {{ row.keywordText }}
              </span>
            </td>

            <!-- Autocomplete position badge -->
            <td class="px-2 py-2 text-center whitespace-nowrap border-r border-gray-100">
              <span
                v-if="getAcPosition(row.keywordId) !== null"
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                :class="acBadgeClasses(getAcPosition(row.keywordId))"
                :aria-label="`Autocomplete position ${getAcPosition(row.keywordId)} for ${row.keywordText}`"
                :title="`Autocomplete position: #${getAcPosition(row.keywordId)}`"
              >
                {{ formatAcBadge(getAcPosition(row.keywordId)) }}
              </span>
              <span v-else class="text-xs text-gray-300" aria-label="No autocomplete data">-</span>
            </td>

            <!-- Day cells -->
            <td
              v-for="date in dateColumns"
              :key="date"
              class="px-2 py-2 text-center whitespace-nowrap"
              :class="getCell(row, date) ? positionBgClass(getCell(row, date)!.position) : ''"
            >
              <template v-if="getCell(row, date)">
                <div
                  class="text-xs font-semibold"
                  :class="positionColorClass(getCell(row, date)!.position)"
                >
                  {{ formatPosition(getCell(row, date)!.position) }}
                </div>
                <div
                  v-if="getCell(row, date)!.delta !== null && getCell(row, date)!.delta !== 0"
                  class="text-[10px] leading-tight mt-0.5"
                  :class="deltaColorClass(getCell(row, date)!.delta)"
                  :title="`${getCell(row, date)!.delta! > 0 ? 'Improved' : 'Dropped'} ${Math.abs(getCell(row, date)!.delta!)} position${Math.abs(getCell(row, date)!.delta!) !== 1 ? 's' : ''}`"
                >
                  <span aria-hidden="true">{{ deltaArrow(getCell(row, date)!.delta) }}</span>
                  {{ deltaText(getCell(row, date)!.delta) }}
                </div>
              </template>
              <span v-else class="text-xs text-gray-300" aria-label="No data">-</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
