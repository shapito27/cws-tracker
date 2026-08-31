/**
 * Presentation helper for an event's observation window.
 *
 * A change found by polling is never observed happening. All that is known is
 * that it had not happened at one scan and had happened at the next, so the
 * honest rendering is the interval between those two scans — not the moment the
 * scan noticed, which is what `detectedAt` records.
 *
 * This matters beyond pedantry. The daily scan samples every extension's
 * metadata and its rank in the same cycle, so rendering both as points made a
 * metadata change appear to precede a rank change by a near-constant interval,
 * every day, for every extension. Readers infer causation from that, with a
 * latency the data cannot support. Showing the window — and its width — puts
 * the uncertainty back where it can be seen.
 *
 * Records written before this was introduced have no window; they fall back to
 * the single timestamp and are flagged as imprecise rather than silently
 * rendered as if they were bounded.
 */

import type { EventRecord } from '@/shared/types';
import {
  formatObservationWindow,
  formatRelativeDateTime,
  formatWindowWidth,
  windowHours,
} from './dates';

export interface EventWindowDisplay {
  /** True when the event carries a real observation window. */
  bounded: boolean;
  /** "Jul 10 11:47 → Jul 13 14:49" when bounded, else the legacy single timestamp. */
  label: string;
  /** "~75h" when bounded, else `null`. */
  width: string | null;
  /** Window width in hours when bounded, else `null`. */
  hours: number | null;
  /** Hover text explaining what is being shown. */
  title: string;
}

/** Format a single Date the way the pre-window UI did. */
function formatLegacyTimestamp(date: Date): string {
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

function isValid(date: Date | undefined): date is Date {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Describe how an event's timing should be rendered.
 *
 * Falls back through: full window → `detectedAt` → the indexed date string.
 */
export function describeEventWindow(event: EventRecord): EventWindowDisplay {
  const from = event.lastSeenOldAt;
  const to = event.firstSeenNewAt;

  if (isValid(from) && isValid(to) && to.getTime() >= from.getTime()) {
    return {
      bounded: true,
      label: formatObservationWindow(from, to),
      width: formatWindowWidth(from, to),
      hours: windowHours(from, to),
      title:
        `Changed at some point between these two scans (${formatWindowWidth(from, to)} apart). ` +
        `Polling cannot narrow it further — scan more often to tighten the window.`,
    };
  }

  if (isValid(event.detectedAt)) {
    return {
      bounded: false,
      label: formatLegacyTimestamp(event.detectedAt),
      width: null,
      hours: null,
      title:
        'When the scan noticed this change, not when it happened. ' +
        'This record predates observation windows, so the true timing is unknown.',
    };
  }

  return {
    bounded: false,
    label: event.date,
    width: null,
    hours: null,
    title: 'Only the scan date is known for this record.',
  };
}

/**
 * A one-line variant for dense lists, where the full interval is too long.
 *
 * Anchors on when the new value was *first seen* — the only end of the window
 * that is a real observation of the change — and appends the window width, so
 * the reading stays "first seen then, could have happened any time in the
 * preceding N hours" rather than "happened then".
 */
export function describeEventWindowCompact(event: EventRecord): { label: string; title: string } {
  const full = describeEventWindow(event);

  if (full.bounded && isValid(event.firstSeenNewAt)) {
    return {
      label: `${formatRelativeDateTime(event.firstSeenNewAt)} · within ${full.width}`,
      title: `${full.label} — ${full.title}`,
    };
  }

  if (isValid(event.detectedAt)) {
    return { label: formatRelativeDateTime(event.detectedAt), title: full.title };
  }

  return { label: event.date, title: full.title };
}
