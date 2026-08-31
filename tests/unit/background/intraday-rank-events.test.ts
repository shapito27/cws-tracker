/**
 * Rank change detection with more than one scan per day.
 *
 * Two behaviours are load-bearing here and pull in opposite directions:
 *
 * - A position change should be compared against the previous *sample*, so an
 *   intraday move is reported when it happens instead of being invisible until
 *   tomorrow. That is the entire point of scanning more often.
 * - The drop debounce ("two consecutive nulls confirm an Out") must stay keyed
 *   on *days*. Keying it on samples would make scansPerDay: 4 confirm a drop
 *   four times as fast, quietly redefining what an "Out" means whenever the
 *   user changes an unrelated setting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/shared/db/database';
import { resetChromeMock } from '../../mocks/chrome';
import { SettingsManager } from '@/shared/utils/settings';
import type { Project, Keyword, RankSnapshot } from '@/shared/types';

const EXT_OWN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const KEYWORD_ID = 1;

async function seed(): Promise<void> {
  const project: Project = {
    id: 1,
    name: 'Test',
    ownExtensionId: EXT_OWN,
    competitorIds: [],
    keywordIds: [KEYWORD_ID],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.saveProject(project);
  const keyword: Keyword = {
    id: KEYWORD_ID,
    text: 'ad blocker',
    projectId: 1,
    createdAt: new Date(),
  };
  await db.saveKeyword(keyword);
  await db.saveExtension({
    id: EXT_OWN,
    name: 'Own',
    iconUrl: null,
    addedAt: new Date(),
    lastScannedAt: null,
    status: 'active',
    projectRefs: [1],
  });
}

function snap(
  date: string,
  time: string,
  position: number | null,
  slot = 0
): RankSnapshot {
  return {
    keywordId: KEYWORD_ID,
    extensionId: EXT_OWN,
    date,
    slot,
    position,
    totalResults: 100,
    scannedAt: new Date(`${date}T${time}`),
  };
}

beforeEach(async () => {
  resetChromeMock();
  vi.resetModules();
  await db.projects.clear();
  await db.extensions.clear();
  await db.keywords.clear();
  await db.rank_snapshots.clear();
  await db.events.clear();
  await db.queue.clear();
  await db.scan_logs.clear();
  await seed();
});

describe('detectRankChanges across intraday samples', () => {
  it('compares against the previous sample of the same day', async () => {
    const { detectRankChanges } = await import('@/background/queue-processor');

    // Morning: #9. Midday: #5 — a real intraday move.
    await db.saveRankSnapshots([snap('2026-08-20', '06:00:00', 9, 0)]);
    const midday = snap('2026-08-20', '14:00:00', 5, 1);
    await db.saveRankSnapshots([midday]);

    await detectRankChanges([midday], 'ad blocker', EXT_OWN, {
      fetchPage: vi.fn(),
      sendMessage: vi.fn(),
      settings: new SettingsManager(),
    });

    const events = await db.events.toArray();
    expect(events).toHaveLength(1);
    expect(events[0].oldValue).toBe('9');
    expect(events[0].newValue).toBe('5');
    // The window is the two samples, ~8h apart — not a whole day.
    expect(events[0].lastSeenOldAt).toEqual(new Date('2026-08-20T06:00:00'));
    expect(events[0].firstSeenNewAt).toEqual(new Date('2026-08-20T14:00:00'));
  });

  it('records the keyword id instead of relying on the note text', async () => {
    const { detectRankChanges } = await import('@/background/queue-processor');

    await db.saveRankSnapshots([snap('2026-08-19', '06:00:00', 9, 0)]);
    const today = snap('2026-08-20', '06:00:00', 5, 0);
    await db.saveRankSnapshots([today]);

    await detectRankChanges([today], 'ad blocker', EXT_OWN, {
      fetchPage: vi.fn(),
      sendMessage: vi.fn(),
      settings: new SettingsManager(),
    });

    const [event] = await db.events.toArray();
    expect(event.keywordId).toBe(KEYWORD_ID);
    expect(event.slot).toBe(0);
  });

  it('re-running one slot replaces only that slot\'s events', async () => {
    const { detectRankChanges } = await import('@/background/queue-processor');
    const deps = { fetchPage: vi.fn(), sendMessage: vi.fn(), settings: new SettingsManager() };

    await db.saveRankSnapshots([snap('2026-08-19', '06:00:00', 9, 0)]);

    // Slot 0 moves 9 → 5.
    const slot0 = snap('2026-08-20', '06:00:00', 5, 0);
    await db.saveRankSnapshots([slot0]);
    await detectRankChanges([slot0], 'ad blocker', EXT_OWN, deps);

    // Slot 1 moves 5 → 3.
    const slot1 = snap('2026-08-20', '14:00:00', 3, 1);
    await db.saveRankSnapshots([slot1]);
    await detectRankChanges([slot1], 'ad blocker', EXT_OWN, deps);

    // Both transitions are real and both survive — the old note-substring dedup
    // would have deleted the first when the second ran.
    let events = await db.events.toArray();
    expect(events).toHaveLength(2);

    // Re-running slot 1 replaces its own event only.
    await db.saveRankSnapshots([slot1]);
    await detectRankChanges([slot1], 'ad blocker', EXT_OWN, deps);

    events = await db.events.toArray();
    expect(events).toHaveLength(2);
    expect(events.filter((e) => (e.slot ?? 0) === 0)).toHaveLength(1);
    expect(events.filter((e) => e.slot === 1)).toHaveLength(1);
  });
});

describe('drop debounce stays day-based', () => {
  it('does not confirm an Out from consecutive nulls within one day', async () => {
    const { detectRankChanges } = await import('@/background/queue-processor');
    const deps = { fetchPage: vi.fn(), sendMessage: vi.fn(), settings: new SettingsManager() };

    // Yesterday ranked #5, then three nulls today.
    await db.saveRankSnapshots([snap('2026-08-19', '06:00:00', 5, 0)]);

    for (const [i, time] of ['06:00:00', '14:00:00', '22:00:00'].entries()) {
      const s = snap('2026-08-20', time, null, i);
      await db.saveRankSnapshots([s]);
      await detectRankChanges([s], 'ad blocker', EXT_OWN, deps);
    }

    // All three are provisional: the extension was ranked as recently as
    // yesterday, and nothing since has crossed a day boundary.
    const events = await db.events.toArray();
    expect(events.filter((e) => e.type === 'rank_change')).toHaveLength(0);
  });

  it('confirms an Out once a null lands on a later day', async () => {
    const { detectRankChanges } = await import('@/background/queue-processor');
    const deps = { fetchPage: vi.fn(), sendMessage: vi.fn(), settings: new SettingsManager() };

    await db.saveRankSnapshots([snap('2026-08-19', '06:00:00', 5, 0)]);
    const firstNull = snap('2026-08-20', '06:00:00', null, 0);
    await db.saveRankSnapshots([firstNull]);
    await detectRankChanges([firstNull], 'ad blocker', EXT_OWN, deps);
    expect(await db.events.count()).toBe(0);

    const nextDayNull = snap('2026-08-21', '06:00:00', null, 0);
    await db.saveRankSnapshots([nextDayNull]);
    await detectRankChanges([nextDayNull], 'ad blocker', EXT_OWN, deps);

    const events = await db.events.toArray();
    expect(events).toHaveLength(1);
    expect(events[0].note).toContain('dropped out of top 30');
  });
});
