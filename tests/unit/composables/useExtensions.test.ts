/**
 * Tests for useExtensions composable.
 *
 * Covers getExtensionsByProject and getLatestSnapshot error handling,
 * and getAllTrackedExtensionIds.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/shared/db/database';
import { useExtensions } from '@/dashboard/composables/useExtensions';
import type { Project, Extension } from '@/shared/types';

let testProject: Project;
let testExtension: Extension;
let competitorExtension: Extension;

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

  // Create test extensions
  const now = new Date();

  testExtension = {
    id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm',
    name: 'uBlock Origin',
    iconUrl: null,
    addedAt: now,
    lastScannedAt: null,
    status: 'active',
    projectRefs: [],
  };
  await db.saveExtension(testExtension);

  competitorExtension = {
    id: 'gighmmpiobklfepjocnamgkkbiglidom',
    name: 'AdBlock',
    iconUrl: null,
    addedAt: now,
    lastScannedAt: null,
    status: 'active',
    projectRefs: [],
  };
  await db.saveExtension(competitorExtension);

  // Create a test project
  const id = await db.saveProject({
    name: 'Test Project',
    ownExtensionId: testExtension.id,
    competitorIds: [competitorExtension.id],
    keywordIds: [],
    createdAt: now,
    updatedAt: now,
  });

  testProject = (await db.getProject(id))!;
});

describe('useExtensions', () => {
  describe('getExtensionsByProject', () => {
    it('returns extensions for a project (own + competitors)', async () => {
      const { getExtensionsByProject } = useExtensions();
      const extensions = await getExtensionsByProject(testProject.id!);

      expect(extensions).toHaveLength(2);
      expect(extensions[0].id).toBe(testExtension.id);
      expect(extensions[1].id).toBe(competitorExtension.id);
    });

    it('returns empty array when project not found', async () => {
      const { getExtensionsByProject } = useExtensions();
      const extensions = await getExtensionsByProject(99999);

      expect(extensions).toEqual([]);
    });

    it('returns empty array when db.getProject throws', async () => {
      const spy = vi
        .spyOn(db, 'getProject')
        .mockRejectedValueOnce(new Error('DB error'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const { getExtensionsByProject } = useExtensions();
      const extensions = await getExtensionsByProject(testProject.id!);

      expect(extensions).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to get extensions for project:',
        expect.any(Error)
      );

      spy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('skips extensions that do not exist in DB', async () => {
      // Add a non-existent competitor ID to the project
      testProject.competitorIds.push('nonexistent_extension_id');
      await db.saveProject(testProject);

      const { getExtensionsByProject } = useExtensions();
      const extensions = await getExtensionsByProject(testProject.id!);

      // Should only have the 2 real extensions, not the non-existent one
      expect(extensions).toHaveLength(2);
      expect(extensions.map((e) => e.id)).not.toContain(
        'nonexistent_extension_id'
      );
    });
  });

  describe('getLatestSnapshot', () => {
    it('returns snapshot when it exists', async () => {
      const now = new Date();
      await db.listing_snapshots.add({
        extensionId: testExtension.id,
        date: '2025-01-15',
        title: 'uBlock Origin',
        shortDescription: 'An efficient blocker',
        fullDescription: 'Full description here',
        rating: 4.5,
        ratingCount: 1000,
        reviewCount: 1000,
        userCount: '10,000,000+',
        userCountNumeric: 10000000,
        version: '1.50.0',
        lastUpdated: '2025-01-10',
        size: '4.12MiB',
        permissions: ['storage'],
        hostPermissions: [],
        permissionRiskScore: 10,
        badgeFlags: { featured: true },
        screenshotCount: 3,
        hasPromoVideo: false,
        translationCount: 5,
        availableLocales: ['en', 'ja', 'de', 'fr', 'es'],
        category: 'productivity',
        developerName: 'Raymond Hill',
        developerVerified: false,
        listingQualityScore: null,
        scannedAt: now,
      });

      const { getLatestSnapshot } = useExtensions();
      const snapshot = await getLatestSnapshot(testExtension.id);

      expect(snapshot).toBeDefined();
      expect(snapshot!.title).toBe('uBlock Origin');
      expect(snapshot!.extensionId).toBe(testExtension.id);
    });

    it('returns undefined when no snapshot exists', async () => {
      const { getLatestSnapshot } = useExtensions();
      const snapshot = await getLatestSnapshot('nonexistent_id');

      expect(snapshot).toBeUndefined();
    });

    it('returns undefined when db.getLatestListingSnapshot throws', async () => {
      const spy = vi
        .spyOn(db, 'getLatestListingSnapshot')
        .mockRejectedValueOnce(new Error('DB error'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const { getLatestSnapshot } = useExtensions();
      const snapshot = await getLatestSnapshot(testExtension.id);

      expect(snapshot).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to get latest snapshot:',
        expect.any(Error)
      );

      spy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('getAllTrackedExtensionIds', () => {
    it('collects all extension IDs from projects', async () => {
      const now = new Date();
      const project2Id = await db.saveProject({
        name: 'Project 2',
        ownExtensionId: 'another_ext_id',
        competitorIds: ['comp1', 'comp2'],
        keywordIds: [],
        createdAt: now,
        updatedAt: now,
      });
      const project2 = (await db.getProject(project2Id))!;

      const { getAllTrackedExtensionIds } = useExtensions();
      const ids = await getAllTrackedExtensionIds([testProject, project2]);

      expect(ids.size).toBe(5);
      expect(ids.has(testExtension.id)).toBe(true);
      expect(ids.has(competitorExtension.id)).toBe(true);
      expect(ids.has('another_ext_id')).toBe(true);
      expect(ids.has('comp1')).toBe(true);
      expect(ids.has('comp2')).toBe(true);
    });

    it('returns empty set for empty projects array', async () => {
      const { getAllTrackedExtensionIds } = useExtensions();
      const ids = await getAllTrackedExtensionIds([]);

      expect(ids.size).toBe(0);
    });
  });
});
