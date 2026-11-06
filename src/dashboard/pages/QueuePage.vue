<script setup lang="ts">
import { computed, ref } from 'vue';
import type { QueueJob } from '@/shared/types';
import { useQueueJobs } from '../composables/useQueueJobs';
import { describeQueueJob } from '@/shared/utils/queue-job-label';
import { isInBackoff } from '@/shared/utils/queue-order';
import { formatDateTimeShort } from '@/shared/utils/dates';

const {
  running,
  pending,
  finished,
  extensionNames,
  loading,
  error,
  actionError,
  move,
  remove,
} = useQueueJobs();

const showFinished = ref(false);

const isEmpty = computed(
  () => running.value.length === 0 && pending.value.length === 0
);

/** The first pending job the processor can actually pick right now. */
const nextJobId = computed<number | null>(() => {
  const now = new Date();
  return pending.value.find((j) => !isInBackoff(j, now))?.id ?? null;
});

function label(job: QueueJob): { kind: string; target: string } {
  return describeQueueJob(job, extensionNames.value);
}

function scheduledText(job: QueueJob): string {
  if (isInBackoff(job)) {
    const mins = Math.max(1, Math.ceil((job.scheduledAt.getTime() - Date.now()) / 60_000));
    return `retrying in ${mins}m`;
  }
  return formatDateTimeShort(job.scheduledAt);
}

function cycleText(job: QueueJob): string {
  if (!job.cycleDate) return '—';
  return job.slot !== undefined ? `${job.cycleDate} · slot ${job.slot}` : job.cycleDate;
}

function heartbeatText(job: QueueJob): string {
  const at = job.heartbeatAt ?? job.startedAt;
  if (!at) return '—';
  const secs = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  return `${secs}s ago`;
}
</script>

<template>
  <div class="mx-auto max-w-6xl p-6">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-xl font-semibold text-gray-900">Job queue</h2>
      <span class="text-xs text-gray-500">
        {{ running.length }} running · {{ pending.length }} pending
      </span>
    </div>

    <p v-if="error" class="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </p>
    <p
      v-if="actionError"
      data-testid="queue-action-error"
      class="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      {{ actionError }}
    </p>

    <p v-if="loading" class="text-sm text-gray-500">Loading…</p>
    <p
      v-else-if="isEmpty"
      data-testid="queue-empty"
      class="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500"
    >
      Queue is empty
    </p>

    <template v-else>
      <!-- Running -->
      <section v-if="running.length > 0" class="mb-6">
        <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Running</h3>
        <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table class="w-full text-left text-sm">
            <tbody>
              <tr
                v-for="job in running"
                :key="job.id"
                data-testid="queue-running-row"
                class="bg-blue-50"
              >
                <td class="px-3 py-2 font-medium text-blue-700">{{ label(job).kind }}</td>
                <td class="px-3 py-2 text-gray-800">{{ label(job).target }}</td>
                <td class="px-3 py-2 text-gray-600">
                  attempt {{ job.retryCount + 1 }}/{{ job.maxRetries + 1 }}
                </td>
                <td class="px-3 py-2 text-gray-600">{{ cycleText(job) }}</td>
                <td class="px-3 py-2 text-gray-500">heartbeat {{ heartbeatText(job) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Up next -->
      <section class="mb-6">
        <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Up next</h3>
        <p v-if="pending.length === 0" class="text-sm text-gray-500">No pending jobs.</p>
        <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th class="px-3 py-2">#</th>
                <th class="px-3 py-2">Type</th>
                <th class="px-3 py-2">Target</th>
                <th class="px-3 py-2">Scheduled</th>
                <th class="px-3 py-2">Attempts</th>
                <th class="px-3 py-2">Last error</th>
                <th class="px-3 py-2">Cycle</th>
                <th class="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr
                v-for="(job, index) in pending"
                :key="job.id"
                data-testid="queue-pending-row"
              >
                <td class="px-3 py-2 text-gray-500">
                  {{ index + 1 }}
                  <span
                    v-if="job.id === nextJobId"
                    class="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700"
                  >
                    next
                  </span>
                </td>
                <td class="px-3 py-2 font-medium text-gray-800">{{ label(job).kind }}</td>
                <td class="px-3 py-2 text-gray-800">{{ label(job).target }}</td>
                <td class="px-3 py-2" :class="isInBackoff(job) ? 'text-amber-700' : 'text-gray-600'">
                  {{ scheduledText(job) }}
                </td>
                <td class="px-3 py-2 text-gray-600">{{ job.retryCount }}/{{ job.maxRetries }}</td>
                <td class="max-w-xs truncate px-3 py-2 text-red-600" :title="job.error ?? ''">
                  {{ job.error ?? '—' }}
                </td>
                <td class="px-3 py-2 text-gray-600">{{ cycleText(job) }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <button
                    type="button"
                    data-testid="queue-move-top"
                    class="rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="index === 0"
                    @click="move(job.id!, 'top')"
                  >
                    Top
                  </button>
                  <button
                    type="button"
                    data-testid="queue-move-up"
                    class="rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="index === 0"
                    @click="move(job.id!, 'up')"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    data-testid="queue-move-bottom"
                    class="rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="index === pending.length - 1"
                    @click="move(job.id!, 'bottom')"
                  >
                    Bottom
                  </button>
                  <button
                    type="button"
                    data-testid="queue-remove"
                    class="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    @click="remove(job.id!)"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-xs text-gray-500">
          A job waiting to retry keeps its wait even if moved to the top. "Refresh Now"
          rebuilds the queue and discards manual ordering.
        </p>
      </section>
    </template>

    <!-- Finished this cycle -->
    <section v-if="finished.length > 0">
      <button
        type="button"
        data-testid="queue-toggle-finished"
        class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700"
        @click="showFinished = !showFinished"
      >
        {{ showFinished ? '▾' : '▸' }} Finished this cycle ({{ finished.length }})
      </button>
      <div
        v-if="showFinished"
        class="overflow-x-auto rounded-lg border border-gray-200 bg-white"
      >
        <table class="w-full text-left text-sm">
          <tbody class="divide-y divide-gray-100">
            <tr v-for="job in finished" :key="job.id" data-testid="queue-finished-row">
              <td class="px-3 py-2 font-medium text-gray-800">{{ label(job).kind }}</td>
              <td class="px-3 py-2 text-gray-800">{{ label(job).target }}</td>
              <td
                class="px-3 py-2"
                :class="job.status === 'failed' ? 'text-red-600' : 'text-green-700'"
              >
                {{ job.status }}
              </td>
              <td class="max-w-xs truncate px-3 py-2 text-red-600" :title="job.error ?? ''">
                {{ job.error ?? '' }}
              </td>
              <td class="px-3 py-2 text-gray-500">
                {{ job.completedAt ? formatDateTimeShort(job.completedAt) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
