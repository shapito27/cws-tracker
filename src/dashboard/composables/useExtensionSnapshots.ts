/**
 * Composable for loading listing snapshot history for own extensions.
 *
 * Used by the ExtensionsOverviewTable on the HomePage to show
 * user count and review count trends across all projects, either
 * day-by-day (Daily) or week-by-week (Weekly).
 */

import { ref, computed } from 'vue';
import type { ListingSnapshot } from '@/shared/types';
import { db } from '@/shared/db/database';
import { today, daysAgo } from '@/shared/utils/dates';
import { deduplicateByDate } from '@/shared/utils/snapshot-dedup';

/** A single column's data for one extension. */
export interface DayCell {
  users: number;
  reviews: number;
  /** Delta vs previous visible column. null if no previous data. */
  usersDelta: number | null;
  reviewsDelta: number | null;
}

/** One row in the overview table. */
export interface ExtensionRow {
  extensionId: string;
  name: string;
  iconUrl: string | null;
  projectId: number;
  projectName: string;
  /** Map of date (YYYY-MM-DD) -> DayCell */
  days: Map<string, DayCell>;
}

export type StepMode = 'daily' | 'weekly';
/** Total days in the visible window. Daily: 7/14/30. Weekly: 28/84/182. */
export type RangeDays = 7 | 14 | 30 | 28 | 84 | 182;

const DAILY_RANGES: RangeDays[] = [7, 14, 30];
const WEEKLY_RANGES: RangeDays[] = [28, 84, 182];

export function useExtensionSnapshots() {
  const rows = ref<ExtensionRow[]>([]);
  const loading = ref(false);
  const step = ref<StepMode>('daily');
  const rangeDays = ref<RangeDays>(7);

  const stepSize = computed<number>(() => (step.value === 'weekly' ? 7 : 1));

  /** Sorted date strings for the selected range, oldest first, today last. */
  const dateColumns = computed<string[]>(() => {
    const dates: string[] = [];
    for (let i = 0; i < rangeDays.value; i += stepSize.value) {
      dates.push(daysAgo(i));
    }
    return dates.reverse();
  });

  async function loadSnapshots(): Promise<void> {
    loading.value = true;
    try {
      const projects = await db.getAllProjects();
      if (projects.length === 0) {
        rows.value = [];
        return;
      }

      const ownExtensions = new Map<string, { projectName: string; projectId: number }>();
      for (const project of projects) {
        if (!project.id) continue;
        if (!ownExtensions.has(project.ownExtensionId)) {
          ownExtensions.set(project.ownExtensionId, {
            projectName: project.name,
            projectId: project.id,
          });
        }
      }

      // Fetch one extra step beyond the visible window so the leftmost
      // column has a snapshot to compute its delta against.
      const currentStep = stepSize.value;
      const fetchStart = daysAgo(rangeDays.value + currentStep - 1);
      const fetchEnd = today();
      const lastVisibleOffset =
        Math.floor((rangeDays.value - 1) / currentStep) * currentStep;
      const firstColumnFallbackDate = daysAgo(lastVisibleOffset + currentStep);

      const newRows: ExtensionRow[] = [];

      for (const [extId, { projectName, projectId }] of ownExtensions) {
        const ext = await db.getExtension(extId);
        if (!ext) continue;

        const snapshots = await db.getListingSnapshots(extId, fetchStart, fetchEnd);

        const dedupedSnapshots = deduplicateByDate(snapshots);
        const byDate = new Map<string, ListingSnapshot>();
        for (const snap of dedupedSnapshots) {
          byDate.set(snap.date, snap);
        }

        const days = new Map<string, DayCell>();
        const allDates = dateColumns.value;

        for (let i = 0; i < allDates.length; i++) {
          const date = allDates[i];
          const snap = byDate.get(date);
          if (!snap) continue;

          let prevSnap: ListingSnapshot | undefined;
          for (let j = i - 1; j >= 0; j--) {
            prevSnap = byDate.get(allDates[j]);
            if (prevSnap) break;
          }
          if (!prevSnap) {
            prevSnap = byDate.get(firstColumnFallbackDate);
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
          projectId,
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

  async function setRangeDays(next: RangeDays): Promise<void> {
    rangeDays.value = next;
    await loadSnapshots();
  }

  async function setStep(next: StepMode): Promise<void> {
    if (next === step.value) return;
    // Preserve range "position" (index 0/1/2) across step change.
    const current = step.value === 'daily' ? DAILY_RANGES : WEEKLY_RANGES;
    const target = next === 'daily' ? DAILY_RANGES : WEEKLY_RANGES;
    const idx = Math.max(0, current.indexOf(rangeDays.value));
    rangeDays.value = target[idx];
    step.value = next;
    await loadSnapshots();
  }

  return {
    rows,
    loading,
    step,
    rangeDays,
    stepSize,
    dateColumns,
    loadSnapshots,
    setStep,
    setRangeDays,
  };
}
