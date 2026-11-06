/**
 * Human-readable labels for queue jobs, usable from the dashboard (the
 * service worker's own `getJobDescription` is private to `@/background`).
 */

import type { QueueJob, QueueJobType } from '@/shared/types';

const KIND_LABELS: Record<QueueJobType, string> = {
  listing_scan: 'Listing scan',
  keyword_scan: 'Keyword scan',
  translation_audit: 'Translation audit',
  autocomplete_scan: 'Autocomplete scan',
  review_scan: 'Review scan',
};

export interface QueueJobLabel {
  kind: string;
  target: string;
}

/** Extension IDs referenced by a set of jobs (for a batch name lookup). */
export function extensionIdsOf(jobs: readonly QueueJob[]): string[] {
  const ids = new Set<string>();
  for (const job of jobs) {
    const p = job.payload as { extensionId?: unknown };
    if (typeof p.extensionId === 'string') ids.add(p.extensionId);
  }
  return [...ids];
}

export function describeQueueJob(
  job: QueueJob,
  extensionNameById: ReadonlyMap<string, string>
): QueueJobLabel {
  const kind = KIND_LABELS[job.type] ?? job.type;
  const p = job.payload as { extensionId?: unknown; keyword?: unknown; locale?: unknown };

  if (typeof p.extensionId === 'string') {
    const name = extensionNameById.get(p.extensionId) ?? p.extensionId;
    const locale = typeof p.locale === 'string' ? ` (${p.locale})` : '';
    return { kind, target: `${name}${locale}` };
  }
  if (typeof p.keyword === 'string') {
    return { kind, target: p.keyword };
  }
  return { kind, target: '—' };
}
