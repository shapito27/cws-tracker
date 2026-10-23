/**
 * Scan slot arithmetic.
 *
 * With `scansPerDay: N`, a day has N scan slots. Slot 0 fires at
 * `dailyScanTime`; slot k fires 24/N hours later than slot k-1. At N=1 there is
 * exactly one slot at `dailyScanTime` and every function here reduces to the
 * single-daily-scan behaviour that came before.
 *
 * Pure date arithmetic, so it lives in `shared` rather than in the service
 * worker: the dashboard needs it too, to tell the user when the next scan is.
 */

import { toDateString } from './dates';
import { MIN_SCANS_PER_DAY, MAX_SCANS_PER_DAY } from './settings';

/**
 * Coerce `scansPerDay` to a usable slot count.
 *
 * Settings validation already restricts this to an integer 1-10 on every write,
 * but `getWithDefaults` merges whatever is in `chrome.storage.local` without
 * re-validating. A value of 0 or NaN slipping through would make `24/N`
 * infinite or NaN, which propagates into `setHours` and yields an alarm time of
 * NaN — scanning would stop permanently and silently. Clamping here costs
 * nothing and keeps that failure mode impossible.
 */
export function slotCount(scansPerDay: number): number {
  if (!Number.isFinite(scansPerDay)) return 1;
  return Math.min(MAX_SCANS_PER_DAY, Math.max(MIN_SCANS_PER_DAY, Math.floor(scansPerDay)));
}

/** Round each offset independently so minute rounding never accumulates drift. */
function slotOffsetMinutes(slot: number, count: number): number {
  return Math.round(slot * 1440 / count);
}

/**
 * Compute the absolute timestamp (epoch ms) of the next occurrence of the
 * given `HH:MM` scan time relative to `now`, using local calendar fields.
 *
 * If today's scheduled time has already passed (or is exactly `now`), the
 * next occurrence is tomorrow at the same time.
 *
 * Uses `setHours` (local wall-clock), so the scan stays at the same local time
 * across DST transitions rather than drifting by an hour.
 */
export function nextDailyScanTimestamp(scanTime: string, now: Date): number {
  const [hours, minutes] = scanTime.split(':').map(Number);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

/**
 * Local wall-clock `HH:MM` for slot `k`.
 *
 * Deliberately returns a wall-clock time rather than an offset in milliseconds:
 * adding `k * 8h` of real time would shift every later slot by an hour across a
 * DST boundary, whereas a fixed local time stays put. Fractional intervals are
 * rounded to the nearest minute, so every slot has a valid HH:MM time.
 */
export function slotScanTime(baseScanTime: string, slot: number, scansPerDay: number): string {
  const [hours, minutes] = baseScanTime.split(':').map(Number);
  const totalMinutes = (hours * 60 + minutes + slotOffsetMinutes(slot, slotCount(scansPerDay))) % 1440;
  const slotHour = Math.floor(totalMinutes / 60);
  const slotMinute = totalMinutes % 60;
  return `${String(slotHour).padStart(2, '0')}:${String(slotMinute).padStart(2, '0')}`;
}

/**
 * The slot whose scheduled time most recently passed, for a given moment.
 *
 * This is "the slot we are currently in". A manual refresh writes into it, so
 * that a manual scan replaces the current slot's sample rather than inventing an
 * extra one. Before the day's first slot time, the current slot is the last one
 * of the previous day.
 */
export function currentSlot(baseScanTime: string, scansPerDay: number, now: Date): number {
  const [hours, minutes] = baseScanTime.split(':').map(Number);
  const count = slotCount(scansPerDay);

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesBase = hours * 60 + minutes;
  // Minutes since slot 0, wrapped into [0, 1440).
  const elapsed = (minutesNow - minutesBase + 1440) % 1440;
  for (let slot = count - 1; slot > 0; slot--) {
    if (elapsed >= slotOffsetMinutes(slot, count)) return slot;
  }
  return 0;
}

/**
 * Timestamp of the next slot boundary strictly after `now`, and which slot it is.
 *
 * Each slot carries up to `SLOT_JITTER_MINUTES` of randomized delay so the
 * sampling times themselves are not perfectly regular. Without it, N evenly
 * spaced scans at fixed times would just replace one systematic sampling pattern
 * with another.
 */
export function nextSlotOccurrence(
  baseScanTime: string,
  scansPerDay: number,
  now: Date
): { when: number; slot: number } {
  let best: { when: number; slot: number } | null = null;

  // Check today's and tomorrow's occurrence of every slot; keep the earliest
  // that is still in the future.
  for (let slot = 0; slot < slotCount(scansPerDay); slot++) {
    const [h, m] = slotScanTime(baseScanTime, slot, scansPerDay).split(':').map(Number);
    for (const dayOffset of [0, 1]) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(h, m, 0, 0);
      const when = candidate.getTime();
      if (when <= now.getTime()) continue;
      if (!best || when < best.when) best = { when, slot };
    }
  }

  // scansPerDay >= 1 guarantees at least one future candidate across two days.
  return best ?? { when: nextDailyScanTimestamp(baseScanTime, now), slot: 0 };
}

