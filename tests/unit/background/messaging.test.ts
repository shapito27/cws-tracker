/**
 * Tests for Service Worker messaging utility (Phase 1.7.2).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../mocks/chrome';
import { resetChromeMock, getCalls, chromeMock } from '../../mocks/chrome';
import { sendToUI } from '@/background/messaging';
import type { ServiceWorkerMessage } from '@/shared/types';

describe('sendToUI', () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it('sends a SCAN_PROGRESS message via chrome.runtime.sendMessage', () => {
    const msg: ServiceWorkerMessage = {
      type: 'SCAN_PROGRESS',
      completed: 3,
      total: 10,
      currentJob: 'Scanning extension abc...',
    };

    sendToUI(msg);

    const calls = getCalls('runtime.sendMessage');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual(msg);
  });

  it('sends a SCAN_COMPLETE message', () => {
    const msg: ServiceWorkerMessage = {
      type: 'SCAN_COMPLETE',
      date: '2026-02-05',
      jobsCompleted: 10,
      jobsFailed: 1,
    };

    sendToUI(msg);

    const calls = getCalls('runtime.sendMessage');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual(msg);
  });

  it('sends a SCAN_ERROR message', () => {
    const msg: ServiceWorkerMessage = {
      type: 'SCAN_ERROR',
      jobId: 42,
      error: 'HTTP 429: Too Many Requests',
      retriesLeft: 2,
    };

    sendToUI(msg);

    const calls = getCalls('runtime.sendMessage');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual(msg);
  });

  it('does not throw if no dashboard is open (sendMessage throws)', () => {
    // Override sendMessage to throw (simulates no listeners)
    const originalSendMessage = chromeMock.runtime.sendMessage;
    chromeMock.runtime.sendMessage = () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };

    const msg: ServiceWorkerMessage = {
      type: 'SCAN_COMPLETE',
      date: '2026-02-05',
      jobsCompleted: 5,
      jobsFailed: 0,
    };

    // Should not throw
    expect(() => sendToUI(msg)).not.toThrow();

    // Restore original
    chromeMock.runtime.sendMessage = originalSendMessage;
  });

  it('sends QUEUE_STATUS message', () => {
    const msg: ServiceWorkerMessage = {
      type: 'QUEUE_STATUS',
      pending: 5,
      running: 1,
      failed: 0,
    };

    sendToUI(msg);

    const calls = getCalls('runtime.sendMessage');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual(msg);
  });
});
