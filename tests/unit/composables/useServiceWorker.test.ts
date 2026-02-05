/**
 * Tests for useServiceWorker composable.
 *
 * Covers handleMessage validation (validate-before-cast fix)
 * and message processing for all ServiceWorkerMessage types.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import '../../mocks/chrome';
import { useServiceWorker } from '@/dashboard/composables/useServiceWorker';

describe('useServiceWorker', () => {
  describe('handleMessage', () => {
    describe('message validation', () => {
      it('ignores null message', () => {
        const { handleMessage, scanStatus } = useServiceWorker();
        const before = { ...scanStatus.value };

        handleMessage(null);

        expect(scanStatus.value).toEqual(before);
      });

      it('ignores undefined message', () => {
        const { handleMessage, scanStatus } = useServiceWorker();
        const before = { ...scanStatus.value };

        handleMessage(undefined);

        expect(scanStatus.value).toEqual(before);
      });

      it('ignores non-object message (string)', () => {
        const { handleMessage, scanStatus } = useServiceWorker();
        const before = { ...scanStatus.value };

        handleMessage('SCAN_PROGRESS');

        expect(scanStatus.value).toEqual(before);
      });

      it('ignores non-object message (number)', () => {
        const { handleMessage, scanStatus } = useServiceWorker();
        const before = { ...scanStatus.value };

        handleMessage(42);

        expect(scanStatus.value).toEqual(before);
      });

      it('ignores object without type property', () => {
        const { handleMessage, scanStatus } = useServiceWorker();
        const before = { ...scanStatus.value };

        handleMessage({ data: 'something' });

        expect(scanStatus.value).toEqual(before);
      });

      it('ignores object with unrecognized type', () => {
        const { handleMessage, scanStatus } = useServiceWorker();
        const before = { ...scanStatus.value };

        handleMessage({ type: 'UNKNOWN_TYPE' });

        expect(scanStatus.value).toEqual(before);
      });
    });

    describe('SCAN_PROGRESS', () => {
      it('updates scanProgress and scanStatus on SCAN_PROGRESS message', () => {
        const { handleMessage, scanProgress, scanStatus } = useServiceWorker();

        handleMessage({
          type: 'SCAN_PROGRESS',
          completed: 3,
          total: 10,
          currentJob: 'Scanning uBlock Origin',
        });

        expect(scanProgress.value).toEqual({
          type: 'SCAN_PROGRESS',
          completed: 3,
          total: 10,
          currentJob: 'Scanning uBlock Origin',
        });
        expect(scanStatus.value.completed).toBe(3);
        expect(scanStatus.value.total).toBe(10);
        expect(scanStatus.value.currentJob).toBe('Scanning uBlock Origin');
      });

      it('sets isRunning to true and clears lastError', () => {
        const { handleMessage, scanStatus } = useServiceWorker();

        // Set an error first
        handleMessage({
          type: 'SCAN_ERROR',
          jobId: 1,
          error: 'Network timeout',
          retriesLeft: 0,
        });
        expect(scanStatus.value.lastError).toBe('Network timeout');

        // SCAN_PROGRESS should clear the error
        handleMessage({
          type: 'SCAN_PROGRESS',
          completed: 1,
          total: 5,
          currentJob: 'Scanning extension',
        });

        expect(scanStatus.value.isRunning).toBe(true);
        expect(scanStatus.value.lastError).toBeNull();
      });
    });

    describe('SCAN_COMPLETE', () => {
      it('updates lastScanStatus and resets scanStatus on SCAN_COMPLETE', () => {
        const { handleMessage, lastScanStatus, scanStatus } =
          useServiceWorker();

        // Start a scan first
        handleMessage({
          type: 'SCAN_PROGRESS',
          completed: 5,
          total: 5,
          currentJob: 'Final job',
        });

        handleMessage({
          type: 'SCAN_COMPLETE',
          date: '2025-01-15',
          jobsCompleted: 5,
          jobsFailed: 1,
        });

        expect(lastScanStatus.value).toEqual({
          type: 'SCAN_COMPLETE',
          date: '2025-01-15',
          jobsCompleted: 5,
          jobsFailed: 1,
        });
        expect(scanStatus.value.isRunning).toBe(false);
        expect(scanStatus.value.completed).toBe(0);
        expect(scanStatus.value.total).toBe(0);
        expect(scanStatus.value.currentJob).toBe('');
        expect(scanStatus.value.lastScanDate).toBe('2025-01-15');
        expect(scanStatus.value.lastJobsCompleted).toBe(5);
        expect(scanStatus.value.lastJobsFailed).toBe(1);
        expect(scanStatus.value.lastError).toBeNull();
      });

      it('clears scanProgress to null', () => {
        const { handleMessage, scanProgress } = useServiceWorker();

        handleMessage({
          type: 'SCAN_PROGRESS',
          completed: 1,
          total: 1,
          currentJob: 'Job',
        });
        expect(scanProgress.value).not.toBeNull();

        handleMessage({
          type: 'SCAN_COMPLETE',
          date: '2025-01-15',
          jobsCompleted: 1,
          jobsFailed: 0,
        });

        expect(scanProgress.value).toBeNull();
      });
    });

    describe('QUEUE_STATUS', () => {
      it('updates queueStats', () => {
        const { handleMessage, queueStats } = useServiceWorker();

        handleMessage({
          type: 'QUEUE_STATUS',
          pending: 5,
          running: 1,
          failed: 2,
        });

        expect(queueStats.value).toEqual({
          type: 'QUEUE_STATUS',
          pending: 5,
          running: 1,
          failed: 2,
        });
      });
    });

    describe('SCAN_ERROR', () => {
      it('sets lastError on scanStatus', () => {
        const { handleMessage, scanStatus } = useServiceWorker();

        handleMessage({
          type: 'SCAN_ERROR',
          jobId: 42,
          error: 'CWS returned 429',
          retriesLeft: 2,
        });

        expect(scanStatus.value.lastError).toBe('CWS returned 429');
      });
    });

    describe('NEW_EVENT', () => {
      it('does not throw on NEW_EVENT (no-op handler)', () => {
        const { handleMessage } = useServiceWorker();

        expect(() => {
          handleMessage({
            type: 'NEW_EVENT',
            event: {
              id: 1,
              extensionId: 'abc123',
              date: '2025-01-15',
              type: 'title_change',
              field: 'title',
              oldValue: 'Old Title',
              newValue: 'New Title',
              note: 'Title changed',
            },
          });
        }).not.toThrow();
      });
    });
  });
});
