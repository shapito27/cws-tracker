<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import {
  loadRecentRankChanges,
  loadRecentAutocompleteChanges,
  AC_APPEARED_SENTINEL,
  AC_DISAPPEARED_SENTINEL,
  type RankChange,
} from '@/popup/composables/usePopupState';
import { useServiceWorker } from '../composables/useServiceWorker';
import ExtensionIcon from './ExtensionIcon.vue';

const { scanStatus } = useServiceWorker();

const rankChanges = ref<RankChange[]>([]);
const loading = ref(true);

function formatPosition(rc: RankChange, position: number | null): string {
  if (rc.type === 'autocomplete') {
    return position === null ? '—' : `#${position}`;
  }
  return position === null ? '30+' : `#${position}`;
}

function formatDateTime(rc: RankChange): string {
  if (rc.scannedAt) {
    const d = rc.scannedAt instanceof Date ? rc.scannedAt : new Date(rc.scannedAt);
    if (!isNaN(d.getTime())) {
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `${dateStr}, ${timeStr}`;
    }
  }
  const d = new Date(rc.date + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isNew(rc: RankChange): boolean {
  if (rc.type === 'autocomplete') return rc.change === AC_APPEARED_SENTINEL;
  return rc.change !== null && rc.change > 30;
}

function isOut(rc: RankChange): boolean {
  if (rc.type === 'autocomplete') return rc.change === AC_DISAPPEARED_SENTINEL;
  return rc.change !== null && rc.change < -30;
}

async function loadData(): Promise<void> {
  loading.value = true;
  try {
    const [rankResults, autocompleteResults] = await Promise.all([
      loadRecentRankChanges(20, true),
      loadRecentAutocompleteChanges(20, true),
    ]);

    // Merge and sort by magnitude (loaders already filtered to own extension only)
    const combined = [...rankResults, ...autocompleteResults];
    combined.sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));

    rankChanges.value = combined.slice(0, 20);
  } catch {
    rankChanges.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);

// Reload after scan completes
watch(
  () => scanStatus.value.isRunning,
  (isRunning, wasRunning) => {
    if (wasRunning && !isRunning) {
      loadData();
    }
  }
);
</script>

<template>
  <div v-if="!loading && rankChanges.length > 0" class="rounded-lg border border-gray-200 bg-white shadow-sm">
    <div class="border-b border-gray-100 px-4 py-3 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-gray-900">Your Rank Changes</h3>
      <router-link
        :to="{ name: 'rankChanges' }"
        class="text-xs text-blue-600 hover:text-blue-700 hover:underline"
      >View all</router-link>
    </div>

    <div class="divide-y divide-gray-50">
      <div
        v-for="rc in rankChanges"
        :key="`${rc.type}-${rc.extensionId}-${rc.keywordId}-${rc.date}`"
        class="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <ExtensionIcon :icon-url="rc.iconUrl" :name="rc.extensionName" size="sm" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <router-link
              v-if="rc.projectId"
              :to="{ name: 'project', params: { id: String(rc.projectId) } }"
              class="text-sm font-medium text-gray-900 truncate hover:text-blue-600 hover:underline"
            >{{ rc.extensionName }}</router-link>
            <span v-else class="text-sm font-medium text-gray-900 truncate">{{ rc.extensionName }}</span>
          </div>
          <div class="flex items-center gap-1.5 text-xs text-gray-500">
            <span
              v-if="rc.type === 'autocomplete'"
              class="inline-flex items-center rounded px-1 py-px text-[10px] font-semibold bg-indigo-100 text-indigo-700 shrink-0"
            >AC</span>
            <span class="truncate">"{{ rc.keyword }}"</span>
            <span class="text-gray-300">&middot;</span>
            <span class="shrink-0">{{ formatDateTime(rc) }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-xs text-gray-400 tabular-nums">{{ formatPosition(rc, rc.previousPosition) }}</span>
          <svg class="h-3 w-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
          <span class="text-xs font-semibold tabular-nums" :class="{
            'text-green-700': rc.change !== null && rc.change > 0,
            'text-red-700': rc.change !== null && rc.change < 0,
            'text-gray-600': rc.currentPosition === null,
          }">{{ formatPosition(rc, rc.currentPosition) }}</span>
          <span
            v-if="rc.change !== null && rc.change > 0"
            class="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700"
          >
            <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 2L10 8H2L6 2Z" />
            </svg>
            {{ isNew(rc) ? 'New' : '+' + rc.change }}
          </span>
          <span
            v-else-if="rc.change !== null && rc.change < 0"
            class="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700"
          >
            <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 10L2 4H10L6 10Z" />
            </svg>
            {{ isOut(rc) ? 'Out' : Math.abs(rc.change) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
