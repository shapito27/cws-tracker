<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Keyword, Extension } from '@/shared/types';
import type { HeatmapCell } from '../../composables/useRankings';

const props = defineProps<{
  keywords: Keyword[];
  extensions: Extension[];
  cells: HeatmapCell[];
  ownExtensionId: string;
}>();

/** Currently hovered column extension ID (for column highlight). */
const hoveredExtId = ref<string | null>(null);

/** Map for quick lookup: `${keywordId}-${extensionId}` → position */
const positionMap = computed(() => {
  const map = new Map<string, number | null>();
  for (const cell of props.cells) {
    map.set(`${cell.keywordId}-${cell.extensionId}`, cell.position);
  }
  return map;
});

/** Extensions ordered: own first, then competitors alphabetically. */
const orderedExtensions = computed(() => {
  const own = props.extensions.find((e) => e.id === props.ownExtensionId);
  const competitors = props.extensions
    .filter((e) => e.id !== props.ownExtensionId)
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  return own ? [own, ...competitors] : competitors;
});

/** Best (lowest) position per extension across all keywords. */
const bestPositions = computed(() => {
  const map = new Map<string, number | null>();
  for (const ext of props.extensions) {
    let best: number | null = null;
    for (const kw of props.keywords) {
      const pos = getPosition(kw.id, ext.id);
      if (pos !== undefined && pos !== null) {
        if (best === null || pos < best) best = pos;
      }
    }
    map.set(ext.id, best);
  }
  return map;
});

function getPosition(keywordId: number | undefined, extensionId: string): number | null | undefined {
  if (keywordId === undefined) return undefined;
  return positionMap.value.get(`${keywordId}-${extensionId}`);
}

function formatPosition(pos: number | null | undefined): string {
  if (pos === undefined) return '-';
  if (pos === null) return '30+';
  return String(pos);
}

function getCellClasses(pos: number | null | undefined): string {
  if (pos === undefined) return 'bg-gray-50 text-gray-400';
  if (pos === null) return 'bg-gray-100 text-gray-500';
  if (pos <= 3) return 'bg-green-100 text-green-800 font-semibold';
  if (pos <= 10) return 'bg-yellow-100 text-yellow-800';
  if (pos <= 20) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-700';
}

function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '\u2026';
}

function getBestPositionLabel(extId: string): string {
  const best = bestPositions.value.get(extId);
  if (best === null || best === undefined) return '';
  return `Best: #${best}`;
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <h4 class="mb-3 text-sm font-semibold text-gray-700">Rank Position Heatmap</h4>
    <p class="mb-3 text-xs text-gray-500">
      Latest rank for each keyword across all tracked extensions. Color intensity indicates rank quality.
    </p>
    <div v-if="keywords.length === 0 || cells.length === 0" class="py-6 text-center text-sm text-gray-400">
      No ranking data available yet.
    </div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b border-gray-200">
            <th class="py-2 pr-3 text-left font-medium text-gray-500">Keyword</th>
            <th
              v-for="ext in orderedExtensions"
              :key="ext.id"
              class="px-2 py-2 text-center font-medium transition-colors duration-150"
              :class="[
                ext.id === ownExtensionId ? 'text-blue-700' : 'text-gray-500',
                hoveredExtId === ext.id ? 'bg-gray-50' : '',
              ]"
              :title="ext.name || ext.id"
              @mouseenter="hoveredExtId = ext.id"
              @mouseleave="hoveredExtId = null"
            >
              <div class="flex flex-col items-center gap-1">
                <img
                  v-if="ext.iconUrl"
                  :src="ext.iconUrl"
                  :alt="ext.name || ext.id"
                  class="h-5 w-5 rounded"
                />
                <span
                  v-else
                  class="inline-flex h-5 w-5 items-center justify-center rounded bg-gray-200 text-[9px] font-bold text-gray-500"
                >
                  {{ (ext.name || ext.id).charAt(0).toUpperCase() }}
                </span>
                <span>{{ truncateName(ext.name || ext.id, 16) }}</span>
                <span v-if="ext.id === ownExtensionId" class="text-[10px] text-blue-400">(yours)</span>
                <span v-if="getBestPositionLabel(ext.id)" class="text-[9px] font-normal text-gray-400">
                  {{ getBestPositionLabel(ext.id) }}
                </span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="kw in keywords"
            :key="kw.id"
            class="border-b border-gray-50 transition-colors duration-100 hover:bg-gray-50/50"
          >
            <td class="py-1.5 pr-3 font-medium text-gray-700">{{ kw.text }}</td>
            <td
              v-for="ext in orderedExtensions"
              :key="ext.id"
              class="px-2 py-1.5 text-center transition-colors duration-150"
              :class="[
                getCellClasses(getPosition(kw.id, ext.id)),
                hoveredExtId === ext.id ? 'ring-1 ring-inset ring-blue-200' : '',
              ]"
              :title="`${ext.name || ext.id} — ${kw.text}: ${formatPosition(getPosition(kw.id, ext.id))}`"
              @mouseenter="hoveredExtId = ext.id"
              @mouseleave="hoveredExtId = null"
            >
              {{ formatPosition(getPosition(kw.id, ext.id)) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- Legend -->
    <div class="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
      <span class="font-medium">Legend:</span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-3 w-5 rounded bg-green-100"></span> Top 3
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-3 w-5 rounded bg-yellow-100"></span> Top 10
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-3 w-5 rounded bg-orange-100"></span> Top 20
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-3 w-5 rounded bg-red-100"></span> Top 30
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-3 w-5 rounded bg-gray-100"></span> 30+ / No data
      </span>
    </div>
  </div>
</template>
