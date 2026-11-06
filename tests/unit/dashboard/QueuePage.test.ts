// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { db } from '@/shared/db/database';
import type { QueueJob } from '@/shared/types';
import '../../mocks/chrome';
import { resetChromeMock, chromeMock } from '../../mocks/chrome';

const { default: QueuePage } = await import('@/dashboard/pages/QueuePage.vue');

const EXT = 'a'.repeat(32);

function job(overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    type: 'listing_scan',
    payload: { extensionId: EXT },
    status: 'pending',
    priority: 0,
    retryCount: 0,
    maxRetries: 3,
    scheduledAt: new Date('2025-01-01'),
    startedAt: null,
    completedAt: null,
    error: null,
    ...overrides,
  };
}

describe('QueuePage', () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    resetChromeMock();
    await db.queue.clear();
    await db.extensions.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it('shows the empty state', async () => {
    wrapper = mount(QueuePage);
    await vi.waitFor(() => expect(wrapper.find('[data-testid="queue-empty"]').exists()).toBe(true));
  });

  it('lists pending jobs in run order, disables moves at the ends, running row has no actions', async () => {
    await db.enqueueJobs([
      job({ priority: 2, payload: { extensionId: EXT } }),
      job({ priority: 1, type: 'keyword_scan', payload: { keywordId: 1, keyword: 'ad blocker' } }),
      job({ status: 'running', startedAt: new Date(), heartbeatAt: new Date() }),
    ]);
    wrapper = mount(QueuePage);
    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-testid="queue-pending-row"]')).toHaveLength(2)
    );

    const rows = wrapper.findAll('[data-testid="queue-pending-row"]');
    expect(rows[0].text()).toContain('ad blocker');
    expect(rows[0].find('[data-testid="queue-move-up"]').attributes('disabled')).toBeDefined();
    expect(rows[1].find('[data-testid="queue-move-bottom"]').attributes('disabled')).toBeDefined();

    const running = wrapper.find('[data-testid="queue-running-row"]');
    expect(running.exists()).toBe(true);
    expect(running.find('button').exists()).toBe(false);
  });

  it('sends a reorder message and surfaces a service-worker error', async () => {
    await db.enqueueJobs([job({ priority: 0 }), job({ priority: 1 })]);
    const send = vi
      .spyOn(chromeMock.runtime, 'sendMessage')
      .mockResolvedValue({ ok: false, error: 'Job is no longer pending' });

    wrapper = mount(QueuePage);
    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-testid="queue-pending-row"]')).toHaveLength(2)
    );

    const second = wrapper.findAll('[data-testid="queue-pending-row"]')[1];
    await second.find('[data-testid="queue-move-top"]').trigger('click');
    await flushPromises();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REORDER_QUEUE_JOB', direction: 'top' })
    );
    expect(wrapper.find('[data-testid="queue-action-error"]').text()).toContain(
      'no longer pending'
    );
  });
});
