/**
 * Tests for scan slot arithmetic.
 *
 * Slots are how `scansPerDay > 1` divides a day. The invariant that matters
 * most: at `scansPerDay: 1` everything must reduce to the single-daily-scan
 * behaviour that existed before slots.
 */

import { describe, it, expect } from 'vitest';
import {
  slotScanTime,
  currentSlot,
  nextSlotOccurrence,
  slotDateFor,
  slotKey,
} from '@/background/scheduler';

describe('slotScanTime', () => {
  it('returns the base time for the only slot when scanning once a day', () => {
    expect(slotScanTime('03:00', 0, 1)).toBe('03:00');
  });

  it('spaces slots evenly across the day', () => {
    expect(slotScanTime('03:00', 0, 3)).toBe('03:00');
    expect(slotScanTime('03:00', 1, 3)).toBe('11:00');
    expect(slotScanTime('03:00', 2, 3)).toBe('19:00');
  });

  it('wraps past midnight', () => {
    expect(slotScanTime('19:00', 0, 2)).toBe('19:00');
    expect(slotScanTime('19:00', 1, 2)).toBe('07:00');
  });

  it('preserves the minute of the base time', () => {
    expect(slotScanTime('03:45', 2, 4)).toBe('15:45');
  });

  it('yields whole hours for every allowed scansPerDay', () => {
    // The 1-4 cap exists partly so 24/N is always an integer.
    for (const n of [1, 2, 3, 4]) {
      for (let slot = 0; slot < n; slot++) {
        expect(slotScanTime('03:00', slot, n)).toMatch(/^\d{2}:00$/);
      }
    }
  });
});

describe('currentSlot', () => {
  it('is always 0 when scanning once a day', () => {
    expect(currentSlot('03:00', 1, new Date(2026, 7, 20, 2, 0))).toBe(0);
    expect(currentSlot('03:00', 1, new Date(2026, 7, 20, 14, 0))).toBe(0);
    expect(currentSlot('03:00', 1, new Date(2026, 7, 20, 23, 59))).toBe(0);
  });

  it('reports the slot whose time most recently passed', () => {
    // Slots at 03:00, 11:00, 19:00.
    expect(currentSlot('03:00', 3, new Date(2026, 7, 20, 3, 0))).toBe(0);
    expect(currentSlot('03:00', 3, new Date(2026, 7, 20, 10, 59))).toBe(0);
    expect(currentSlot('03:00', 3, new Date(2026, 7, 20, 11, 0))).toBe(1);
    expect(currentSlot('03:00', 3, new Date(2026, 7, 20, 19, 30))).toBe(2);
  });

  it('is the previous day\'s last slot before the first slot time', () => {
    expect(currentSlot('03:00', 3, new Date(2026, 7, 20, 1, 0))).toBe(2);
  });
});

describe('slotDateFor', () => {
  it('is today once the first slot time has passed', () => {
    expect(slotDateFor('03:00', 3, new Date(2026, 7, 20, 12, 0))).toBe('2026-08-20');
  });

  it('is yesterday before the first slot time', () => {
    // A 19:00 slot observed at 01:00 belongs to the previous day, or it would
    // be recorded against a day it did not run on.
    expect(slotDateFor('03:00', 3, new Date(2026, 7, 20, 1, 0))).toBe('2026-08-19');
  });

  it('is today exactly at the first slot time', () => {
    expect(slotDateFor('03:00', 3, new Date(2026, 7, 20, 3, 0))).toBe('2026-08-20');
  });
});

describe('nextSlotOccurrence', () => {
  it('rolls to tomorrow when the day\'s only slot has passed', () => {
    const now = new Date(2026, 7, 20, 9, 0);
    const next = nextSlotOccurrence('03:00', 1, now);

    expect(next.slot).toBe(0);
    expect(new Date(next.when).getDate()).toBe(21);
    expect(new Date(next.when).getHours()).toBe(3);
  });

  it('picks the next slot later the same day', () => {
    const now = new Date(2026, 7, 20, 9, 0);
    const next = nextSlotOccurrence('03:00', 3, now);

    expect(next.slot).toBe(1);
    expect(new Date(next.when).getDate()).toBe(20);
    expect(new Date(next.when).getHours()).toBe(11);
  });

  it('wraps to tomorrow\'s first slot after the day\'s last', () => {
    const now = new Date(2026, 7, 20, 20, 0);
    const next = nextSlotOccurrence('03:00', 3, now);

    expect(next.slot).toBe(0);
    expect(new Date(next.when).getDate()).toBe(21);
    expect(new Date(next.when).getHours()).toBe(3);
  });

  it('always returns a time strictly in the future', () => {
    // Exactly on a slot boundary must advance, not return the current instant.
    const now = new Date(2026, 7, 20, 11, 0, 0, 0);
    const next = nextSlotOccurrence('03:00', 3, now);

    expect(next.when).toBeGreaterThan(now.getTime());
    expect(next.slot).toBe(2);
  });

  it('keeps slots at a fixed local time rather than a fixed offset', () => {
    // Computing slot k as "base + k*8h of real time" would shift every later
    // slot by an hour across a DST boundary. Local wall-clock times do not.
    const next = nextSlotOccurrence('03:00', 3, new Date(2026, 7, 20, 5, 0));
    const scheduled = new Date(next.when);

    expect(scheduled.getHours()).toBe(11);
    expect(scheduled.getMinutes()).toBe(0);
  });
});

describe('malformed scansPerDay', () => {
  // Settings validation rejects anything outside an integer 1-4 on every write,
  // but getWithDefaults merges stored values without re-validating. A 0 or NaN
  // reaching the arithmetic would make 24/N infinite or NaN, propagate through
  // setHours, and yield an alarm time of NaN — scanning would stop permanently
  // and silently. These pin the clamp that makes that impossible.
  for (const bad of [0, -3, NaN, Infinity, 2.7, 99]) {
    it(`produces a usable schedule for scansPerDay=${bad}`, () => {
      const now = new Date(2026, 7, 20, 9, 0);

      const time = slotScanTime('03:00', 0, bad as number);
      expect(time).toMatch(/^\d{2}:\d{2}$/);

      const slot = currentSlot('03:00', bad as number, now);
      expect(Number.isInteger(slot)).toBe(true);
      expect(slot).toBeGreaterThanOrEqual(0);

      const next = nextSlotOccurrence('03:00', bad as number, now);
      expect(Number.isFinite(next.when)).toBe(true);
      expect(next.when).toBeGreaterThan(now.getTime());
    });
  }
});

describe('slotKey', () => {
  it('identifies one slot on one day', () => {
    expect(slotKey('2026-08-28', 1)).toBe('2026-08-28#1');
  });

  it('distinguishes slots within a day', () => {
    expect(slotKey('2026-08-28', 0)).not.toBe(slotKey('2026-08-28', 1));
  });
});
