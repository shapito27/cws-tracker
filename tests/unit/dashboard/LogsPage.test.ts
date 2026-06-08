// @vitest-environment jsdom

/**
 * Render tests for LogsPage — validates the job-grouped layout end to end:
 * a paginated keyword scan collapses to one row per page (not two), the
 * synthetic 0ms diagnostics never render as standalone rows, a single-request
 * scan renders as one row, and Advanced mode shows the full response body.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { db } from '@/shared/db/database';
import type { ScanLog } from '@/shared/types';

// Stub the chart so the heavy ApexCharts import never loads under jsdom.
vi.mock('@/dashboard/components/charts/RequestStatsChart.vue', () => ({
  default: { name: 'RequestStatsChart', render: () => null },
}));

const { default: LogsPage } = await import('@/dashboard/pages/LogsPage.vue');

const DAY = '2026-06-08';
const BODY1_MARKER = 'UNIQUE_MARKER_BODY1';

function log(partial: Partial<ScanLog> & { timestamp: string }): ScanLog {
  return {
    timestamp: partial.timestamp,
    jobId: partial.jobId ?? null,
    jobType: partial.jobType ?? 'keyword_scan',
    level: partial.level ?? 'info',
    requestUrl: partial.requestUrl ?? 'https://proxy.example.com/search?q=ad+blocker&token=abc&key=[REDACTED]',
    responseStatus: partial.responseStatus === undefined ? 200 : partial.responseStatus,
    responsePreview: partial.responsePreview ?? '',
    durationMs: partial.durationMs ?? 0,
    jobDetail: partial.jobDetail ?? 'test',
    error: partial.error ?? null,
    httpMethod: 'GET',
    pageNumber: partial.pageNumber ?? null,
    kind: partial.kind,
  };
}

/** Seed a realistic 2-page keyword scan (job 100) + a listing scan (job 200). */
async function seedLogs(): Promise<void> {
  await db.saveScanLog(log({ timestamp: `${DAY}T11:35:23.000Z`, jobId: 100, pageNumber: 1, durationMs: 400, responsePreview: 'A'.repeat(40) + BODY1_MARKER, jobDetail: 'Search: "ad blocker" (kw#5)' }));
  await db.saveScanLog(log({ timestamp: `${DAY}T11:35:23.500Z`, jobId: 100, pageNumber: 1, durationMs: 0, kind: 'summary', jobDetail: 'Page 1 for "ad blocker": 30 results, 1/2 tracked found, continuing' }));
  await db.saveScanLog(log({ timestamp: `${DAY}T11:35:26.000Z`, jobId: 100, pageNumber: 2, durationMs: 450, responsePreview: 'BODY2', jobDetail: 'Search: "ad blocker" (kw#5)' }));
  await db.saveScanLog(log({ timestamp: `${DAY}T11:35:26.500Z`, jobId: 100, pageNumber: 2, durationMs: 0, kind: 'summary', jobDetail: 'Page 2 for "ad blocker": 28 results, 2/2 tracked found, stopping: all_tracked_found' }));
  await db.saveScanLog(log({ timestamp: `${DAY}T11:36:00.000Z`, jobId: 200, jobType: 'listing_scan', durationMs: 512, responsePreview: 'LISTINGBODY', jobDetail: 'Listing: uBlock Origin (cjpalhdlnbpafiamejdnhcphjbkeiagm)' }));
}

async function mountLoaded(): Promise<VueWrapper> {
  const wrapper = mount(LogsPage);
  // onMounted -> loadLogs() resolves over several macrotasks under fake-indexeddb.
  await vi.waitFor(
    () => {
      if (!wrapper.find('[data-testid="job-card"]').exists()) {
        throw new Error('logs not loaded yet');
      }
    },
    { timeout: 2000, interval: 20 }
  );
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('LogsPage', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(async () => {
    await db.scan_logs.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it('groups a paginated keyword scan into one card with one row per page', async () => {
    await seedLogs();
    wrapper = await mountLoaded();

    // Two job cards: the keyword scan and the listing scan.
    expect(wrapper.findAll('[data-testid="job-card"]')).toHaveLength(2);
    // Only the multi-page keyword scan gets a job header.
    expect(wrapper.findAll('[data-testid="job-header"]')).toHaveLength(1);
    // 3 request rows total: 2 keyword pages (not 4) + 1 listing — summaries folded.
    expect(wrapper.findAll('[data-testid="log-row"]')).toHaveLength(3);

    const text = wrapper.text();
    // Job header shows the title + request count.
    expect(text).toContain('Search: "ad blocker" (kw#5)');
    expect(text).toContain('2 requests');
    // Folded per-page results render inline (with the redundant prefix stripped).
    expect(text).toContain('30 results, 1/2 tracked found, continuing');
    expect(text).toContain('28 results, 2/2 tracked found, stopping: all_tracked_found');
    // Page badges present...
    expect(text).toContain('Page 1');
    expect(text).toContain('Page 2');
    // ...but the raw summary jobDetail is NOT shown as its own row.
    expect(text).not.toContain('Page 1 for "ad blocker"');
    // Single-request listing scan renders as a compact row.
    expect(text).toContain('Listing: uBlock Origin');
  });

  it('never renders the misleading standalone 0ms from synthetic diagnostics', async () => {
    await seedLogs();
    wrapper = await mountLoaded();
    // Real durations like "400ms"/"850ms" contain "0ms" as a substring, so match
    // only a zero duration that is NOT preceded by another digit.
    expect(wrapper.text()).not.toMatch(/(?<!\d)0ms/);
  });

  it('stats bar counts real requests only (excludes folded summaries)', async () => {
    await seedLogs();
    wrapper = await mountLoaded();
    // 3 real requests (2 keyword pages + 1 listing), not 5 logs.
    expect(wrapper.text()).toContain('3 requests');
  });

  it('Advanced mode reveals the full response body for an expanded request', async () => {
    await seedLogs();
    wrapper = await mountLoaded();

    // Turn on Advanced, then expand the keyword page-1 row (2nd row in the DOM:
    // listing row, then keyword page-1, then keyword page-2).
    await wrapper.get('[data-testid="advanced-toggle"]').trigger('click');
    const rows = wrapper.findAll('[data-testid="log-row"]');
    await rows[1].trigger('click');
    await nextTick();

    const pre = wrapper.find('pre');
    expect(pre.exists()).toBe(true);
    expect(pre.text()).toContain(BODY1_MARKER);
    // The body is rendered wrapped/scrollable, not as a single truncated line.
    expect(pre.classes()).toContain('whitespace-pre-wrap');
    // A Copy affordance is present in the expanded panel.
    expect(wrapper.text()).toContain('Copy');
  });
});
