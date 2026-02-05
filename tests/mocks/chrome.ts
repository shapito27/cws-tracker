/**
 * Chrome API mocks for testing.
 * Provides in-memory implementations of chrome.storage.local, chrome.alarms,
 * chrome.runtime.sendMessage, chrome.runtime.onMessage, and chrome.runtime.onInstalled.
 * Each mock records calls for assertion.
 */

// --- Types ---

interface StorageArea {
  _store: Record<string, unknown>;
  get: (
    keys?: string | string[] | Record<string, unknown> | null
  ) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
  clear: () => Promise<void>;
}

interface Alarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

interface AlarmCreateInfo {
  delayInMinutes?: number;
  periodInMinutes?: number;
  when?: number;
}

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void;

type AlarmListener = (alarm: Alarm) => void;

interface InstalledDetails {
  reason: string;
  previousVersion?: string;
}

type InstalledListener = (details: InstalledDetails) => void;

// --- Call Recorder ---

export interface CallRecord {
  method: string;
  args: unknown[];
  timestamp: number;
}

const callLog: CallRecord[] = [];

function recordCall(method: string, args: unknown[]): void {
  callLog.push({ method, args: [...args], timestamp: Date.now() });
}

export function getCalls(method?: string): CallRecord[] {
  if (method) {
    return callLog.filter((c) => c.method === method);
  }
  return [...callLog];
}

export function clearCalls(): void {
  callLog.length = 0;
}

// --- chrome.storage.local ---

function createStorageArea(): StorageArea {
  const _store: Record<string, unknown> = {};

  return {
    _store,

    async get(
      keys?: string | string[] | Record<string, unknown> | null
    ): Promise<Record<string, unknown>> {
      recordCall('storage.local.get', [keys]);

      if (keys === undefined || keys === null) {
        return { ..._store };
      }

      if (typeof keys === 'string') {
        const result: Record<string, unknown> = {};
        if (keys in _store) {
          result[keys] = _store[keys];
        }
        return result;
      }

      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in _store) {
            result[key] = _store[key];
          }
        }
        return result;
      }

      // Object with defaults
      const result: Record<string, unknown> = {};
      for (const [key, defaultValue] of Object.entries(keys)) {
        result[key] = key in _store ? _store[key] : defaultValue;
      }
      return result;
    },

    async set(items: Record<string, unknown>): Promise<void> {
      recordCall('storage.local.set', [items]);
      Object.assign(_store, items);
    },

    async remove(keys: string | string[]): Promise<void> {
      recordCall('storage.local.remove', [keys]);
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        delete _store[key];
      }
    },

    async clear(): Promise<void> {
      recordCall('storage.local.clear', []);
      for (const key of Object.keys(_store)) {
        delete _store[key];
      }
    },
  };
}

// --- chrome.alarms ---

function createAlarms() {
  const alarms: Map<string, Alarm> = new Map();
  const listeners: AlarmListener[] = [];

  return {
    _alarms: alarms,
    _listeners: listeners,

    create(name: string, alarmInfo: AlarmCreateInfo): void {
      recordCall('alarms.create', [name, alarmInfo]);
      const alarm: Alarm = {
        name,
        scheduledTime: alarmInfo.when ?? Date.now() + (alarmInfo.delayInMinutes ?? 0) * 60000,
        periodInMinutes: alarmInfo.periodInMinutes,
      };
      alarms.set(name, alarm);
    },

    async get(name: string): Promise<Alarm | undefined> {
      recordCall('alarms.get', [name]);
      return alarms.get(name);
    },

    async getAll(): Promise<Alarm[]> {
      recordCall('alarms.getAll', []);
      return Array.from(alarms.values());
    },

    async clear(name: string): Promise<boolean> {
      recordCall('alarms.clear', [name]);
      return alarms.delete(name);
    },

    async clearAll(): Promise<boolean> {
      recordCall('alarms.clearAll', []);
      alarms.clear();
      return true;
    },

    onAlarm: {
      addListener(listener: AlarmListener): void {
        recordCall('alarms.onAlarm.addListener', [listener]);
        listeners.push(listener);
      },
      removeListener(listener: AlarmListener): void {
        const idx = listeners.indexOf(listener);
        if (idx !== -1) listeners.splice(idx, 1);
      },
      hasListener(listener: AlarmListener): boolean {
        return listeners.includes(listener);
      },
    },

    /** Test helper: fire an alarm by name */
    _fire(name: string): void {
      const alarm = alarms.get(name);
      if (alarm) {
        for (const listener of listeners) {
          listener(alarm);
        }
      }
    },
  };
}

