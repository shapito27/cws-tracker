/**
 * Tests for useKeywords composable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import { useKeywords } from '@/dashboard/composables/useKeywords';
import type { Project } from '@/shared/types';

let testProject: Project;

beforeEach(async () => {
  // Clear all tables
  await db.projects.clear();
  await db.extensions.clear();
  await db.keywords.clear();
  await db.listing_snapshots.clear();
  await db.rank_snapshots.clear();
  await db.events.clear();
  await db.queue.clear();
  await db.translation_snapshots.clear();

  // Create a test project
  const now = new Date();
  const id = await db.saveProject({
    name: 'Test Project',
    ownExtensionId: 'cjpalhdlnbpafiamejdnhcphjbkeiagm',
    competitorIds: [],
    keywordIds: [],
    createdAt: now,
    updatedAt: now,
  });

  testProject = (await db.getProject(id))!;
});

describe('useKeywords', () => {
  describe('addKeyword', () => {
    it('adds a keyword to the project', async () => {
      const { addKeyword } = useKeywords();
      const kw = await addKeyword(testProject.id!, 'ad blocker');

      expect(kw.id).toBeDefined();
      expect(kw.text).toBe('ad blocker');
      expect(kw.projectId).toBe(testProject.id);
    });

    it('updates project keywordIds after adding', async () => {
      const { addKeyword } = useKeywords();
      const kw = await addKeyword(testProject.id!, 'ad blocker');

      const project = await db.getProject(testProject.id!);
      expect(project!.keywordIds).toContain(kw.id);
    });

    it('rejects duplicate keyword text in same project', async () => {
      const { addKeyword } = useKeywords();
      await addKeyword(testProject.id!, 'ad blocker');

      await expect(
        addKeyword(testProject.id!, 'ad blocker')
      ).rejects.toThrow('already exists');
    });

    it('rejects duplicate keyword text case-insensitively', async () => {
      const { addKeyword } = useKeywords();
      await addKeyword(testProject.id!, 'Ad Blocker');

      await expect(
        addKeyword(testProject.id!, 'ad blocker')
      ).rejects.toThrow('already exists');
    });

    it('allows same keyword text in different projects', async () => {
      const now = new Date();
      const project2Id = await db.saveProject({
        name: 'Project 2',
        ownExtensionId: 'ogfcmafjalglgifnmanfmnieipoejdcf',
        competitorIds: [],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });

      const { addKeyword } = useKeywords();
      await addKeyword(testProject.id!, 'ad blocker');
      const kw2 = await addKeyword(project2Id, 'ad blocker');

      expect(kw2.text).toBe('ad blocker');
      expect(kw2.projectId).toBe(project2Id);
    });

    it('trims whitespace from keyword text', async () => {
      const { addKeyword } = useKeywords();
      const kw = await addKeyword(testProject.id!, '  ad blocker  ');
      expect(kw.text).toBe('ad blocker');
    });

    it('rejects empty keyword text', async () => {
      const { addKeyword } = useKeywords();
      await expect(addKeyword(testProject.id!, '')).rejects.toThrow(
        'cannot be empty'
      );
    });

    it('rejects whitespace-only keyword text', async () => {
      const { addKeyword } = useKeywords();
      await expect(addKeyword(testProject.id!, '   ')).rejects.toThrow(
        'cannot be empty'
      );
    });
  });

  describe('removeKeyword', () => {
    it('removes keyword from DB and project keywordIds', async () => {
      const { addKeyword, removeKeyword } = useKeywords();
      const kw = await addKeyword(testProject.id!, 'ad blocker');

      await removeKeyword(kw.id!, testProject.id!);

      const keywords = await db.getKeywordsByProject(testProject.id!);
      expect(keywords).toHaveLength(0);

      const project = await db.getProject(testProject.id!);
      expect(project!.keywordIds).not.toContain(kw.id);
    });
  });

  describe('loadKeywords', () => {
    it('loads all keywords for a project', async () => {
      const { addKeyword, loadKeywords, keywords } = useKeywords();
      await addKeyword(testProject.id!, 'ad blocker');
      await addKeyword(testProject.id!, 'vpn extension');

      await loadKeywords(testProject.id!);
      expect(keywords.value).toHaveLength(2);
    });

    it('returns empty array for project with no keywords', async () => {
      const { loadKeywords, keywords } = useKeywords();
      await loadKeywords(testProject.id!);
      expect(keywords.value).toHaveLength(0);
    });

    it('sets keywords to empty array when db throws', async () => {
      const spy = vi
        .spyOn(db, 'getKeywordsByProject')
        .mockRejectedValueOnce(new Error('DB error'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const { loadKeywords, keywords } = useKeywords();
      await loadKeywords(testProject.id!);

      expect(keywords.value).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load keywords:',
        expect.any(Error)
      );

      spy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('sets loading to false even when db throws', async () => {
      const spy = vi
        .spyOn(db, 'getKeywordsByProject')
        .mockRejectedValueOnce(new Error('DB error'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const { loadKeywords, loading } = useKeywords();
      await loadKeywords(testProject.id!);

      expect(loading.value).toBe(false);

      spy.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});
