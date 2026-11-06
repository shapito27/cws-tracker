import { describe, it, expect } from 'vitest';
import type { QueueJob } from '@/shared/types';
import {
  compareQueueJobs,
  sortQueueJobs,
  isInBackoff,
  reorderJobs,
} from '@/shared/utils/queue-order';

function job(id: number, priority: number, at = 0, status: QueueJob['status'] = 'pending'): QueueJob {
  return {
    id,
    type: 'listing_scan',
    payload: { extensionId: 'a'.repeat(32) },
    status,
    priority,
    retryCount: 0,
    maxRetries: 3,
    scheduledAt: new Date(1_700_000_000_000 + at),
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

const ids = (jobs: QueueJob[] | null): number[] => (jobs ?? []).map((j) => j.id!);

describe('compareQueueJobs / sortQueueJobs', () => {
  it('orders by priority, then scheduledAt, then id', () => {
    const sorted = sortQueueJobs([job(4, 2, 0), job(3, 1, 5), job(2, 1, 5), job(1, 1, 0)]);
    expect(ids(sorted)).toEqual([1, 2, 3, 4]);
  });

  it('does not mutate its input', () => {
    const input = [job(2, 2), job(1, 1)];
    sortQueueJobs(input);
    expect(ids(input)).toEqual([2, 1]);
  });

  it('is antisymmetric', () => {
    expect(compareQueueJobs(job(1, 1), job(2, 1))).toBeLessThan(0);
    expect(compareQueueJobs(job(2, 1), job(1, 1))).toBeGreaterThan(0);
  });
});

describe('isInBackoff', () => {
  const now = new Date(1_700_000_000_000);
  it('is true only for a pending job scheduled in the future', () => {
    expect(isInBackoff(job(1, 1, 60_000), now)).toBe(true);
    expect(isInBackoff(job(1, 1, -1), now)).toBe(false);
    expect(isInBackoff(job(1, 1, 60_000, 'running'), now)).toBe(false);
  });
});

describe('reorderJobs', () => {
  const list = [job(1, 0), job(2, 1), job(3, 2)];

  it('moves up one step', () => {
    expect(ids(reorderJobs(list, 3, 'up'))).toEqual([1, 3, 2]);
  });
  it('moves to the top and to the bottom', () => {
    expect(ids(reorderJobs(list, 3, 'top'))).toEqual([3, 1, 2]);
    expect(ids(reorderJobs(list, 1, 'bottom'))).toEqual([2, 3, 1]);
  });
  it('returns null for no-ops and unknown ids', () => {
    expect(reorderJobs(list, 1, 'up')).toBeNull();
    expect(reorderJobs(list, 1, 'top')).toBeNull();
    expect(reorderJobs(list, 3, 'bottom')).toBeNull();
    expect(reorderJobs(list, 99, 'top')).toBeNull();
  });
});
