/**
 * Composable for extension data access.
 *
 * Provides methods to retrieve extensions by project and
 * get the latest listing snapshot for an extension.
 */

import type { Extension, ListingSnapshot, Project } from '@/shared/types';
import { db } from '@/shared/db/database';

export function useExtensions() {
  /**
   * Get all extensions (own + competitors) for a project.
   */
  async function getExtensionsByProject(
    projectId: number
  ): Promise<Extension[]> {
    try {
      const project = await db.getProject(projectId);
      if (!project) return [];

      const allIds = [project.ownExtensionId, ...project.competitorIds];
      const extensions: Extension[] = [];

      for (const id of allIds) {
        const ext = await db.getExtension(id);
        if (ext) {
          extensions.push(ext);
        }
      }

      return extensions;
    } catch (e) {
      console.error('Failed to get extensions for project:', e);
      return [];
    }
  }

  /**
   * Get all extension IDs tracked across all projects in a set.
   */
  async function getAllTrackedExtensionIds(
    projects: Project[]
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const project of projects) {
      ids.add(project.ownExtensionId);
      for (const cid of project.competitorIds) {
        ids.add(cid);
      }
    }
    return ids;
  }

  /**
   * Get the latest listing snapshot for a given extension.
   */
  async function getLatestSnapshot(
    extensionId: string
  ): Promise<ListingSnapshot | undefined> {
    try {
      return await db.getLatestListingSnapshot(extensionId);
    } catch (e) {
      console.error('Failed to get latest snapshot:', e);
      return undefined;
    }
  }

  return {
    getExtensionsByProject,
    getAllTrackedExtensionIds,
    getLatestSnapshot,
  };
}
