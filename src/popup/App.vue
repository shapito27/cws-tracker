<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { usePopupState } from './composables/usePopupState';
import { phaseLabel } from '@/shared/utils/scan-phase';
import iconUrl from '@/assets/icon-48.png';
import ExtensionIcon from '@/dashboard/components/ExtensionIcon.vue';

const {
  scanStatus,
  scanProgress,
  progressPercent,
  lastScanDate,
  rankChanges,
  subscriptionStatus,
  isPaused,
  showScanNudge,
  openDashboard,
  requestRefresh,
  requestPause,
  requestResume,
} = usePopupState();

const ownChanges = computed(() => rankChanges.value.filter((rc) => rc.isOwn));
const competitorChanges = computed(() => rankChanges.value.filter((rc) => !rc.isOwn));

const scanPhaseLabel = computed(() => phaseLabel(scanProgress.value.phase));

// Live-tick for the "Next in Ns" countdown during phase 'waiting'.
const now = ref(Date.now());
let countdownHandle: ReturnType<typeof setInterval> | null = null;

function stopCountdown(): void {
  if (countdownHandle !== null) {
    clearInterval(countdownHandle);
    countdownHandle = null;
  }
}

watch(
  () => scanProgress.value.phase === 'waiting' && scanProgress.value.nextProcessingAt !== null,
  (active) => {
    if (active && countdownHandle === null) {
      now.value = Date.now();
      countdownHandle = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    } else if (!active) {
      stopCountdown();
    }
  },
  { immediate: true }
);

onUnmounted(stopCountdown);

const countdownSeconds = computed<number | null>(() => {
  const nextAt = scanProgress.value.nextProcessingAt;
  if (nextAt === null) return null;
  const delta = Math.floor((new Date(nextAt).getTime() - now.value) / 1000);
  return Math.max(0, delta);
});

function formatPosition(position: number | null): string {
  return position === null ? '30+' : String(position);
}

// Optimistic update: toggles immediately for responsiveness. If the SW
// doesn't receive the message, state resyncs on next popup open via
// init() which reloads the actual dailyScanEnabled setting from storage.
function togglePause(): void {
  if (isPaused.value) {
    requestResume();
    isPaused.value = false;
  } else {
    requestPause();
    isPaused.value = true;
  }
}
</script>

