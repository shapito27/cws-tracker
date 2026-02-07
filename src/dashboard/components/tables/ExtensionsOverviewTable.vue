<script setup lang="ts">
import { onMounted } from 'vue';
import {
  useExtensionSnapshots,
  type DateRange,
  type DayCell,
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

/**
 * Format large numbers compactly: 1,234,567 -> "1.2M", 45,200 -> "45.2K".
 * Numbers under 1,000 are shown as-is.
 */
function formatCompact(n: number): string {
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return val >= 100 ? `${Math.round(val)}M` : `${val.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return val >= 100 ? `${Math.round(val)}K` : `${val.toFixed(1).replace(/\.0$/, '')}K`;
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

function getDeltaClasses(delta: number | null): string {
  if (delta === null || delta === 0) return 'text-gray-400';
  return delta > 0 ? 'text-green-600' : 'text-red-600';
}

function getDeltaArrow(delta: number | null): string {
  if (delta === null || delta === 0) return '';
  return delta > 0 ? '\u25B2' : '\u25BC';
}

/** Returns true if this cell has a large change (>10%) worth highlighting. */
function isSignificant(cell: DayCell, field: 'users' | 'reviews'): boolean {
  const delta = field === 'users' ? cell.usersDelta : cell.reviewsDelta;
  const value = field === 'users' ? cell.users : cell.reviews;
  if (delta === null || delta === 0) return false;
  const base = value - delta;
  if (base === 0) return true;
  return Math.abs(delta / base) >= 0.1;
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
      <table class="min-w-full divide-y divide-gray-200">
        <!-- Header row 1: Date groups -->
        <thead class="bg-gray-50">
          <tr>
            <th
              class="sticky left-0 z-10 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500 border-r border-gray-200"
              rowspan="2"
            >
              Extension
            </th>
            <th
              v-for="date in dateColumns"
              :key="date"
              class="px-1 py-2 text-center text-xs font-medium text-gray-500 border-l border-gray-100"
              colspan="2"
            >
              {{ formatDateHeader(date) }}
            </th>
          </tr>
          <!-- Header row 2: Users / Reviews sub-columns -->
          <tr>
            <template v-for="date in dateColumns" :key="date">
              <th class="px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-gray-400 border-l border-gray-100">
                Users
              </th>
              <th class="px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Reviews
              </th>
            </template>
          </tr>
        </thead>

        <tbody class="divide-y divide-gray-200 bg-white">
          <tr v-for="row in rows" :key="row.extensionId" class="hover:bg-gray-50">
            <!-- Sticky extension name column -->
            <td class="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-200 min-w-[200px]">
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
                >
                  {{ row.name.charAt(0).toUpperCase() }}
                </div>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-gray-900" :title="row.name">
                    {{ row.name }}
                  </p>
                  <p class="text-[10px] text-gray-400 truncate" :title="row.projectName">
                    {{ row.projectName }}
                  </p>
                </div>
              </div>
            </td>

            <!-- Data cells for each date -->
            <template v-for="date in dateColumns" :key="date">
              <!-- Users cell -->
              <td
                class="px-2 py-2 text-center border-l border-gray-50 whitespace-nowrap"
                :class="{ 'bg-green-50/50': row.days.get(date) && isSignificant(row.days.get(date)!, 'users') && (row.days.get(date)!.usersDelta ?? 0) > 0, 'bg-red-50/50': row.days.get(date) && isSignificant(row.days.get(date)!, 'users') && (row.days.get(date)!.usersDelta ?? 0) < 0 }"
              >
                <template v-if="row.days.get(date)">
                  <div class="text-xs text-gray-700" :title="row.days.get(date)!.users.toLocaleString()">
                    {{ formatCompact(row.days.get(date)!.users) }}
                  </div>
                  <div
                    v-if="row.days.get(date)!.usersDelta !== null && row.days.get(date)!.usersDelta !== 0"
                    class="text-[10px] leading-tight"
                    :class="getDeltaClasses(row.days.get(date)!.usersDelta)"
                    :title="formatDelta(row.days.get(date)!.usersDelta!) + ' (' + formatPercent(row.days.get(date)!.usersDelta!, row.days.get(date)!.users - row.days.get(date)!.usersDelta!) + ')'"
                  >
                    {{ getDeltaArrow(row.days.get(date)!.usersDelta) }}
                    {{ formatDelta(row.days.get(date)!.usersDelta!) }}
                  </div>
                </template>
                <span v-else class="text-xs text-gray-300">-</span>
              </td>

              <!-- Reviews cell -->
              <td
                class="px-2 py-2 text-center whitespace-nowrap"
                :class="{ 'bg-green-50/50': row.days.get(date) && isSignificant(row.days.get(date)!, 'reviews') && (row.days.get(date)!.reviewsDelta ?? 0) > 0, 'bg-red-50/50': row.days.get(date) && isSignificant(row.days.get(date)!, 'reviews') && (row.days.get(date)!.reviewsDelta ?? 0) < 0 }"
              >
                <template v-if="row.days.get(date)">
                  <div class="text-xs text-gray-700" :title="row.days.get(date)!.reviews.toLocaleString()">
                    {{ formatCompact(row.days.get(date)!.reviews) }}
                  </div>
                  <div
                    v-if="row.days.get(date)!.reviewsDelta !== null && row.days.get(date)!.reviewsDelta !== 0"
                    class="text-[10px] leading-tight"
                    :class="getDeltaClasses(row.days.get(date)!.reviewsDelta)"
                    :title="formatDelta(row.days.get(date)!.reviewsDelta!) + ' (' + formatPercent(row.days.get(date)!.reviewsDelta!, row.days.get(date)!.reviews - row.days.get(date)!.reviewsDelta!) + ')'"
                  >
                    {{ getDeltaArrow(row.days.get(date)!.reviewsDelta) }}
                    {{ formatDelta(row.days.get(date)!.reviewsDelta!) }}
                  </div>
                </template>
                <span v-else class="text-xs text-gray-300">-</span>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
