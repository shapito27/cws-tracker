<script setup lang="ts">
import { onMounted, computed } from 'vue';
import {
  useExtensionSnapshots,
  type DateRange,
  type DayCell,
  type ExtensionRow,
} from '../../composables/useExtensionSnapshots';

const {
  rows,
  loading,
  dateRange,
  dateColumns,
  loadSnapshots,
  setDateRange,
} = useExtensionSnapshots();

onMounted(loadSnapshots);

const rangeOptions: { label: string; value: DateRange }[] = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
];

/** Threshold for highlighting a cell as "significant change". */
const SIGNIFICANCE_THRESHOLD = 0.1;

/** Pre-computed cell data to avoid repeated Map.get() in the template. */
interface CellView {
  /** Compact display string like "1.2M" */
  display: string;
  /** Full number for tooltip */
  fullDisplay: string;
  /** Delta display string like "+1.2K" */
  deltaDisplay: string;
  /** Tooltip with delta + percentage */
  deltaTooltip: string;
  deltaClasses: string;
  arrow: string;
  /** Background highlight class for significant changes */
  bgClass: string;
  hasData: boolean;
  hasDelta: boolean;
}

const EMPTY_CELL: CellView = {
  display: '-',
  fullDisplay: 'No scan data for this date',
  deltaDisplay: '',
  deltaTooltip: '',
  deltaClasses: '',
  arrow: '',
  bgClass: '',
  hasData: false,
  hasDelta: false,
};

/**
 * Precomputed cell views keyed by "extensionId:date:field".
 * Computed once per reactive change, then accessed O(1) in template.
 */
const cellViews = computed<Map<string, CellView>>(() => {
  const map = new Map<string, CellView>();
  for (const row of rows.value) {
    for (const date of dateColumns.value) {
      for (const field of ['users', 'reviews'] as const) {
        const key = `${row.extensionId}:${date}:${field}`;
        map.set(key, buildCellView(row, date, field));
      }
    }
  }
  return map;
});

function getCell(extensionId: string, date: string, field: 'users' | 'reviews'): CellView {
  return cellViews.value.get(`${extensionId}:${date}:${field}`) ?? EMPTY_CELL;
}

/**
 * Build a CellView from a DayCell and field, computing all display
 * values upfront so the template only accesses flat properties.
 */
function buildCellView(
  row: ExtensionRow,
  date: string,
  field: 'users' | 'reviews'
): CellView {
  const cell = row.days.get(date);
  if (!cell) return EMPTY_CELL;

  const value = field === 'users' ? cell.users : cell.reviews;
  const delta = field === 'users' ? cell.usersDelta : cell.reviewsDelta;
  const hasDelta = delta !== null && delta !== 0;

  let bgClass = '';
  if (hasDelta) {
    const base = value - delta!;
    const significant =
      base === 0 || Math.abs(delta! / base) >= SIGNIFICANCE_THRESHOLD;
    if (significant) {
      bgClass = delta! > 0 ? 'bg-green-50/50' : 'bg-red-50/50';
    }
  }

  let deltaDisplay = '';
  let deltaTooltip = '';
  let deltaClasses = 'text-gray-400';
  let arrow = '';

  if (hasDelta) {
    const base = value - delta!;
    deltaDisplay = formatDelta(delta!);
    deltaTooltip = `${formatDelta(delta!)} (${formatPercent(delta!, base)})`;
    deltaClasses = delta! > 0 ? 'text-green-600' : 'text-red-600';
    arrow = delta! > 0 ? '\u25B2' : '\u25BC';
  }

  return {
    display: formatCompact(value),
    fullDisplay: value.toLocaleString(),
    deltaDisplay,
    deltaTooltip,
    deltaClasses,
    arrow,
    bgClass,
    hasData: true,
    hasDelta,
  };
}

/**
 * Format large numbers compactly: 1,234,567 -> "1.2M", 45,200 -> "45.2K".
 * Numbers under 1,000 are shown as-is.
 */