<template>
  <div class="p-4">
    <!-- Header -->
    <div class="flex items-center gap-2 mb-3">
      <img :src="iconUrl" alt="CWS Tracker" class="h-6 w-6 rounded" />
      <h1 class="text-lg font-bold text-gray-900">CWS Tracker</h1>
      <span v-if="subscriptionStatus === 'pro'" class="ml-auto inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
        Pro
      </span>
    </div>

    <!-- Scan Status -->
    <div class="rounded-lg bg-gray-50 p-3 mb-3">
      <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
        Scan Status
      </p>

      <!-- Idle state -->
      <div v-if="scanStatus === 'idle'">
        <p class="text-sm font-medium text-gray-700">
          Idle
        </p>
        <p v-if="lastScanDate" class="text-xs text-gray-500 mt-0.5">
          Last scan: {{ lastScanDate }}
        </p>
        <p v-else class="text-xs text-gray-400 mt-0.5">
          No scans yet
        </p>
      </div>

      <!-- Running state with progress -->
      <div v-if="scanStatus === 'running'">
        <div class="flex items-center gap-1.5">
          <span
            v-if="scanProgress.phase === 'running'"
            class="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600"
            aria-hidden="true"
          />
          <svg
            v-else
            class="h-3 w-3 animate-spin text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p class="text-sm font-medium text-blue-700">{{ scanPhaseLabel }}</p>
        </div>
        <div class="mt-1.5">
          <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span class="truncate" :title="scanProgress.currentJob">
              {{ scanProgress.currentJob || '—' }}
            </span>
            <span>{{ progressPercent }}%</span>
          </div>
          <div class="h-1.5 w-full rounded-full bg-gray-200">
            <div
              class="h-1.5 rounded-full bg-blue-600 transition-all duration-300"
              :style="{ width: progressPercent + '%' }"
            />
          </div>
          <p class="text-xs text-gray-400 mt-1">
            <template v-if="scanProgress.total > 1">
              {{ scanProgress.completed }} / {{ scanProgress.total }} jobs
            </template>
            <template v-else-if="scanProgress.total === 1">
              Single job
            </template>
            <span
              v-if="scanProgress.phase === 'waiting' && countdownSeconds !== null"
              class="ml-2"
            >
              · Next in {{ countdownSeconds }}s
            </span>
          </p>
        </div>
      </div>
    </div>

    <!-- Free tier nudge -->
    <div
      v-if="showScanNudge"
      class="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-3"
    >
      <p class="text-xs font-medium text-amber-800">
        <template v-if="lastScanDate">
          Last scanned {{ lastScanDate }}
        </template>
        <template v-else>
          You haven't run a scan yet
        </template>
      </p>
      <button
        class="mt-2 w-full rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
        @click="requestRefresh"
      >
        Refresh Now
      </button>
    </div>

    <!-- Rank Changes -->
    <div class="mb-3">
      <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        Recent Rank Changes
      </p>

      <!-- Empty state -->
      <div v-if="rankChanges.length === 0" class="rounded-lg bg-gray-50 p-3">
        <p class="text-xs text-gray-400 text-center">
          No rank changes detected
        </p>
      </div>

      <div v-else class="space-y-2">
        <!-- Your Extensions group -->
        <div v-if="ownChanges.length > 0">
          <div class="flex items-center gap-1.5 mb-1">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
            <span class="text-xs font-semibold text-blue-700">Your Extensions</span>
          </div>
          <div class="space-y-1">
            <div
              v-for="(rc, index) in ownChanges"
              :key="'own-' + index"
              class="flex items-center justify-between rounded-md bg-blue-50 border border-blue-100 px-2.5 py-2"
            >
              <ExtensionIcon :icon-url="rc.iconUrl" :name="rc.extensionName" size="xs" />
              <div class="min-w-0 flex-1 mx-2">
                <p class="text-xs font-semibold text-blue-800 truncate">
                  {{ rc.extensionName }}
                </p>
                <p class="text-xs text-blue-600/70 truncate">
                  "{{ rc.keyword }}"
                </p>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <span class="text-xs text-gray-400">
                  {{ formatPosition(rc.previousPosition) }}
                </span>
                <span class="text-xs text-gray-300">&rarr;</span>
                <span class="text-xs font-medium">
                  {{ formatPosition(rc.currentPosition) }}
                </span>
                <span
                  v-if="rc.change !== null && rc.change > 0"
                  class="inline-flex items-center text-xs font-medium text-green-600"
                  :title="'Improved by ' + rc.change + ' positions'"
                >
                  <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M6 2L10 8H2L6 2Z" />
                  </svg>
                  {{ rc.change > 30 ? 'New' : rc.change }}
                </span>
                <span
                  v-else-if="rc.change !== null && rc.change < 0"
                  class="inline-flex items-center text-xs font-medium text-red-600"
                  :title="'Dropped by ' + Math.abs(rc.change) + ' positions'"
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

        <!-- Competitors group -->
        <div v-if="competitorChanges.length > 0">
          <div class="flex items-center gap-1.5 mb-1">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-gray-400" />
            <span class="text-xs font-semibold text-gray-500">Competitors</span>
          </div>
          <div class="space-y-1">
            <div
              v-for="(rc, index) in competitorChanges"
              :key="'comp-' + index"
              class="flex items-center justify-between rounded-md bg-gray-50 px-2.5 py-2"
            >
              <ExtensionIcon :icon-url="rc.iconUrl" :name="rc.extensionName" size="xs" />
              <div class="min-w-0 flex-1 mx-2">
                <p class="text-xs font-medium text-gray-700 truncate">
                  {{ rc.extensionName }}
                </p>
                <p class="text-xs text-gray-400 truncate">
                  "{{ rc.keyword }}"
                </p>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <span class="text-xs text-gray-400">
                  {{ formatPosition(rc.previousPosition) }}
                </span>
                <span class="text-xs text-gray-300">&rarr;</span>
                <span class="text-xs font-medium text-gray-600">
                  {{ formatPosition(rc.currentPosition) }}
                </span>
                <span
                  v-if="rc.change !== null && rc.change > 0"
                  class="inline-flex items-center text-xs font-medium text-green-600"
                  :title="'Improved by ' + rc.change + ' positions'"
                >
                  <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M6 2L10 8H2L6 2Z" />
                  </svg>
                  {{ rc.change > 30 ? 'New' : rc.change }}
                </span>
                <span
                  v-else-if="rc.change !== null && rc.change < 0"
                  class="inline-flex items-center text-xs font-medium text-red-600"
                  :title="'Dropped by ' + Math.abs(rc.change) + ' positions'"
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
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="space-y-2">
      <button
        class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        @click="openDashboard"
      >
        Open Dashboard
      </button>
      <div class="flex gap-2">
        <button
          class="flex-1 rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200"
          :disabled="scanStatus === 'running'"
          @click="requestRefresh"
        >
          Refresh Now
        </button>
        <button
          class="flex-1 rounded-lg px-3 py-2 text-xs font-medium"
          :class="isPaused
            ? 'bg-green-50 text-green-700 hover:bg-green-100'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
          @click="togglePause"
        >
          {{ isPaused ? 'Resume' : 'Pause' }}
        </button>
      </div>
    </div>

  </div>
</template>
