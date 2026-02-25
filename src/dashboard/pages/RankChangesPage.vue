<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { loadAllChanges, type RankChange, type ChangesDateGroup } from '@/popup/composables/usePopupState';
import ExtensionIcon from '../components/ExtensionIcon.vue';

const groups = ref<ChangesDateGroup[]>([]);
const loading = ref(true);

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(rc: RankChange): string {
  if (rc.scannedAt) {
    const d = rc.scannedAt instanceof Date ? rc.scannedAt : new Date(rc.scannedAt);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  }
  return '';
}

function formatPosition(rc: RankChange, position: number | null): string {
  if (rc.type === 'autocomplete') {
    return position === null ? '—' : `#${position}`;
  }
  return position === null ? '30+' : `#${position}`;
}

function isNew(rc: RankChange): boolean {
  return rc.change !== null && rc.change > (rc.type === 'autocomplete' ? 10 : 30);
}

function isOut(rc: RankChange): boolean {
  return rc.change !== null && rc.change < (rc.type === 'autocomplete' ? -10 : -30);
}

onMounted(async () => {
  loading.value = true;
  try {
    groups.value = await loadAllChanges();
  } catch {
    groups.value = [];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-6">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-6">
      <router-link
        :to="{ name: 'home' }"
        class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        Dashboard
      </router-link>
      <span class="text-gray-300">/</span>
      <h1 class="text-lg font-semibold text-gray-900">All Rank Changes</h1>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-16 text-gray-400 text-sm">
      Loading changes…
    </div>

    <!-- Empty state -->
    <div
      v-else-if="groups.length === 0"
      class="flex flex-col items-center justify-center py-20 text-center"
    >
      <svg class="h-10 w-10 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
      <p class="text-sm font-medium text-gray-600">No rank changes yet</p>
      <p class="text-xs text-gray-400 mt-1">Changes will appear here after at least two scans have run.</p>
    </div>

    <!-- Date groups -->
    <div v-else class="space-y-6">
      <div
        v-for="group in groups"
        :key="group.date"
        class="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden"
      >
        <!-- Date header -->
        <div class="border-b border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50">
          <span class="text-sm font-semibold text-gray-700">{{ formatDate(group.date) }}</span>
          <span class="text-xs text-gray-400">{{ group.changes.length }} change{{ group.changes.length !== 1 ? 's' : '' }}</span>
        </div>

        <!-- Change rows -->
        <div class="divide-y divide-gray-50">
          <div
            v-for="rc in group.changes"
            :key="`${rc.type}-${rc.extensionId}-${rc.keywordId}`"
            class="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
          >
            <ExtensionIcon :icon-url="rc.iconUrl" :name="rc.extensionName" size="sm" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <router-link
                  v-if="rc.projectId"
                  :to="{ name: 'project', params: { id: rc.projectId } }"
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
                <template v-if="formatTime(rc)">
                  <span class="text-gray-300">&middot;</span>
                  <span class="shrink-0">{{ formatTime(rc) }}</span>
                </template>
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
    </div>
  </div>
</template>
