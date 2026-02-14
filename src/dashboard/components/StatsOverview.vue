<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { loadRecentRankChanges, type RankChange } from '@/popup/composables/usePopupState';
import { useServiceWorker } from '../composables/useServiceWorker';
import { db } from '@/shared/db/database';

const { scanStatus } = useServiceWorker();

const rankChanges = ref<RankChange[]>([]);
const totalProjects = ref(0);
const totalExtensions = ref(0);
const totalKeywords = ref(0);
const loading = ref(true);

const improvements = computed(() =>
  rankChanges.value.filter((rc) => rc.change !== null && rc.change > 0)
);

const drops = computed(() =>
  rankChanges.value.filter((rc) => rc.change !== null && rc.change < 0)
);

const ownChanges = computed(() =>
  rankChanges.value.filter((rc) => rc.isOwn)
);

const competitorChanges = computed(() =>
  rankChanges.value.filter((rc) => !rc.isOwn)
);

function formatPosition(position: number | null): string {
  return position === null ? '30+' : `#${position}`;
}

async function loadStats(): Promise<void> {
  loading.value = true;
  try {
    const [changes, projects, extensions, keywords] = await Promise.all([
      loadRecentRankChanges(20),
      db.projects.count(),
      db.extensions.count(),
      db.keywords.count(),
    ]);
    rankChanges.value = changes;
    totalProjects.value = projects;
    totalExtensions.value = extensions;
    totalKeywords.value = keywords;
  } catch {
    rankChanges.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(loadStats);

// Reload after scan completes
watch(
  () => scanStatus.value.isRunning,
  (isRunning, wasRunning) => {
    if (wasRunning && !isRunning) {
      loadStats();
    }
  }
);
</script>

<template>
  <div v-if="!loading && rankChanges.length > 0" class="mb-8">
    <!-- Summary stat cards -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
      <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Changes</p>
        <p class="mt-1 text-2xl font-bold text-gray-900">{{ rankChanges.length }}</p>
        <p class="mt-0.5 text-xs text-gray-400">since last scan</p>
      </div>
      <div class="rounded-lg border border-green-200 bg-green-50 p-4 shadow-sm">
        <p class="text-xs font-medium text-green-700 uppercase tracking-wide">Improvements</p>
        <p class="mt-1 text-2xl font-bold text-green-700">{{ improvements.length }}</p>
        <p class="mt-0.5 text-xs text-green-600/70">positions gained</p>
      </div>
      <div class="rounded-lg border border-red-200 bg-red-50 p-4 shadow-sm">
        <p class="text-xs font-medium text-red-700 uppercase tracking-wide">Drops</p>
        <p class="mt-1 text-2xl font-bold text-red-700">{{ drops.length }}</p>
        <p class="mt-0.5 text-xs text-red-600/70">positions lost</p>
      </div>
      <div class="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
        <p class="text-xs font-medium text-blue-700 uppercase tracking-wide">Tracked</p>
        <p class="mt-1 text-2xl font-bold text-blue-700">{{ totalKeywords }}</p>
        <p class="mt-0.5 text-xs text-blue-600/70">{{ totalExtensions }} ext. &middot; {{ totalProjects }} proj.</p>
      </div>
    </div>

    <!-- Recent rank changes table -->
    <div class="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div class="border-b border-gray-100 px-4 py-3">
        <h3 class="text-sm font-semibold text-gray-900">Recent Rank Changes</h3>
      </div>

      <!-- Your Extensions -->
      <div v-if="ownChanges.length > 0">
        <div class="flex items-center gap-1.5 px-4 pt-3 pb-1">
          <span class="inline-block h-2 w-2 rounded-full bg-blue-500" />
          <span class="text-xs font-semibold text-blue-700">Your Extensions</span>
        </div>
        <div class="divide-y divide-gray-50">
          <div
            v-for="(rc, index) in ownChanges"
            :key="'own-' + index"
            class="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/50 transition-colors"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-blue-800 truncate">{{ rc.extensionName }}</p>
              <p class="text-xs text-gray-500 truncate">"{{ rc.keyword }}"</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-xs text-gray-400 tabular-nums">{{ formatPosition(rc.previousPosition) }}</span>
              <svg class="h-3 w-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
              <span class="text-xs font-semibold tabular-nums" :class="{
                'text-green-700': rc.change !== null && rc.change > 0,
                'text-red-700': rc.change !== null && rc.change < 0,
                'text-gray-600': rc.currentPosition === null,
              }">{{ formatPosition(rc.currentPosition) }}</span>
              <span
                v-if="rc.change !== null && rc.change > 0"
                class="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700"
              >
                <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 2L10 8H2L6 2Z" />
                </svg>
                {{ rc.change > 30 ? 'New' : '+' + rc.change }}
              </span>
              <span
                v-else-if="rc.change !== null && rc.change < 0"
                class="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700"
              >
                <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 10L2 4H10L6 10Z" />
                </svg>
                {{ rc.change < -30 ? 'Out' : Math.abs(rc.change) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Competitors -->
      <div v-if="competitorChanges.length > 0">
        <div class="flex items-center gap-1.5 px-4 pt-3 pb-1" :class="{ 'border-t border-gray-100': ownChanges.length > 0 }">
          <span class="inline-block h-2 w-2 rounded-full bg-gray-400" />
          <span class="text-xs font-semibold text-gray-500">Competitors</span>
        </div>
        <div class="divide-y divide-gray-50">
          <div
            v-for="(rc, index) in competitorChanges"
            :key="'comp-' + index"
            class="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-700 truncate">{{ rc.extensionName }}</p>
              <p class="text-xs text-gray-400 truncate">"{{ rc.keyword }}"</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-xs text-gray-400 tabular-nums">{{ formatPosition(rc.previousPosition) }}</span>
              <svg class="h-3 w-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
              <span class="text-xs font-semibold tabular-nums" :class="{
                'text-green-700': rc.change !== null && rc.change > 0,
                'text-red-700': rc.change !== null && rc.change < 0,
                'text-gray-600': rc.currentPosition === null,
              }">{{ formatPosition(rc.currentPosition) }}</span>
              <span
                v-if="rc.change !== null && rc.change > 0"
                class="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700"
              >
                <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 2L10 8H2L6 2Z" />
                </svg>
                {{ rc.change > 30 ? 'New' : '+' + rc.change }}
              </span>
              <span
                v-else-if="rc.change !== null && rc.change < 0"
                class="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700"
              >
                <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 10L2 4H10L6 10Z" />
                </svg>
                {{ rc.change < -30 ? 'Out' : Math.abs(rc.change) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- No changes fallback (shouldn't happen since we check length above) -->
      <div v-if="rankChanges.length === 0" class="px-4 py-6 text-center">
        <p class="text-sm text-gray-400">No rank changes detected</p>
      </div>
    </div>
  </div>
</template>
