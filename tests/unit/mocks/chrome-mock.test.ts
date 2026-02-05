/**
 * Tests for Chrome API mocks to verify they work correctly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { chromeMock, resetChromeMock, getCalls } from '../../mocks/chrome';

describe('Chrome API mocks', () => {
  beforeEach(() => {
    resetChromeMock();
  });

  describe('chrome.storage.local', () => {
    it('returns empty object when storage is empty', async () => {
      const result = await chromeMock.storage.local.get(null);
      expect(result).toEqual({});
    });

    it('stores and retrieves a value', async () => {
      await chromeMock.storage.local.set({ key1: 'value1' });
      const result = await chromeMock.storage.local.get('key1');
      expect(result).toEqual({ key1: 'value1' });
    });

    it('stores multiple values', async () => {
      await chromeMock.storage.local.set({ a: 1, b: 2 });
      const result = await chromeMock.storage.local.get(['a', 'b']);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('returns defaults for missing keys', async () => {
      await chromeMock.storage.local.set({ existing: 'yes' });
      const result = await chromeMock.storage.local.get({
        existing: 'default',
        missing: 'default',
      });
      expect(result).toEqual({ existing: 'yes', missing: 'default' });
    });

    it('removes a key', async () => {
      await chromeMock.storage.local.set({ key1: 'value1' });
      await chromeMock.storage.local.remove('key1');
      const result = await chromeMock.storage.local.get('key1');
      expect(result).toEqual({});
    });

    it('clears all storage', async () => {
      await chromeMock.storage.local.set({ a: 1, b: 2 });
      await chromeMock.storage.local.clear();
      const result = await chromeMock.storage.local.get(null);
      expect(result).toEqual({});
    });

    it('records calls', async () => {
      await chromeMock.storage.local.set({ test: true });
      const calls = getCalls('storage.local.set');
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual([{ test: true }]);
    });
  });

  describe('chrome.alarms', () => {
    it('creates and retrieves an alarm', async () => {
      chromeMock.alarms.create('test', { delayInMinutes: 1 });
      const alarm = await chromeMock.alarms.get('test');
      expect(alarm).toBeDefined();
      expect(alarm!.name).toBe('test');
    });

    it('returns undefined for non-existent alarm', async () => {
      const alarm = await chromeMock.alarms.get('nonexistent');
      expect(alarm).toBeUndefined();
    });

    it('lists all alarms', async () => {
      chromeMock.alarms.create('a', { delayInMinutes: 1 });
      chromeMock.alarms.create('b', { delayInMinutes: 2 });
      const all = await chromeMock.alarms.getAll();
      expect(all).toHaveLength(2);
    });

    it('clears a specific alarm', async () => {
      chromeMock.alarms.create('test', { delayInMinutes: 1 });
      const cleared = await chromeMock.alarms.clear('test');
      expect(cleared).toBe(true);
      const alarm = await chromeMock.alarms.get('test');
      expect(alarm).toBeUndefined();
    });

    it('fires alarm listeners', () => {
      const fired: string[] = [];
      chromeMock.alarms.onAlarm.addListener((alarm) => {
        fired.push(alarm.name);
      });
      chromeMock.alarms.create('test', { delayInMinutes: 1 });
      chromeMock.alarms._fire('test');
      expect(fired).toEqual(['test']);
    });
  });

  describe('chrome.runtime', () => {
    it('sends and receives messages', async () => {
      chromeMock.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        sendResponse({ echo: msg });
        return false;
      });

      const response = await chromeMock.runtime.sendMessage({ type: 'TEST' });
      expect(response).toEqual({ echo: { type: 'TEST' } });
    });

    it('fires onInstalled listeners', () => {
      const reasons: string[] = [];
      chromeMock.runtime.onInstalled.addListener((details) => {
        reasons.push(details.reason);
      });
      chromeMock.runtime._fireInstalled({ reason: 'install' });
      expect(reasons).toEqual(['install']);
    });

    it('getURL returns extension URL', () => {
      const url = chromeMock.runtime.getURL('popup.html');
      expect(url).toContain('popup.html');
    });

    it('getManifest returns version', () => {
      const manifest = chromeMock.runtime.getManifest();
      expect(manifest.version).toBe('0.1.0');
    });
  });

  describe('chrome.action', () => {
    it('sets badge text', async () => {
      await chromeMock.action.setBadgeText({ text: '3' });
      expect(chromeMock.action._getBadgeText()).toBe('3');
    });
  });

  describe('chrome.tabs', () => {
    it('creates a tab', async () => {
      const tab = await chromeMock.tabs.create({ url: 'https://example.com' });
      expect(tab.id).toBeDefined();
      const calls = getCalls('tabs.create');
      expect(calls).toHaveLength(1);
    });
  });

  describe('resetChromeMock', () => {
    it('resets all state', async () => {
      await chromeMock.storage.local.set({ key: 'value' });
      chromeMock.alarms.create('alarm', { delayInMinutes: 1 });

      resetChromeMock();

      // Call log should be cleared after reset
      expect(getCalls()).toEqual([]);

      // Storage should be empty
      const storage = await chromeMock.storage.local.get(null);
      expect(storage).toEqual({});

      // Alarms should be empty
      const alarms = await chromeMock.alarms.getAll();
      expect(alarms).toEqual([]);
    });
  });
});
