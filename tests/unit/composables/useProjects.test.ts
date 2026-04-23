/**
 * Tests for useProjects composable and parseExtensionId utility.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { resetChromeMock, chromeMock } from '../../mocks/chrome';
import { CWSDatabase } from '@/shared/db/database';
import { parseExtensionId, useProjects } from '@/dashboard/composables/useProjects';
import { SettingsManager } from '@/shared/utils/settings';

let db: CWSDatabase;

beforeEach(async () => {
  // Create fresh DB for each test
  db = new CWSDatabase('TestDB_' + Math.random().toString(36).slice(2));
});

// We need to replace the default db import in the composable.
// Since the composable imports from '@/shared/db/database', we need to
// work with the singleton. Instead, we'll test via the actual singleton
// and clear it between tests.

import { db as singletonDb } from '@/shared/db/database';

beforeEach(async () => {
  // Reset chrome storage and default to Pro plan — these tests predate
  // tier gating and aren't testing tier logic.
  resetChromeMock();
  (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
  await new SettingsManager().set('subscriptionStatus', 'pro');

  // Clear all tables in the singleton DB
  await singletonDb.projects.clear();
  await singletonDb.extensions.clear();
  await singletonDb.keywords.clear();
  await singletonDb.listing_snapshots.clear();
  await singletonDb.rank_snapshots.clear();
  await singletonDb.events.clear();
  await singletonDb.queue.clear();
  await singletonDb.translation_snapshots.clear();
});

describe('parseExtensionId', () => {
  it('parses a raw 32-char extension ID', () => {
    expect(parseExtensionId('cjpalhdlnbpafiamejdnhcphjbkeiagm')).toBe(
      'cjpalhdlnbpafiamejdnhcphjbkeiagm'
    );
  });

  it('parses from full CWS URL (old format)', () => {
    expect(
      parseExtensionId(
        'https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm'
      )
    ).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
  });

  it('parses from new CWS URL format', () => {
    expect(
      parseExtensionId(
        'https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm'
      )
    ).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
  });

  it('handles URL with query params', () => {
    expect(
      parseExtensionId(
        'https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm?hl=en'
      )
    ).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
  });

  it('trims whitespace', () => {
    expect(parseExtensionId('  cjpalhdlnbpafiamejdnhcphjbkeiagm  ')).toBe(
      'cjpalhdlnbpafiamejdnhcphjbkeiagm'
    );
  });

  it('returns null for empty string', () => {
    expect(parseExtensionId('')).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseExtensionId('not-a-valid-id')).toBeNull();
  });

  it('returns null for ID with uppercase letters', () => {
    expect(parseExtensionId('CJPALHDLNBPAFIAMEJDNHCPHJBKEIAGM')).toBeNull();
  });

  it('returns null for ID with wrong length', () => {
    expect(parseExtensionId('abc')).toBeNull();
  });
});

describe('useProjects', () => {
  describe('createProject', () => {
    it('creates project + extension records in DB', async () => {
      const { createProject } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      expect(project.id).toBeDefined();
      expect(project.name).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
      expect(project.ownExtensionId).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
      expect(project.competitorIds).toEqual([]);

      // Verify extension was created
      const ext = await singletonDb.getExtension('cjpalhdlnbpafiamejdnhcphjbkeiagm');
      expect(ext).toBeDefined();
      expect(ext!.projectRefs).toContain(project.id);
    });

    it('parses extension ID from full CWS URL', async () => {
      const { createProject } = useProjects();
      const project = await createProject(
        'https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      expect(project.ownExtensionId).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
    });

    it('parses extension ID from short URL or raw ID', async () => {
      const { createProject } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      expect(project.ownExtensionId).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
    });

    it('rejects invalid URLs/IDs', async () => {
      const { createProject } = useProjects();
      await expect(
        createProject('not-valid')
      ).rejects.toThrow('Invalid extension URL or ID');
    });

    it('uses extension ID as default name for new extensions', async () => {
      const { createProject } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      expect(project.name).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
    });

    it('uses existing extension name when extension already has a name', async () => {
      await singletonDb.saveExtension({
        id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm',
        name: 'uBlock Origin',
        iconUrl: null,
        addedAt: new Date(),
        lastScannedAt: new Date(),
        status: 'active',
        projectRefs: [],
      });

      const { createProject } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      expect(project.name).toBe('uBlock Origin');
    });

    it('falls back to extension ID when existing extension has empty name', async () => {
      await singletonDb.saveExtension({
        id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm',
        name: '',
        iconUrl: null,
        addedAt: new Date(),
        lastScannedAt: null,
        status: 'active',
        projectRefs: [],
      });

      const { createProject } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      expect(project.name).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
    });
  });

  describe('addCompetitor', () => {
    it('adds extension ID to project competitorIds and creates extension record', async () => {
      const { createProject, addCompetitor } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      const ext = await addCompetitor(
        project.id!,
        'ogfcmafjalglgifnmanfmnieipoejdcf'
      );

      expect(ext.id).toBe('ogfcmafjalglgifnmanfmnieipoejdcf');

      const updatedProject = await singletonDb.getProject(project.id!);
      expect(updatedProject!.competitorIds).toContain(
        'ogfcmafjalglgifnmanfmnieipoejdcf'
      );
    });

    it('adds projectRef to existing extension from another project', async () => {
      const { createProject, addCompetitor } = useProjects();
      const project1 = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );
      const project2 = await createProject(
        'ogfcmafjalglgifnmanfmnieipoejdcf'
      );

      // Add the same competitor to project 2 that is project 1's own ext
      await addCompetitor(project2.id!, 'cjpalhdlnbpafiamejdnhcphjbkeiagm');

      const ext = await singletonDb.getExtension('cjpalhdlnbpafiamejdnhcphjbkeiagm');
      expect(ext!.projectRefs).toContain(project1.id);
      expect(ext!.projectRefs).toContain(project2.id);
    });

    it('rejects adding the same competitor twice to one project', async () => {
      const { createProject, addCompetitor } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      await addCompetitor(project.id!, 'ogfcmafjalglgifnmanfmnieipoejdcf');
      await expect(
        addCompetitor(project.id!, 'ogfcmafjalglgifnmanfmnieipoejdcf')
      ).rejects.toThrow('already a competitor');
    });

    it('rejects adding own extension as competitor', async () => {
      const { createProject, addCompetitor } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      await expect(
        addCompetitor(project.id!, 'cjpalhdlnbpafiamejdnhcphjbkeiagm')
      ).rejects.toThrow('Cannot add own extension as a competitor');
    });
  });

  describe('removeCompetitor', () => {
    it('removes from competitorIds and decrements projectRefs', async () => {
      const { createProject, addCompetitor, removeCompetitor } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );
      await addCompetitor(project.id!, 'ogfcmafjalglgifnmanfmnieipoejdcf');

      await removeCompetitor(project.id!, 'ogfcmafjalglgifnmanfmnieipoejdcf');

      const updatedProject = await singletonDb.getProject(project.id!);
      expect(updatedProject!.competitorIds).not.toContain(
        'ogfcmafjalglgifnmanfmnieipoejdcf'
      );

      const ext = await singletonDb.getExtension('ogfcmafjalglgifnmanfmnieipoejdcf');
      expect(ext!.projectRefs).not.toContain(project.id);
    });

    it('when projectRefs becomes empty, extension has no refs', async () => {
      const { createProject, addCompetitor, removeCompetitor } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );
      await addCompetitor(project.id!, 'ogfcmafjalglgifnmanfmnieipoejdcf');

      await removeCompetitor(project.id!, 'ogfcmafjalglgifnmanfmnieipoejdcf');

      const ext = await singletonDb.getExtension('ogfcmafjalglgifnmanfmnieipoejdcf');
      expect(ext!.projectRefs).toHaveLength(0);
    });
  });

  describe('deleteProject', () => {
    it('removes project and handles all extension cleanup', async () => {
      const { createProject, addCompetitor, deleteProject } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );
      await addCompetitor(project.id!, 'ogfcmafjalglgifnmanfmnieipoejdcf');

      await deleteProject(project.id!);

      // Project should be gone
      const deleted = await singletonDb.getProject(project.id!);
      expect(deleted).toBeUndefined();

      // Extension projectRefs should be updated
      const ownExt = await singletonDb.getExtension('cjpalhdlnbpafiamejdnhcphjbkeiagm');
      expect(ownExt!.projectRefs).not.toContain(project.id);

      const compExt = await singletonDb.getExtension('ogfcmafjalglgifnmanfmnieipoejdcf');
      expect(compExt!.projectRefs).not.toContain(project.id);
    });

    it('deletes keywords belonging to the project', async () => {
      const { createProject, deleteProject } = useProjects();
      const project = await createProject(
        'cjpalhdlnbpafiamejdnhcphjbkeiagm'
      );

      // Add keywords
      await singletonDb.saveKeyword({
        text: 'ad blocker',
        projectId: project.id!,
        createdAt: new Date(),
      });

      await deleteProject(project.id!);

      const keywords = await singletonDb.getKeywordsByProject(project.id!);
      expect(keywords).toHaveLength(0);
    });
  });

  describe('loadProjects', () => {
    it('loads all projects from DB', async () => {
      const { createProject, loadProjects, projects } = useProjects();
      await createProject('cjpalhdlnbpafiamejdnhcphjbkeiagm');
      await createProject('ogfcmafjalglgifnmanfmnieipoejdcf');

      await loadProjects();
      expect(projects.value).toHaveLength(2);
    });
  });
});
