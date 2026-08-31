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
 * DST boundary, whereas a fixed local time stays put. `scansPerDay` is capped at
 * 4 so `24/N` is always a whole number of hours.
 */
export function slotScanTime(baseScanTime: string, slot: number, scansPerDay: number): string {
  const [hours, minutes] = baseScanTime.split(':').map(Number);
  const spacingHours = 24 / scansPerDay;
  const slotHour = (hours + slot * spacingHours) % 24;
  return `${String(slotHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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
  const spacingHours = 24 / scansPerDay;

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesBase = hours * 60 + minutes;
  // Minutes since slot 0, wrapped into [0, 1440).
  const elapsed = (minutesNow - minutesBase + 1440) % 1440;
  return Math.floor(elapsed / (spacingHours * 60));
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
  for (let slot = 0; slot < scansPerDay; slot++) {
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