// --- chrome.runtime ---

function createRuntime() {
  const messageListeners: MessageListener[] = [];
  const installedListeners: InstalledListener[] = [];

  return {
    _messageListeners: messageListeners,
    _installedListeners: installedListeners,

    sendMessage(message: unknown): Promise<unknown> {
      recordCall('runtime.sendMessage', [message]);
      return new Promise((resolve) => {
        let responded = false;
        const sendResponse = (response?: unknown) => {
          responded = true;
          resolve(response);
        };

        for (const listener of messageListeners) {
          const result = listener(message, {} as chrome.runtime.MessageSender, sendResponse);
          if (result === true) {
            // Async response expected
            return;
          }
        }

        if (!responded) {
          resolve(undefined);
        }
      });
    },

    onMessage: {
      addListener(listener: MessageListener): void {
        recordCall('runtime.onMessage.addListener', [listener]);
        messageListeners.push(listener);
      },
      removeListener(listener: MessageListener): void {
        const idx = messageListeners.indexOf(listener);
        if (idx !== -1) messageListeners.splice(idx, 1);
      },
      hasListener(listener: MessageListener): boolean {
        return messageListeners.includes(listener);
      },
    },

    onInstalled: {
      addListener(listener: InstalledListener): void {
        recordCall('runtime.onInstalled.addListener', [listener]);
        installedListeners.push(listener);
      },
      removeListener(listener: InstalledListener): void {
        const idx = installedListeners.indexOf(listener);
        if (idx !== -1) installedListeners.splice(idx, 1);
      },
      hasListener(listener: InstalledListener): boolean {
        return installedListeners.includes(listener);
      },
    },

    getURL(path: string): string {
      return `chrome-extension://mock-extension-id/${path}`;
    },

    getManifest(): { version: string } {
      return { version: '0.1.0' };
    },

    /** Test helper: fire onInstalled */
    _fireInstalled(details: InstalledDetails): void {
      for (const listener of installedListeners) {
        listener(details);
      }
    },
  };
}

// --- chrome.action ---

function createAction() {
  let badgeText = '';
  let badgeColor = '';

  return {
    _getBadgeText: () => badgeText,
    _getBadgeColor: () => badgeColor,

    async setBadgeText(details: { text: string }): Promise<void> {
      recordCall('action.setBadgeText', [details]);
      badgeText = details.text;
    },

    async setBadgeBackgroundColor(details: { color: string }): Promise<void> {
      recordCall('action.setBadgeBackgroundColor', [details]);
      badgeColor = details.color;
    },
  };
}

// --- chrome.tabs ---

function createTabs() {
  return {
    async create(props: { url: string }): Promise<{ id: number }> {
      recordCall('tabs.create', [props]);
      return { id: 1 };
    },
  };
}

// --- Assemble mock ---

export function createChromeMock() {
  return {
    storage: {
      local: createStorageArea(),
    },
    alarms: createAlarms(),
    runtime: createRuntime(),
    action: createAction(),
    tabs: createTabs(),
  };
}

// --- Global setup ---

const chromeMock = createChromeMock();

/**
 * Reset all mock state. Call in beforeEach().
 */
export function resetChromeMock(): void {
  clearCalls();

  // Reset storage
  const storage = chromeMock.storage.local;
  for (const key of Object.keys(storage._store)) {
    delete storage._store[key];
  }

  // Reset alarms
  chromeMock.alarms._alarms.clear();
  chromeMock.alarms._listeners.length = 0;

  // Reset runtime listeners
  chromeMock.runtime._messageListeners.length = 0;
  chromeMock.runtime._installedListeners.length = 0;
}

// Install globally
(globalThis as Record<string, unknown>).chrome = chromeMock;

export { chromeMock };
