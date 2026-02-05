/**
 * Composable for keyword CRUD operations within a project.
 */

import { ref } from 'vue';
import type { Keyword } from '@/shared/types';
import { db } from '@/shared/db/database';

export function useKeywords() {
  const keywords = ref<Keyword[]>([]);
  const loading = ref(false);

  async function loadKeywords(projectId: number): Promise<void> {
    loading.value = true;
    try {
      keywords.value = await db.getKeywordsByProject(projectId);
    } catch (e) {
      console.error('Failed to load keywords:', e);
      keywords.value = [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * Add a keyword to a project. Rejects duplicates within the same project.
   */
  async function addKeyword(
    projectId: number,
    text: string
  ): Promise<Keyword> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Keyword text cannot be empty');
    }

    // Check for duplicate within the same project
    const existing = await db.getKeywordsByProject(projectId);
    const duplicate = existing.find(
      (kw) => kw.text.toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      throw new Error(
        `Keyword "${trimmed}" already exists in this project`
      );
    }

    const keyword: Keyword = {
      text: trimmed,
      projectId,
      createdAt: new Date(),
    };

    const id = await db.saveKeyword(keyword);
    keyword.id = id;

    // Update project's keywordIds
    const project = await db.getProject(projectId);
    if (project) {
      project.keywordIds.push(id);
      project.updatedAt = new Date();
      await db.saveProject(project);
    }

    await loadKeywords(projectId);
    return keyword;
  }

  /**
   * Remove a keyword by ID.
   */
  async function removeKeyword(
    keywordId: number,
    projectId: number
  ): Promise<void> {
    await db.deleteKeyword(keywordId);

    // Update project's keywordIds
    const project = await db.getProject(projectId);
    if (project) {
      project.keywordIds = project.keywordIds.filter(
        (id) => id !== keywordId
      );
      project.updatedAt = new Date();
      await db.saveProject(project);
    }

    await loadKeywords(projectId);
  }

  return {
    keywords,
    loading,
    loadKeywords,
    addKeyword,
    removeKeyword,
  };
}
