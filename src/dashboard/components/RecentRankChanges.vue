<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import {
  loadRecentRankChanges,
  loadRecentAutocompleteChanges,
  type RankChange,
} from '@/popup/composables/usePopupState';
import { useServiceWorker } from '../composables/useServiceWorker';
import { useProxyStatus } from '../composables/useProxyStatus';
import RankChangeItem from './RankChangeItem.vue';

const { scanStatus, requestKeywordRescan } = useServiceWorker();
const { proxyConfigured } = useProxyStatus();

const rankChanges = ref<RankChange[]>([]);
const loading = ref(true);

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
      <RankChangeItem
        v-for="rc in rankChanges"
        :key="`${rc.type}-${rc.extensionId}-${rc.keywordId}-${rc.date}`"
        :rank-change="rc"
        :link-to-project="true"
        :show-date="true"
        :allow-rescan="proxyConfigured"
        :scan-running="scanStatus.isRunning"
        @rescan="requestKeywordRescan"
      />
    </div>
  </div>
</template>
