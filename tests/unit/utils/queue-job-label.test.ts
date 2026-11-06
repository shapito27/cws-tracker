import { describe, it, expect } from 'vitest';
import type { QueueJob } from '@/shared/types';
import { describeQueueJob, extensionIdsOf } from '@/shared/utils/queue-job-label';

const EXT = 'a'.repeat(32);

function job(type: QueueJob['type'], payload: QueueJob['payload']): QueueJob {
  return {
    type, payload, status: 'pending', priority: 0, retryCount: 0, maxRetries: 3,
    scheduledAt: new Date(), startedAt: null, completedAt: null, error: null,
  };
}

describe('describeQueueJob', () => {
  const names = new Map([[EXT, 'My Extension']]);

  it('uses the extension name, falling back to the id', () => {
    expect(describeQueueJob(job('listing_scan', { extensionId: EXT }), names)).toEqual({
      kind: 'Listing scan', target: 'My Extension',
    });
    expect(describeQueueJob(job('review_scan', { extensionId: 'z'.repeat(32) }), names).target)
      .toBe('z'.repeat(32));
  });

  it('adds the locale for translation audits', () => {
    expect(describeQueueJob(job('translation_audit', { extensionId: EXT, locale: 'de' }), names).target)
      .toBe('My Extension (de)');
  });

  it('shows the keyword for keyword jobs', () => {
    expect(describeQueueJob(job('keyword_scan', { keywordId: 1, keyword: 'ad blocker' }), names))
      .toEqual({ kind: 'Keyword scan', target: 'ad blocker' });
  });
});

describe('extensionIdsOf', () => {
  it('collects unique extension ids and ignores keyword jobs', () => {
    expect(extensionIdsOf([
      job('listing_scan', { extensionId: EXT }),
      job('review_scan', { extensionId: EXT }),
      job('keyword_scan', { keywordId: 1, keyword: 'x' }),
    ])).toEqual([EXT]);
  });
});
