/**
 * Composable for communicating with the service worker.
 *
 * Listens for messages from the SW and exposes reactive state
 * for scan progress, status, and queue stats. Provides methods
 * to send commands (refresh, pause, resume, cancel) to the SW.
 */

import { ref, onMounted, onUnmounted } from 'vue';
import type {
  ServiceWorkerMessage,
  ScanProgressMessage,
  ScanCompleteMessage,
  QueueStatusMessage,
  ScanType,
  ScanPhase,
} from '@/shared/types';

export interface ScanStatus {
  isRunning: boolean;
  completed: number;
  total: number;
  currentJob: string;
  nextProcessingAt: string | null;
  phase: ScanPhase;
  lastScanDate: string | null;
  lastJobsCompleted: number;
  lastJobsFailed: number;
  lastError: string | null;
}

export function useServiceWorker() {
  const scanProgress = ref<ScanProgressMessage | null>(null);
  const lastScanStatus = ref<ScanCompleteMessage | null>(null);
  const queueStats = ref<QueueStatusMessage | null>(null);
  const scanStatus = ref<ScanStatus>({
    isRunning: false,
    completed: 0,
    total: 0,
    currentJob: '',
    nextProcessingAt: null,
    phase: 'running',
    lastScanDate: null,
    lastJobsCompleted: 0,
    lastJobsFailed: 0,
    lastError: null,
  });

  function handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const msg = message as ServiceWorkerMessage;

    switch (msg.type) {
      case 'SCAN_PROGRESS':
        scanProgress.value = msg;
        scanStatus.value = {
          ...scanStatus.value,
          isRunning: true,
          completed: msg.completed,
          total: msg.total,
          currentJob: msg.currentJob,
          nextProcessingAt: msg.nextProcessingAt ?? null,
          phase: msg.phase ?? 'running',
          lastError: null,
        };
        break;
      case 'SCAN_COMPLETE':
        lastScanStatus.value = msg;
        scanStatus.value = {
          ...scanStatus.value,
          isRunning: false,
          completed: 0,
          total: 0,
          currentJob: '',
          nextProcessingAt: null,
          phase: 'running',
          lastScanDate: msg.date,
          lastJobsCompleted: msg.jobsCompleted,
          lastJobsFailed: msg.jobsFailed,
          lastError: null,
        };
        scanProgress.value = null;
        break;
      case 'QUEUE_STATUS':
        queueStats.value = msg;
        break;
      case 'SCAN_ERROR':
        scanStatus.value = {
          ...scanStatus.value,
          lastError: msg.error,
        };
        break;
      case 'NEW_EVENT':
        // Can be handled by specific page listeners
        break;
    }
  }

  let listenerRegistered = false;

  function startListening(): void {
    if (listenerRegistered) return;
    try {
      chrome.runtime.onMessage.addListener(handleMessage);
      listenerRegistered = true;
    } catch {
      // chrome API may not be available in tests
    }
  }

  function stopListening(): void {
    if (!listenerRegistered) return;
    try {
      chrome.runtime.onMessage.removeListener(handleMessage);
      listenerRegistered = false;
    } catch {
      // chrome API may not be available in tests
    }
  }

  onMounted(startListening);
  onUnmounted(stopListening);

  async function sendToServiceWorker(message: unknown): Promise<void> {
    try {
      await chrome.runtime.sendMessage(message);
    } catch {
      // SW may not be active - fail silently per architecture rules
    }
  }

  async function requestRefresh(
    projectId?: number,
    scanType: ScanType = 'full'
  ): Promise<void> {
    await sendToServiceWorker({
      type: 'TRIGGER_REFRESH',
      ...(projectId !== undefined ? { projectId } : {}),
      ...(scanType !== 'full' ? { scanType } : {}),
    });
  }

  async function requestPause(): Promise<void> {
    await sendToServiceWorker({ type: 'PAUSE_SCAN' });
  }

  async function requestResume(): Promise<void> {
    await sendToServiceWorker({ type: 'RESUME_SCAN' });
  }

  async function requestCancel(): Promise<void> {
    await sendToServiceWorker({ type: 'CANCEL_SCAN' });
  }

  /** Re-scan a single keyword's search rank without clearing the queue. */
  async function requestKeywordRescan(keywordId: number): Promise<void> {
    await sendToServiceWorker({ type: 'RESCAN_KEYWORD', keywordId });
  }

  return {
    scanProgress,
    lastScanStatus,
    queueStats,
    scanStatus,
    requestRefresh,
    requestPause,
    requestResume,
    requestCancel,
    requestKeywordRescan,
    // Exposed for testing
    handleMessage,
    startListening,
    stopListening,
  };
}
