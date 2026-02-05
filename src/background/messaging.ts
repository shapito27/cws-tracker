/**
 * Messaging utilities for the Service Worker (Phase 1.7.2).
 *
 * Wraps chrome.runtime.sendMessage with try/catch so the service worker
 * never crashes when no Dashboard or Popup is listening.
 */

import type { ServiceWorkerMessage } from '@/shared/types';

/**
 * Send a message from the service worker to any open Dashboard or Popup.
 *
 * Fails silently if no listeners are registered (e.g., dashboard tab is closed).
 * This is expected MV3 behavior — `chrome.runtime.sendMessage` throws when
 * there are no receivers.
 */
export function sendToUI(message: ServiceWorkerMessage): void {
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    // No listeners open — silently ignore
  }
}
