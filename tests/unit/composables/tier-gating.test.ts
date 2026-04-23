/**
 * Tests verifying tier gates are enforced in composables.
 *
 * Free tier limits: 1 project, 3 extensions per project, 5 keywords per project.
 * Pro tier: unlimited.
 *
 * Gate errors should be human-readable and mention upgrading to Pro.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetChromeMock, chromeMock } from '../../mocks/chrome';
import { useProjects } from '@/dashboard/composables/useProjects';
import { useKeywords } from '@/dashboard/composables/useKeywords';
import { SettingsManager } from '@/shared/utils/settings';
import { db } from '@/shared/db/database';

async function setPlan(plan: 'free' | 'pro'): Promise<void> {
  const settings = new SettingsManager();
  await settings.set('subscriptionStatus', plan);
}

async function seedProject(ownExtId = 'a'.repeat(32)): Promise<number> {
  await db.extensions.put({
    id: ownExtId, name: '', iconUrl: null,
    addedAt: new Date(), lastScannedAt: null,
    status: 'active', projectRefs: [],
  });
  const id = await db.projects.add({
    name: 'Project', ownExtensionId: ownExtId,
    competitorIds: [], keywordIds: [],
    createdAt: new Date(), updatedAt: new Date(),
  });
  return id as number;
}

describe('tier gates — createProject', () => {
  beforeEach(async () => {
    resetChromeMock();
    (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
    await db.projects.clear();
    await db.extensions.clear();
    await db.keywords.clear();
  });

  afterEach(() => {});

  it('allows free user to create the first project', async () => {
    await setPlan('free');
    const { createProject } = useProjects();
    await expect(createProject('a'.repeat(32))).resolves.toBeTruthy();
  });

  it('blocks free user from creating a second project', async () => {
    await setPlan('free');
    await seedProject('a'.repeat(32));
    const { createProject } = useProjects();
    await expect(createProject('b'.repeat(32))).rejects.toThrow(/Pro/i);
  });

  it('allows pro user to create many projects', async () => {
    await setPlan('pro');
    await seedProject('a'.repeat(32));
    await seedProject('b'.repeat(32));
    const { createProject } = useProjects();
    await expect(createProject('c'.repeat(32))).resolves.toBeTruthy();
  });
});

describe('tier gates — addCompetitor', () => {
  beforeEach(async () => {
    resetChromeMock();
    (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
    await db.projects.clear();
    await db.extensions.clear();
    await db.keywords.clear();
  });

  it('allows free user to add up to 2 competitors (own + 2 = 3 total)', async () => {
    await setPlan('free');
    const projectId = await seedProject();
    const { addCompetitor } = useProjects();
    await addCompetitor(projectId, 'b'.repeat(32));
    await addCompetitor(projectId, 'c'.repeat(32));
    const project = await db.getProject(projectId);
    expect(project!.competitorIds).toHaveLength(2);
  });

  it('blocks free user from adding a 3rd competitor', async () => {
    await setPlan('free');
    const projectId = await seedProject();
    const { addCompetitor } = useProjects();
    await addCompetitor(projectId, 'b'.repeat(32));
    await addCompetitor(projectId, 'c'.repeat(32));
    await expect(addCompetitor(projectId, 'd'.repeat(32))).rejects.toThrow(/Pro/i);
  });

  it('allows pro user to add many competitors', async () => {
    await setPlan('pro');
    const projectId = await seedProject();
    const { addCompetitor } = useProjects();
    for (let i = 0; i < 10; i++) {
      const extId = String.fromCharCode(98 + i).repeat(32);
      await addCompetitor(projectId, extId);
    }
    const project = await db.getProject(projectId);
    expect(project!.competitorIds).toHaveLength(10);
  });
});

describe('tier gates — addKeyword', () => {
  beforeEach(async () => {
    resetChromeMock();
    (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
    await db.projects.clear();
    await db.extensions.clear();
    await db.keywords.clear();
  });

  it('allows free user up to 5 keywords per project', async () => {
    await setPlan('free');
    const projectId = await seedProject();
    const { addKeyword } = useKeywords();
    for (let i = 0; i < 5; i++) {
      await addKeyword(projectId, `kw-${i}`);
    }
    const keywords = await db.getKeywordsByProject(projectId);
    expect(keywords).toHaveLength(5);
  });

  it('blocks free user at 6th keyword', async () => {
    await setPlan('free');
    const projectId = await seedProject();
    const { addKeyword } = useKeywords();
    for (let i = 0; i < 5; i++) {
      await addKeyword(projectId, `kw-${i}`);
    }
    await expect(addKeyword(projectId, 'kw-6')).rejects.toThrow(/Pro/i);
  });

  it('allows pro user unlimited keywords', async () => {
    await setPlan('pro');
    const projectId = await seedProject();
    const { addKeyword } = useKeywords();
    for (let i = 0; i < 20; i++) {
      await addKeyword(projectId, `kw-${i}`);
    }
    const keywords = await db.getKeywordsByProject(projectId);
    expect(keywords).toHaveLength(20);
  });
});
