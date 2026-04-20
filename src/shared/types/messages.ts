/**
 * Message types for communication between Service Worker and Dashboard/Popup.
 *
 * Service Worker → UI: sent via chrome.runtime.sendMessage (fails silently if
 * no listener is open - wrap in try/catch).
 *
 * UI → Service Worker: sent via chrome.runtime.sendMessage.
 */

import type { EventRecord } from './index';

// ---------------------------------------------------------------------------
// Service Worker → Dashboard / Popup
// ---------------------------------------------------------------------------

/** Periodic progress update during a scan cycle. */
export interface ScanProgressMessage {
  type: 'SCAN_PROGRESS';
  /** Number of jobs completed so far. */
  completed: number;
  /** Total number of jobs in this scan cycle. */
  total: number;
  /** Human-readable description of the current job (e.g. "Scanning uBlock Origin"). */
  currentJob: string;
  /** ISO timestamp of when the next job will be processed (from chrome.alarms delay). */
  nextProcessingAt?: string;
}

/** Sent when all queued jobs have been processed. */
export interface ScanCompleteMessage {
  type: 'SCAN_COMPLETE';
  /** YYYY-MM-DD date of the completed scan. */
  date: string;
  jobsCompleted: number;
  jobsFailed: number;
}

/** Sent when a change event is detected during scanning. */
export interface NewEventMessage {
  type: 'NEW_EVENT';
  event: EventRecord;
}

/** Sent when a job encounters an error. */
export interface ScanErrorMessage {
  type: 'SCAN_ERROR';
  jobId: number;
  error: string;
  retriesLeft: number;
}

/** Periodic queue status summary. */
export interface QueueStatusMessage {
  type: 'QUEUE_STATUS';
  pending: number;
  running: number;
  failed: number;
}

/** Union of all messages the Service Worker can send to the UI. */
export type ServiceWorkerMessage =
  | ScanProgressMessage
  | ScanCompleteMessage
  | NewEventMessage
  | ScanErrorMessage
  | QueueStatusMessage;

// ---------------------------------------------------------------------------
// Dashboard / Popup → Service Worker
// ---------------------------------------------------------------------------

/** Scope of jobs to enqueue for a manual refresh. */
export type ScanType = 'full' | 'keywords' | 'autocomplete';

/** Request to start a scan (optionally for a specific project and scan type). */
export interface TriggerRefreshMessage {
  type: 'TRIGGER_REFRESH';
  /** If provided, only scan this project. Otherwise scan all projects. */
  projectId?: number;
  /**
   * If provided, limit the enqueued jobs to the given type:
   * - 'full' (default): listing + keyword + autocomplete jobs.
   * - 'keywords': only keyword_scan jobs.
   * - 'autocomplete': only autocomplete_scan jobs.
   */
  scanType?: ScanType;
}

/** Request to pause queue processing. */
export interface PauseScanMessage {
  type: 'PAUSE_SCAN';
}

/** Request to resume queue processing. */
export interface ResumeScanMessage {
  type: 'RESUME_SCAN';
}

/** Request to cancel all pending jobs and stop processing. */
export interface CancelScanMessage {
  type: 'CANCEL_SCAN';
}

/** Request to run a pagination diagnostic test against the real proxy. */
export interface TestPaginationMessage {
  type: 'TEST_PAGINATION';
  /** Search keyword to test (e.g. "check broken links"). */
  keyword: string;
  /** Max pages to fetch (default 2). */
  maxPages?: number;
}

/** Union of all messages the Dashboard/Popup can send to the Service Worker. */
export type DashboardMessage =
  | TriggerRefreshMessage
  | PauseScanMessage
  | ResumeScanMessage
  | CancelScanMessage
  | TestPaginationMessage;
