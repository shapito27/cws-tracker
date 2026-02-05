/**
 * Composable for project CRUD operations.
 *
 * Manages projects, extensions (own + competitors), and coordinates
 * with IndexedDB via the CWSDatabase class.
 */

import { ref } from 'vue';
import type { Project, Extension } from '@/shared/types';
import { db } from '@/shared/db/database';

/** Regex to extract a 32-char extension ID from a CWS URL or raw ID. */
const CWS_URL_PATTERN =
  /(?:chrome\.google\.com\/webstore\/detail\/[^/]*\/|chromewebstore\.google\.com\/detail\/[^/]*\/)?([a-z]{32})(?:[/?#]|$)/;

/**
 * Parse a CWS extension ID from a URL or raw 32-char ID.
 * Returns the extension ID or null if invalid.
 */
export function parseExtensionId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Direct 32-char lowercase letter ID
  if (/^[a-z]{32}$/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(CWS_URL_PATTERN);
  return match ? match[1] : null;
}

export function useProjects() {
  const projects = ref<Project[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadProjects(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      projects.value = await db.getAllProjects();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function createProject(
    name: string,
    ownExtensionInput: string
  ): Promise<Project> {
    const extensionId = parseExtensionId(ownExtensionInput);
    if (!extensionId) {
      throw new Error(
        'Invalid extension URL or ID. Provide a 32-character extension ID or a Chrome Web Store URL.'
      );
    }

    const now = new Date();

    // Create or update extension record
    const existing = await db.getExtension(extensionId);
    if (existing) {
      // Extension already tracked - will add project ref after project creation
    } else {
      await db.saveExtension({
        id: extensionId,
        name: '',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [],
      });
    }

    // Create project
    const project: Project = {
      name: name || extensionId,
      ownExtensionId: extensionId,
      competitorIds: [],
      keywordIds: [],
      createdAt: now,
      updatedAt: now,
    };

    const projectId = await db.saveProject(project);
    project.id = projectId;

    // Update extension projectRefs
    const ext = await db.getExtension(extensionId);
    if (ext) {
      if (!ext.projectRefs.includes(projectId)) {
        ext.projectRefs.push(projectId);
        await db.saveExtension(ext);
      }
    }

    await loadProjects();
    return project;
  }

  async function deleteProject(id: number): Promise<void> {
    const project = await db.getProject(id);
    if (!project) return;

    // Collect all extension IDs associated with this project
    const allExtIds = [project.ownExtensionId, ...project.competitorIds];

    // Remove project reference from each extension
    for (const extId of allExtIds) {
      const ext = await db.getExtension(extId);
      if (ext) {
        ext.projectRefs = ext.projectRefs.filter((ref) => ref !== id);
        await db.saveExtension(ext);
      }
    }

    // Delete keywords associated with this project
    const keywords = await db.getKeywordsByProject(id);
    for (const kw of keywords) {
      if (kw.id !== undefined) {
        await db.deleteKeyword(kw.id);
      }
    }

    await db.deleteProject(id);
    await loadProjects();
  }

  async function addCompetitor(
    projectId: number,
    extensionInput: string
  ): Promise<Extension> {
    const extensionId = parseExtensionId(extensionInput);
    if (!extensionId) {
      throw new Error(
        'Invalid extension URL or ID. Provide a 32-character extension ID or a Chrome Web Store URL.'
      );
    }

    const project = await db.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Prevent adding same competitor twice
    if (project.competitorIds.includes(extensionId)) {
      throw new Error('This extension is already a competitor in this project');
    }

    // Prevent adding own extension as competitor
    if (project.ownExtensionId === extensionId) {
      throw new Error('Cannot add own extension as a competitor');
    }

    const now = new Date();

    // Create or update extension record
    let ext = await db.getExtension(extensionId);
    if (!ext) {
      ext = {
        id: extensionId,
        name: '',
        iconUrl: null,
        addedAt: now,
        lastScannedAt: null,
        status: 'active',
        projectRefs: [],
      };
    }

    if (!ext.projectRefs.includes(projectId)) {
      ext.projectRefs.push(projectId);
    }
    await db.saveExtension(ext);

    // Update project
    project.competitorIds.push(extensionId);
    project.updatedAt = now;
    await db.saveProject(project);

    await loadProjects();
    return ext;
  }

  async function removeCompetitor(
    projectId: number,
    extensionId: string
  ): Promise<void> {
    const project = await db.getProject(projectId);
    if (!project) return;

    project.competitorIds = project.competitorIds.filter(
      (id) => id !== extensionId
    );
    project.updatedAt = new Date();
    await db.saveProject(project);

    // Remove project ref from extension
    const ext = await db.getExtension(extensionId);
    if (ext) {
      ext.projectRefs = ext.projectRefs.filter((ref) => ref !== projectId);
      await db.saveExtension(ext);
    }

    await loadProjects();
  }

  return {
    projects,
    loading,
    error,
    loadProjects,
    createProject,
    deleteProject,
    addCompetitor,
    removeCompetitor,
  };
}
