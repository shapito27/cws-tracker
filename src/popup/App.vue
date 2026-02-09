<script setup lang="ts">
import { usePopupState } from './composables/usePopupState';

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
    <h1 class="text-lg font-bold text-gray-900 mb-3">CWS Tracker</h1>

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
        <p class="text-sm font-medium text-blue-700">
          Scanning...
        </p>
        <div class="mt-1.5">
          <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{{ scanProgress.currentJob }}</span>
            <span>{{ progressPercent }}%</span>
          </div>
          <div class="h-1.5 w-full rounded-full bg-gray-200">
            <div
              class="h-1.5 rounded-full bg-blue-600 transition-all duration-300"
              :style="{ width: progressPercent + '%' }"
            />
          </div>
          <p class="text-xs text-gray-400 mt-1">
            {{ scanProgress.completed }} / {{ scanProgress.total }} jobs
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

      <!-- Changes list -->
      <div v-else class="space-y-1.5">
        <div
          v-for="(rc, index) in rankChanges"
          :key="index"
          class="flex items-center justify-between rounded-md bg-gray-50 px-2.5 py-2"
        >
          <div class="min-w-0 flex-1 mr-2">
            <p class="text-xs truncate" :class="rc.isOwn ? 'font-semibold text-blue-700' : 'font-medium text-gray-800'">
              {{ rc.extensionName }}
              <span
                v-if="rc.isOwn"
                class="ml-1 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 align-middle"
              >Own</span>
            </p>
            <p class="text-xs text-gray-500 truncate">
              "{{ rc.keyword }}"
            </p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="text-xs text-gray-400">
              {{ formatPosition(rc.previousPosition) }}
            </span>
            <span class="text-xs text-gray-300">&rarr;</span>
            <span class="text-xs font-medium" :class="{
              'text-gray-600': rc.currentPosition === null,
            }">
              {{ formatPosition(rc.currentPosition) }}
            </span>
            <!-- Change indicator -->
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

    <!-- Subscription badge -->
    <div v-if="subscriptionStatus === 'pro'" class="mt-3 text-center">
      <span class="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
        Pro
      </span>
    </div>
  </div>
</template>