/**
 * Epoch ms of the most recent occurrence of the slot we are currently in.
 *
 * `currentSlot` says *which* slot; this says *when it was due*. Catch-up logic
 * needs the timestamp: "the slot has not run yet" is only worth acting on while
 * the slot is still recent, and the slot's calendar date is not the same thing
 * as its slot-day (with `dailyScanTime: 10:00` and `scansPerDay: 4`, the 04:00
 * slot happens today but belongs to yesterday's slot-day).
 */
export function currentSlotOccurrence(
  baseScanTime: string,
  scansPerDay: number,
  now: Date
): number {
  const slot = currentSlot(baseScanTime, scansPerDay, now);
  const [h, m] = slotScanTime(baseScanTime, slot, scansPerDay).split(':').map(Number);
  const occurrence = new Date(now);
  occurrence.setHours(h, m, 0, 0);
  // The current slot's time is by definition in the past; if today's instance
  // of that wall-clock time is still ahead, the occurrence was yesterday's.
  if (occurrence.getTime() > now.getTime()) {
    occurrence.setDate(occurrence.getDate() - 1);
  }
  return occurrence.getTime();
}

/** Identity of one scan slot on one day, e.g. `"2026-08-28#1"`. */
export function slotKey(date: string, slot: number): string {
  return `${date}#${slot}`;
}

/**
 * The calendar date that the current slot belongs to.
 *
 * Usually today. Between midnight and the day's first slot time we are still
 * inside the previous day's last slot, so its date is yesterday — otherwise a
 * 22:00 slot observed at 01:00 would be recorded against the wrong day and
 * would look like it had never run.
 */
export function slotDateFor(baseScanTime: string, scansPerDay: number, now: Date): string {
  const [hours, minutes] = baseScanTime.split(':').map(Number);
  const firstSlotToday = new Date(now);
  firstSlotToday.setHours(hours, minutes, 0, 0);
  if (now.getTime() >= firstSlotToday.getTime()) return toDateString(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return toDateString(yesterday);
}

/**
 * Human-readable label for the next scheduled scan, e.g. `"Today ~03:00 PM"`.
 *
 * This is the one place the dashboard turns the schedule into words, so every
 * surface (home page cards, project overview) agrees with the scheduler and
 * with each other. The label is derived purely from the slot arithmetic — it
 * deliberately does NOT look at `lastDailyScanDate`: that key is stamped by any
 * drain, a manual "Refresh Now" included, so gating on it pushed the label to
 * "Tomorrow" for the rest of the day even when later slots were still to come.
 *
 * The `~` acknowledges the up-to-20-minute jitter the scheduler adds to each
 * slot's fire time.
 */
export function describeNextScan(baseScanTime: string, scansPerDay: number, now: Date): string {
  const nextDate = new Date(nextSlotOccurrence(baseScanTime, scansPerDay, now).when);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const timeStr = nextDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (nextDate.toDateString() === now.toDateString()) return `Today ~${timeStr}`;
  if (nextDate.toDateString() === tomorrow.toDateString()) return `Tomorrow ~${timeStr}`;
  return `${nextDate.toLocaleDateString()} ~${timeStr}`;
}
