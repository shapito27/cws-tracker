/**
 * Composable for the queue details page.
 *
 * Reads the queue straight from IndexedDB (the page needs real `Date`s, which
 * `chrome.runtime.sendMessage` would stringify) but sends every MUTATION to the
 * service worker, which owns the queue and the alarm chain.
 *
 * Stays fresh two ways: it reloads on scan progress messages from the worker,
 * and polls every few seconds while mounted (a worker message can be missed
 * when the dashboard was closed or the worker was asleep).
 */

import { ref, onMounted, onUnmounted } from 'vue';
import type { QueueJob } from '@/shared/types';
import type {
  DashboardMessage,
  QueueMutationResponse,
} from '@/shared/types/messages';
import type { QueueReorderDirection } from '@/shared/utils/queue-order';
import { db } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import { extensionIdsOf } from '@/shared/utils/queue-job-label';

export const QUEUE_POLL_INTERVAL_MS = 5000;

const RELOAD_ON: ReadonlySet<string> = new Set([
  'SCAN_PROGRESS',
  'SCAN_ERROR',
  'SCAN_COMPLETE',
]);

export function useQueueJobs() {
  const running = ref<QueueJob[]>([]);
  const pending = ref<QueueJob[]>([]);
  const finished = ref<QueueJob[]>([]);
  const extensionNames = ref<Map<string, string>>(new Map());
  const loading = ref(true);
  const error = ref<string | null>(null);
  const actionError = ref<string | null>(null);

  const settings = new SettingsManager();
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  // Overlapping loads (poll + message + post-mutation) can resolve out of
  // order; only the newest request may write state.
  let loadSeq = 0;

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    try {
      const active = await db.getActiveQueueJobs();
      const cycleStartedAt = await settings.get('scanCycleStartedAt');
      const done = await db.getFinishedJobsSince(
        cycleStartedAt ? new Date(cycleStartedAt) : null
      );

      const ids = extensionIdsOf([...active.running, ...active.pending, ...done]);
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const exts = await db.extensions.where('id').anyOf(ids).toArray();
        for (const ext of exts) names.set(ext.id, ext.name);
      }

      if (seq !== loadSeq) return;
      running.value = active.running;
      pending.value = active.pending;
      finished.value = done;
      extensionNames.value = names;
      error.value = null;
    } catch (err) {
      if (seq === loadSeq) error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (seq === loadSeq) loading.value = false;
    }
  }

  async function send(message: DashboardMessage): Promise<void> {
    actionError.value = null;
    try {
      const response = (await chrome.runtime.sendMessage(
        message
      )) as QueueMutationResponse | undefined;
      if (!response?.ok) {
        actionError.value = response?.error ?? 'The service worker did not respond';
      }
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : String(err);
    }
    await load();
  }

  function move(jobId: number, direction: QueueReorderDirection): Promise<void> {
    return send({ type: 'REORDER_QUEUE_JOB', jobId, direction });
  }

  function remove(jobId: number): Promise<void> {
    return send({ type: 'REMOVE_QUEUE_JOB', jobId });
  }

  function handleMessage(message: { type?: string }): void {
    if (message?.type && RELOAD_ON.has(message.type)) void load();
  }

  function start(): void {
    void load();
    chrome.runtime.onMessage.addListener(handleMessage);
    pollHandle = setInterval(() => void load(), QUEUE_POLL_INTERVAL_MS);
  }

  function stop(): void {
    chrome.runtime.onMessage.removeListener(handleMessage);
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  onMounted(start);
  onUnmounted(stop);

  return {
    running,
    pending,
    finished,
    extensionNames,
    loading,
    error,
    actionError,
    load,
    move,
    remove,
    handleMessage,
  };
}
