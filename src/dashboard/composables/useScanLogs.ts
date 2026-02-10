/**
 * Composable for loading and filtering scan logs.
 *
 * Loads all recent scan logs from IndexedDB (max 500, 7-day retention keeps
 * volume small) and provides client-side filtering by level and job type.
 */

import { ref, computed } from 'vue';
import type { ScanLog, ScanLogLevel } from '@/shared/types';
import { db } from '@/shared/db/database';

const MAX_LOGS = 500;

/** A ScanLog that has been persisted and has a guaranteed id. */
export interface SavedScanLog extends ScanLog {
  id: number;
}

export interface LogStats {
  total: number;
  infoCount: number;
  warnCount: number;
  errorCount: number;
  avgDurationMs: number;
}

export function useScanLogs() {
  const logs = ref<SavedScanLog[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const filterLevel = ref<ScanLogLevel | 'all'>('all');
  const filterJobType = ref<string>('all');

  /** Unique job types present in the loaded data (for dynamic dropdown). */
  const jobTypes = computed<string[]>(() => {
    const types = new Set<string>();
    for (const log of logs.value) {
      types.add(log.jobType);
    }
    return [...types].sort();
  });

  const filteredLogs = computed<SavedScanLog[]>(() => {
    return logs.value.filter((log) => {
      if (filterLevel.value !== 'all' && log.level !== filterLevel.value) return false;
      if (filterJobType.value !== 'all' && log.jobType !== filterJobType.value) return false;
      return true;
    });
  });

  const stats = computed<LogStats>(() => {
    const all = filteredLogs.value;
    if (all.length === 0) {
      return { total: 0, infoCount: 0, warnCount: 0, errorCount: 0, avgDurationMs: 0 };
    }
    let infoCount = 0;
    let warnCount = 0;
    let errorCount = 0;
    let totalDuration = 0;
    for (const log of all) {
      if (log.level === 'info') infoCount++;
      else if (log.level === 'warn') warnCount++;
      else if (log.level === 'error') errorCount++;
      totalDuration += log.durationMs;
    }
    return {
      total: all.length,
      infoCount,
      warnCount,
      errorCount,
      avgDurationMs: Math.round(totalDuration / all.length),
    };
  });

  async function loadLogs(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const raw = await db.getRecentScanLogs(MAX_LOGS);
      // Filter to only logs with a persisted id (should always be the case)
      logs.value = raw.filter((l): l is SavedScanLog => l.id !== undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error.value = msg;
      console.error('Failed to load scan logs:', e);
      logs.value = [];
    } finally {
      loading.value = false;
    }
  }

  return {
    logs,
    loading,
    error,
    filterLevel,
    filterJobType,
    jobTypes,
    filteredLogs,
    stats,
    loadLogs,
  };
}
