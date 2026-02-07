/**
 * Composable for loading listing snapshot history for own extensions.
 *
 * Used by the ExtensionsOverviewTable on the HomePage to show
 * daily user count and review count trends across all projects.
 */

import { ref, computed } from 'vue';
import type { Extension, ListingSnapshot } from '@/shared/types';
import { db } from '@/shared/db/database';
import { today, daysAgo } from '@/shared/utils/dates';

/** A single day's data for one extension. */
export interface DayCell {
  users: number;
  reviews: number;
  /** Delta vs previous day. null if no previous day data. */
  usersDelta: number | null;
  reviewsDelta: number | null;
}

/** One row in the overview table. */
export interface ExtensionRow {
  extensionId: string;
  name: string;
  iconUrl: string | null;
  projectName: string;
  /** Map of date (YYYY-MM-DD) -> DayCell */
  days: Map<string, DayCell>;
}

export type DateRange = 7 | 14 | 30;

export function useExtensionSnapshots() {
  const rows = ref<ExtensionRow[]>([]);
  const loading = ref(false);
  const dateRange = ref<DateRange>(7);

  /** Sorted date strings for the selected range. */
  const dateColumns = computed<string[]>(() => {
    const dates: string[] = [];
    for (let i = dateRange.value - 1; i >= 0; i--) {
      dates.push(daysAgo(i));
    }
    return dates;
  });

  async function loadSnapshots(): Promise<void> {
    loading.value = true;
    try {
      const projects = await db.getAllProjects();
      if (projects.length === 0) {
        rows.value = [];
        return;
      }

      // Collect unique own extension IDs with their project names
      const ownExtensions = new Map<string, string>();
      for (const project of projects) {
        if (!ownExtensions.has(project.ownExtensionId)) {
          ownExtensions.set(project.ownExtensionId, project.name);
        }
      }

      const startDate = daysAgo(dateRange.value);
      const endDate = today();
      const newRows: ExtensionRow[] = [];

      for (const [extId, projectName] of ownExtensions) {
        const ext = await db.getExtension(extId);
        if (!ext) continue;

        const snapshots = await db.getListingSnapshots(extId, startDate, endDate);

        // Build a map of date -> snapshot (take latest if multiple per day)
        const byDate = new Map<string, ListingSnapshot>();
        for (const snap of snapshots) {
          const existing = byDate.get(snap.date);
          if (!existing || snap.scannedAt > existing.scannedAt) {
            byDate.set(snap.date, snap);
          }
        }

        // Build day cells with deltas
        const days = new Map<string, DayCell>();
        const allDates = dateColumns.value;

        for (let i = 0; i < allDates.length; i++) {
          const date = allDates[i];
          const snap = byDate.get(date);
          if (!snap) continue;

          // Find previous day's snapshot (look backwards through visible dates,
          // then fall back to the day-before-range for the first column)
          let prevSnap: ListingSnapshot | undefined;
          for (let j = i - 1; j >= 0; j--) {
            prevSnap = byDate.get(allDates[j]);
            if (prevSnap) break;
          }
          if (!prevSnap) {
            prevSnap = byDate.get(daysAgo(dateRange.value));
          }

          days.set(date, {
            users: snap.userCountNumeric,
            reviews: snap.reviewCount,
            usersDelta: prevSnap ? snap.userCountNumeric - prevSnap.userCountNumeric : null,
            reviewsDelta: prevSnap ? snap.reviewCount - prevSnap.reviewCount : null,
          });
        }

        newRows.push({
          extensionId: extId,
          name: ext.name || extId,
          iconUrl: ext.iconUrl,
          projectName,
          days,
        });
      }

      newRows.sort((a, b) => {
        const projectCmp = a.projectName.localeCompare(b.projectName);
        if (projectCmp !== 0) return projectCmp;
        return a.name.localeCompare(b.name);
      });

      rows.value = newRows;
    } catch (e) {
      console.error('Failed to load extension snapshots:', e);
      rows.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function setDateRange(range: DateRange): Promise<void> {
    dateRange.value = range;
    await loadSnapshots();
  }

  return {
    rows,
    loading,
    dateRange,
    dateColumns,
    loadSnapshots,
    setDateRange,
  };
}
