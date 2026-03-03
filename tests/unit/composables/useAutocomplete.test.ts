/**
 * Tests for useAutocomplete composable - iconUrl propagation on chart series.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import {
  loadAutocompleteHistory,
  loadOwnExtensionAutocompleteHistory,
} from '@/dashboard/composables/useAutocomplete';
import type { Extension, Keyword, AutocompleteSnapshot } from '@/shared/types';

const EXT_A_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const extA: Extension = {
  id: EXT_A_ID,
  name: 'Extension A',
  iconUrl: null,
  addedAt: new Date(),
  lastScannedAt: null,
  status: 'active',
  projectRefs: [1],
};

const kw1: Keyword = { id: 1, projectId: 1, text: 'ad blocker', createdAt: new Date() };

function makeAcSnapshot(
  keywordId: number,
  extensionId: string,
  date: string,
  position: number
): AutocompleteSnapshot {
  return {
    keywordId,
    extensionId,
    date,
    position,
    suggestedName: 'Test Extension',
    scannedAt: new Date(),
  };
}

beforeEach(async () => {
  await db.autocomplete_snapshots.clear();
});

describe('loadAutocompleteHistory - iconUrl', () => {
  it('carries iconUrl from extension onto the series', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-01-01', 3),
    ]);
    const extWithIcon: Extension = {
      ...extA,
      iconUrl: 'https://lh3.googleusercontent.com/icon.png',
    };

    const series = await loadAutocompleteHistory(1, [extWithIcon], '2026-01-01', '2026-01-01');

    expect(series[0].iconUrl).toBe('https://lh3.googleusercontent.com/icon.png');
  });

  it('carries iconUrl=null when extension has no icon', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-01-01', 3),
    ]);

    const series = await loadAutocompleteHistory(1, [extA], '2026-01-01', '2026-01-01');

    expect(series[0].iconUrl).toBeNull();
  });
});

describe('loadOwnExtensionAutocompleteHistory - iconUrl', () => {
  it('does not set iconUrl on keyword-mode series', async () => {
    await db.autocomplete_snapshots.bulkAdd([
      makeAcSnapshot(1, EXT_A_ID, '2026-01-01', 3),
    ]);

    const series = await loadOwnExtensionAutocompleteHistory(
      [kw1],
      EXT_A_ID,
      '2026-01-01',
      '2026-01-01'
    );

    expect(series).toHaveLength(1);
    expect('iconUrl' in series[0]).toBe(false);
  });
});
