/**
 * Queue ordering — the single definition of "which job runs next".
 *
 * Shared by the processor (`db.dequeueNext`) and the queue details page so the
 * page shows exactly the order the processor will pick. Pure functions only.
 *
 * Order: `priority` ascending (lower runs first), then `scheduledAt`, then `id`
 * (insertion order — matches IndexedDB's primary-key order inside equal index
 * keys, so adding the tie-break does not change historical behaviour).
 *
 * User reordering rewrites `priority` ONLY. `scheduledAt` is never touched:
 * retry backoff and `purgeExpiredCycleJobs` both depend on it.
 */

import type { QueueJob } from '@/shared/types';

export type QueueReorderDirection = 'up' | 'top' | 'bottom';

export function compareQueueJobs(a: QueueJob, b: QueueJob): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const byTime = a.scheduledAt.getTime() - b.scheduledAt.getTime();
  if (byTime !== 0) return byTime;
  return (a.id ?? 0) - (b.id ?? 0);
}

export function sortQueueJobs(jobs: readonly QueueJob[]): QueueJob[] {
  return [...jobs].sort(compareQueueJobs);
}

/** True when the job is waiting for a future `scheduledAt` (retry backoff). */
export function isInBackoff(job: QueueJob, now: Date = new Date()): boolean {
  return job.status === 'pending' && job.scheduledAt.getTime() > now.getTime();
}

/**
 * Move one job within an already-sorted list of pending jobs.
 *
 * Returns the new order, or `null` when the job is not in the list or the move
 * is a no-op (already first for 'up'/'top', already last for 'bottom').
 */
export function reorderJobs(
  sortedPending: readonly QueueJob[],
  jobId: number,
  direction: QueueReorderDirection
): QueueJob[] | null {
  const from = sortedPending.findIndex((j) => j.id === jobId);
  if (from === -1) return null;

  let to: number;
  switch (direction) {
    case 'up':
      to = from - 1;
      break;
    case 'top':
      to = 0;
      break;
    case 'bottom':
      to = sortedPending.length - 1;
      break;
  }
  if (to < 0 || to === from) return null;

  const next = [...sortedPending];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
