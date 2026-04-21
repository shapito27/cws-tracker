<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useServiceWorker } from '@/dashboard/composables/useServiceWorker';
import { phaseLabel, progressPercent } from '@/shared/utils/scan-phase';

const { scanStatus } = useServiceWorker();

const scanPhaseLabel = computed(() => phaseLabel(scanStatus.value.phase));

const progressWidth = computed(
  () =>
    `${progressPercent(
      scanStatus.value.completed,
      scanStatus.value.total,
      scanStatus.value.phase
    )}%`
);

const now = ref(Date.now());
let countdownHandle: ReturnType<typeof setInterval> | null = null;

function stopCountdown(): void {
  if (countdownHandle !== null) {
    clearInterval(countdownHandle);
    countdownHandle = null;
  }
}

watch(
  () =>
    scanStatus.value.phase === 'waiting' &&
    scanStatus.value.nextProcessingAt !== null,
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
  const nextAt = scanStatus.value.nextProcessingAt;
  if (nextAt === null) return null;
  const delta = Math.floor((new Date(nextAt).getTime() - now.value) / 1000);
  return Math.max(0, delta);
});
</script>

<template>
  <div
    v-if="scanStatus.isRunning"
    data-testid="scan-strip"
    class="sticky top-0 z-10 flex items-center gap-3 border-b border-blue-100 bg-blue-50 px-6 py-2 text-xs"
  >
    <span
      v-if="scanStatus.phase === 'running'"
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

    <span class="font-medium text-blue-700">{{ scanPhaseLabel }}</span>

    <span
      v-if="scanStatus.currentJob"
      class="hidden max-w-md truncate text-gray-700 md:inline"
      :title="scanStatus.currentJob"
    >
      · {{ scanStatus.currentJob }}
    </span>

    <div class="ml-auto flex items-center gap-3">
      <div class="h-1.5 w-40 rounded-full bg-blue-100">
        <div
          class="h-1.5 rounded-full bg-blue-600 transition-all"
          :style="{ width: progressWidth }"
        />
      </div>

      <span
        v-if="scanStatus.total > 1"
        data-testid="scan-counter"
        class="text-gray-600"
      >
        {{ scanStatus.completed }}/{{ scanStatus.total }}
      </span>

      <span
        v-if="scanStatus.phase === 'waiting' && countdownSeconds !== null"
        data-testid="scan-countdown"
        class="hidden text-gray-500 sm:inline"
      >
        · next in {{ countdownSeconds }}s
      </span>
    </div>
  </div>
</template>