function formatCompact(n: number): string {
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return val >= 100
      ? `${Math.round(val)}M`
      : `${val.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return val >= 100
      ? `${Math.round(val)}K`
      : `${val.toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(n);
}

/** Format a delta as a signed compact string: "+1.2K", "-340" */
function formatDelta(delta: number): string {
  const sign = delta > 0 ? '+' : '';
  return sign + formatCompact(Math.abs(delta));
}

/** Percentage change string like "+12.3%" or "-0.5%" */
function formatPercent(delta: number, base: number): string {
  if (base === 0) return delta > 0 ? '+\u221E%' : '0%';
  const pct = (delta / base) * 100;
  const sign = pct > 0 ? '+' : '';
  return sign + pct.toFixed(1) + '%';
}

/** Format date header: "Feb 7" from "2026-02-07" */
function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">Extensions Overview</h2>
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
          @click="setDateRange(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-8">
      <p class="text-sm text-gray-500">Loading extension data...</p>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="rows.length === 0"
      class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center"
    >
      <p class="text-sm text-gray-500">
        No extension data yet. Create a project and run a scan to see trends.
      </p>
    </div>

    <!-- Table -->
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200">
      <table
        class="min-w-full divide-y divide-gray-200"
        aria-label="Extensions overview showing daily user and review trends"
      >
        <!-- Header row 1: Date groups -->
        <thead class="bg-gray-50">
          <tr>
            <th
              scope="col"
              class="sticky left-0 z-10 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500 border-r border-gray-200"
              rowspan="2"
            >
              Extension
            </th>
            <th
              v-for="date in dateColumns"
              :key="date"
              scope="colgroup"
              class="px-1 py-2 text-center text-xs font-medium text-gray-500 border-l border-gray-100"
              colspan="2"
            >
              {{ formatDateHeader(date) }}
            </th>
          </tr>
          <!-- Header row 2: Users / Reviews sub-columns -->
          <tr>
            <template v-for="date in dateColumns" :key="date">
              <th scope="col" class="px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-gray-400 border-l border-gray-100">
                Users
              </th>
              <th scope="col" class="px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Reviews
              </th>
            </template>
          </tr>
        </thead>

        <tbody class="divide-y divide-gray-200 bg-white">
          <tr v-for="row in rows" :key="row.extensionId" class="hover:bg-gray-50">
            <!-- Sticky extension name column -->
            <td scope="row" class="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-200 min-w-[200px]">
              <div class="flex items-center gap-2">
                <img
                  v-if="row.iconUrl"
                  :src="row.iconUrl"
                  :alt="row.name"
                  class="h-6 w-6 rounded"
                />
                <div
                  v-else
                  class="flex h-6 w-6 items-center justify-center rounded bg-blue-100 text-xs font-bold text-blue-600"
                  role="img"
                  :aria-label="row.name"
                >
                  {{ row.name.charAt(0).toUpperCase() }}
                </div>
                <router-link
                  :to="{ name: 'project', params: { id: String(row.projectId) } }"
                  class="block min-w-0 group"
                >
                  <span
                    class="block truncate text-sm font-medium text-blue-600 group-hover:text-blue-800 group-hover:underline"
                    :title="row.name"
                  >
                    {{ row.name }}
                  </span>
                  <span
                    class="block text-[10px] text-gray-400 truncate group-hover:text-gray-600"
                    :title="row.projectName"
                  >
                    {{ row.projectName }}
                  </span>
                </router-link>
              </div>
            </td>

            <!-- Data cells for each date -->
            <template v-for="date in dateColumns" :key="date">
              <!-- Users cell -->
              <td
                class="px-2 py-2 text-center border-l border-gray-50 whitespace-nowrap"
                :class="getCell(row.extensionId, date, 'users').bgClass"
              >
                <template v-if="getCell(row.extensionId, date, 'users').hasData">
                  <div class="text-xs text-gray-700" :title="getCell(row.extensionId, date, 'users').fullDisplay">
                    {{ getCell(row.extensionId, date, 'users').display }}
                  </div>
                  <div
                    v-if="getCell(row.extensionId, date, 'users').hasDelta"
                    class="text-[10px] leading-tight"
                    :class="getCell(row.extensionId, date, 'users').deltaClasses"
                    :title="getCell(row.extensionId, date, 'users').deltaTooltip"
                  >
                    {{ getCell(row.extensionId, date, 'users').arrow }}
                    {{ getCell(row.extensionId, date, 'users').deltaDisplay }}
                  </div>
                </template>
                <span v-else class="text-xs text-gray-300" title="No scan data for this date">-</span>
              </td>

              <!-- Reviews cell -->
              <td
                class="px-2 py-2 text-center whitespace-nowrap"
                :class="getCell(row.extensionId, date, 'reviews').bgClass"
              >
                <template v-if="getCell(row.extensionId, date, 'reviews').hasData">
                  <div class="text-xs text-gray-700" :title="getCell(row.extensionId, date, 'reviews').fullDisplay">
                    {{ getCell(row.extensionId, date, 'reviews').display }}
                  </div>
                  <div
                    v-if="getCell(row.extensionId, date, 'reviews').hasDelta"
                    class="text-[10px] leading-tight"
                    :class="getCell(row.extensionId, date, 'reviews').deltaClasses"
                    :title="getCell(row.extensionId, date, 'reviews').deltaTooltip"
                  >
                    {{ getCell(row.extensionId, date, 'reviews').arrow }}
                    {{ getCell(row.extensionId, date, 'reviews').deltaDisplay }}
                  </div>
                </template>
                <span v-else class="text-xs text-gray-300" title="No scan data for this date">-</span>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
