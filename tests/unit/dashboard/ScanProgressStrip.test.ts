// @vitest-environment jsdom

/**
 * Render tests for ScanProgressStrip.
 *
 * The strip reads `useServiceWorker()` internally. We hoist a mutable `scanStatus`
 * ref via `vi.hoisted` so tests can drive state changes after mount.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

const { state } = vi.hoisted(() => {
  // Lazily created inside the mock factory so vue's `ref` is available.
  return { state: { scanStatus: null as any } };
});

vi.mock('@/dashboard/composables/useServiceWorker', async () => {
  const { ref } = await import('vue');
  state.scanStatus = ref({
    isRunning: false,
    completed: 0,
    total: 0,
    currentJob: '',
    nextProcessingAt: null,
    phase: 'running' as const,
    lastScanDate: null,
    lastJobsCompleted: 0,
    lastJobsFailed: 0,
    lastError: null,
  });
  return {
    useServiceWorker: () => ({ scanStatus: state.scanStatus }),
  };
});

// Dynamic import AFTER the mock is registered so the component picks up the mock.
const { default: ScanProgressStrip } = await import(
  '@/dashboard/components/ScanProgressStrip.vue'
);

function resetState(): void {
  state.scanStatus.value = {
    isRunning: false,
    completed: 0,
    total: 0,
    currentJob: '',
    nextProcessingAt: null,
    phase: 'running' as const,
    lastScanDate: null,
    lastJobsCompleted: 0,
    lastJobsFailed: 0,
    lastError: null,
  };
}

describe('ScanProgressStrip', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    resetState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  it('renders nothing when no scan is running', () => {
    wrapper = mount(ScanProgressStrip);
    expect(wrapper.find('[data-testid="scan-strip"]').exists()).toBe(false);
  });

  it('renders the strip when a scan is running', async () => {
    wrapper = mount(ScanProgressStrip);
    state.scanStatus.value = {
      ...state.scanStatus.value,
      isRunning: true,
      completed: 1,
      total: 3,
      currentJob: 'Fetching listing',
      phase: 'running',
    };
    await nextTick();
    expect(wrapper.find('[data-testid="scan-strip"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Scanning');
    expect(wrapper.text()).toContain('Fetching listing');
    expect(wrapper.text()).toContain('1/3');
  });

  it('hides the counter when total is 1', async () => {
    wrapper = mount(ScanProgressStrip);
    state.scanStatus.value = {
      ...state.scanStatus.value,
      isRunning: true,
      completed: 0,
      total: 1,
      phase: 'running',
    };
    await nextTick();
    expect(wrapper.find('[data-testid="scan-counter"]').exists()).toBe(false);
  });

  it('shows the countdown only during waiting phase', async () => {
    const now = new Date('2026-04-21T12:00:00Z').getTime();
    vi.setSystemTime(now);

    wrapper = mount(ScanProgressStrip);
    state.scanStatus.value = {
      ...state.scanStatus.value,
      isRunning: true,
      completed: 1,
      total: 3,
      phase: 'waiting',
      nextProcessingAt: new Date(now + 10_000).toISOString(),
    };
    await nextTick();
    expect(wrapper.find('[data-testid="scan-countdown"]').text()).toContain('10s');

    // After 3 seconds the countdown should read 7s.
    vi.advanceTimersByTime(3000);
    await nextTick();
    expect(wrapper.find('[data-testid="scan-countdown"]').text()).toContain('7s');

    // Switch back to running — countdown element disappears.
    state.scanStatus.value = { ...state.scanStatus.value, phase: 'running' };
    await nextTick();
    expect(wrapper.find('[data-testid="scan-countdown"]').exists()).toBe(false);
  });
});
