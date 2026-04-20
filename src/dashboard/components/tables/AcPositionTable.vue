<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { Keyword } from '@/shared/types';
import type { AcPositionRow, AcDayCell } from '../../composables/useAutocomplete';
import { loadKeywordAcPositionTable } from '../../composables/useAutocomplete';
import { useServiceWorker } from '../../composables/useServiceWorker';
import { daysAgo } from '@/shared/utils/dates';

type DateRange = 7 | 14 | 30;

const props = defineProps<{
  keywords: Keyword[];
  extensionId: string;
  projectId?: number;
}>();

const { scanStatus, requestRefresh } = useServiceWorker();

async function scanAutocompleteOnly(): Promise<void> {
  if (props.projectId === undefined) return;
  await requestRefresh(props.projectId, 'autocomplete');
}

const rows = ref<AcPositionRow[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const dateRange = ref<DateRange>(7);

const rangeOptions: { label: string; value: DateRange }[] = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
];

const dateColumns = computed<string[]>(() => {
  const dates: string[] = [];
  for (let i = dateRange.value - 1; i >= 0; i--) {
    dates.push(daysAgo(i));
  }
  return dates;
});

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    rows.value = await loadKeywordAcPositionTable(
      props.keywords,
      props.extensionId,
      dateRange.value
    );
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load AC positions';
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

// Reload table data when a scan completes so fresh AC positions appear
watch(
  () => scanStatus.value.isRunning,
  async (isRunning, wasRunning) => {
    if (wasRunning && !isRunning) await load();
  }
);

function getCell(row: AcPositionRow, date: string): AcDayCell | null {
  return row.days.get(date) ?? null;
}

function formatPosition(position: number | null): string {
  if (position === null) return '-';
  return `#${position}`;
}

function positionColorClass(position: number | null): string {
  if (position === null) return 'text-gray-400';
  if (position <= 3) return 'text-green-700 font-bold';
  if (position <= 5) return 'text-blue-700';
  return 'text-gray-600';
}

function positionBgClass(position: number | null): string {
  if (position === null) return '';
  if (position <= 3) return 'bg-green-50/60';
  if (position <= 5) return 'bg-blue-50/40';
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

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
</script>

<template>
  <div>
    <!-- Header with range switcher and scan button -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-3">
        <h3 class="text-base font-semibold text-gray-900">AC Positions</h3>
        <button
          v-if="projectId !== undefined"
          type="button"
          class="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          :disabled="scanStatus.isRunning"
          :title="scanStatus.isRunning ? 'A scan is already running' : 'Scan autocomplete positions for this project'"
          @click="scanAutocompleteOnly"
        >
          {{ scanStatus.isRunning ? 'Scanning...' : 'Scan' }}
        </button>
      </div>
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
      <p class="text-sm text-gray-500">Loading autocomplete positions...</p>
    </div>

    <!-- Error state -->
    <div v-else-if="loadError" class="rounded-lg bg-red-50 border border-red-200 p-6 text-center">
      <p class="text-sm text-red-700">{{ loadError }}</p>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="rows.length === 0"
      class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center"
    >
      <p class="text-sm text-gray-500">
        No autocomplete data yet. Run a scan to track AC positions.
      </p>
    </div>

    <!-- Table -->
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200">
      <table
        class="min-w-full divide-y divide-gray-200"
        aria-label="Autocomplete positions per day for your extension"
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
