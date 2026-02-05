<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Project, Extension, Keyword, ListingSnapshot, RankSnapshot } from '@/shared/types';
import { db } from '@/shared/db/database';
import { useKeywords } from '../../composables/useKeywords';
import { useExtensions } from '../../composables/useExtensions';
import {
  buildKeywordFrequencyMatrix,
  hasLowerDensity,
  analyzeKeywordGaps,
  estimateKeywordDifficulty,
  type KeywordFrequencyRow,
  type KeywordGapSuggestion,
  type KeywordDifficultyResult,
} from '@/shared/utils/keyword-analysis';

const props = defineProps<{
  project: Project;
}>();

const { keywords, loadKeywords } = useKeywords();
const { getExtensionsByProject, getLatestSnapshot } = useExtensions();

const extensions = ref<Extension[]>([]);
const snapshots = ref<Map<string, ListingSnapshot>>(new Map());
const frequencyMatrix = ref<KeywordFrequencyRow[]>([]);
const gapSuggestions = ref<KeywordGapSuggestion[]>([]);
const difficultyResults = ref<KeywordDifficultyResult[]>([]);
const loading = ref(true);
const activeSection = ref<'frequency' | 'gaps' | 'difficulty'>('frequency');

const ownExtensionId = computed(() => props.project.ownExtensionId);

async function loadData(): Promise<void> {
  loading.value = true;
  try {
    await loadKeywords(props.project.id!);
    extensions.value = await getExtensionsByProject(props.project.id!);

    // Load latest snapshots for all extensions
    const snapshotMap = new Map<string, ListingSnapshot>();
    for (const ext of extensions.value) {
      const snap = await getLatestSnapshot(ext.id);
      if (snap) {
        snapshotMap.set(ext.id, snap);
      }
    }
    snapshots.value = snapshotMap;

    // Build frequency matrix
    const keywordTexts = keywords.value.map(k => k.text);
    frequencyMatrix.value = buildKeywordFrequencyMatrix(keywordTexts, snapshotMap);

    // Gap analysis
    const ownSnap = snapshotMap.get(ownExtensionId.value) ?? null;
    const competitorSnaps = extensions.value
      .filter(e => e.id !== ownExtensionId.value)
      .map(e => snapshotMap.get(e.id))
      .filter((s): s is ListingSnapshot => s !== undefined);
    gapSuggestions.value = analyzeKeywordGaps(ownSnap, competitorSnaps, keywordTexts);

    // Keyword difficulty
    const keywordRankings = new Map<string, RankSnapshot[]>();
    for (const kw of keywords.value) {
      if (kw.id === undefined) continue;
      const latest = await db.getLatestRankForKeyword(kw.id);
      keywordRankings.set(kw.text, latest);
    }
    difficultyResults.value = estimateKeywordDifficulty(keywordRankings, snapshotMap);
  } catch (e) {
    console.error('Failed to load keyword analysis data:', e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);

function getExtensionName(extensionId: string): string {
  const ext = extensions.value.find(e => e.id === extensionId);
  return ext?.name || extensionId.slice(0, 8) + '...';
}

function isOwnExtension(extensionId: string): boolean {
  return extensionId === ownExtensionId.value;
}

function getDifficultyColor(score: number): string {
  if (score >= 70) return 'text-red-600';
  if (score >= 40) return 'text-yellow-600';
  return 'text-green-600';
}

function getDifficultyLabel(score: number): string {
  if (score >= 70) return 'Hard';
  if (score >= 40) return 'Medium';
  return 'Easy';
}

const sections = [
  { id: 'frequency' as const, label: 'Frequency Matrix' },
  { id: 'gaps' as const, label: 'Gap Analysis' },
  { id: 'difficulty' as const, label: 'Difficulty' },
];
</script>

<template>
  <div>
    <!-- Section tabs -->
    <div class="mb-4 flex gap-2">
      <button
        v-for="section in sections"
        :key="section.id"
        class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
        :class="activeSection === section.id
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
        @click="activeSection = section.id"
      >
        {{ section.label }}
      </button>
    </div>

    <div v-if="loading" class="text-center py-8">
      <p class="text-sm text-gray-500">Loading keyword analysis...</p>
    </div>

    <div v-else-if="keywords.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
      <p class="text-sm text-gray-500">Add keywords to your project to see analysis.</p>
    </div>

    <template v-else>
      <!-- Frequency Matrix (2.4.2) -->
      <div v-if="activeSection === 'frequency'">
        <p class="mb-3 text-sm text-gray-600">
          How often each keyword appears in each extension's listing fields.
        </p>

        <div v-if="frequencyMatrix.length === 0" class="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p class="text-sm text-gray-500">No frequency data available.</p>
        </div>

        <div v-else class="overflow-x-auto rounded-lg border border-gray-200">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Keyword
                </th>
                <th
                  v-for="ext in extensions"
                  :key="ext.id"
                  class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500"
                  colspan="3"
                >
                  <span :class="isOwnExtension(ext.id) ? 'text-blue-600' : ''">
                    {{ getExtensionName(ext.id) }}
                  </span>
                </th>
              </tr>
              <tr class="bg-gray-50">
                <th class="px-4 py-1"></th>
                <template v-for="ext in extensions" :key="'sub-' + ext.id">
                  <th class="px-2 py-1 text-center text-[10px] font-medium text-gray-400">Title</th>
                  <th class="px-2 py-1 text-center text-[10px] font-medium text-gray-400">Short</th>
                  <th class="px-2 py-1 text-center text-[10px] font-medium text-gray-400">Full</th>
                </template>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 bg-white">
              <tr
                v-for="row in frequencyMatrix"
                :key="row.keyword"
                class="hover:bg-gray-50"
                :class="hasLowerDensity(row, ownExtensionId) ? 'bg-yellow-50' : ''"
              >
                <td class="px-4 py-2.5 text-sm font-medium text-gray-900">
                  {{ row.keyword }}
                  <span
                    v-if="hasLowerDensity(row, ownExtensionId)"
                    class="ml-1.5 inline-flex rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700"
                  >
                    lower
                  </span>
                </td>
                <template v-for="cell in row.cells" :key="cell.extensionId">
                  <td class="px-2 py-2.5 text-center text-sm"
                    :class="cell.titleCount > 0 ? 'text-green-700 font-medium' : 'text-gray-400'"
                  >
                    {{ cell.titleCount }}
                  </td>
                  <td class="px-2 py-2.5 text-center text-sm"
                    :class="cell.shortDescCount > 0 ? 'text-green-700 font-medium' : 'text-gray-400'"
                  >
                    {{ cell.shortDescCount }}
                  </td>
                  <td class="px-2 py-2.5 text-center text-sm"
                    :class="cell.fullDescCount > 0 ? 'text-green-700 font-medium' : 'text-gray-400'"
                  >
                    {{ cell.fullDescCount }}
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Gap Analysis (2.4.3) -->
      <div v-if="activeSection === 'gaps'">
        <p class="mb-3 text-sm text-gray-600">
          Keywords your competitors use that your extension doesn't.
        </p>

        <div v-if="gapSuggestions.length === 0" class="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p class="text-sm text-gray-500">No keyword gaps found. Your extension covers the same keywords as competitors.</p>
        </div>

        <div v-else class="overflow-x-auto rounded-lg border border-gray-200">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Keyword
                </th>
                <th class="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">
                  Competitors Using
                </th>
                <th class="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">
                  Total Frequency
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 bg-white">
              <tr
                v-for="gap in gapSuggestions"
                :key="gap.keyword"
                class="hover:bg-gray-50"
              >
                <td class="px-4 py-2.5 text-sm font-medium text-gray-900">
                  {{ gap.keyword }}
                </td>
                <td class="px-4 py-2.5 text-center text-sm text-gray-700">
                  {{ gap.competitorCount }}
                </td>
                <td class="px-4 py-2.5 text-center text-sm text-gray-700">
                  {{ gap.totalFrequency }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Keyword Difficulty (2.4.4) -->
      <div v-if="activeSection === 'difficulty'">
        <p class="mb-3 text-sm text-gray-600">
          Estimated difficulty based on the average rating, user count, and quality score of top-ranking extensions.
        </p>

        <div v-if="difficultyResults.length === 0" class="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p class="text-sm text-gray-500">No ranking data available for difficulty estimation.</p>
        </div>

        <div v-else class="overflow-x-auto rounded-lg border border-gray-200">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Keyword
                </th>
                <th class="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">
                  Difficulty
                </th>
                <th class="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">
                  Avg Rating
                </th>
                <th class="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">
                  Avg Users
                </th>
                <th class="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">
                  Avg Quality
                </th>
                <th class="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">
                  Sample
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 bg-white">
              <tr
                v-for="result in difficultyResults"
                :key="result.keyword"
                class="hover:bg-gray-50"
              >
                <td class="px-4 py-2.5 text-sm font-medium text-gray-900">
                  {{ result.keyword }}
                </td>
                <td class="px-4 py-2.5 text-center">
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                    :class="getDifficultyColor(result.difficultyScore)"
                  >
                    {{ result.difficultyScore }}
                    <span class="ml-1 font-normal">{{ getDifficultyLabel(result.difficultyScore) }}</span>
                  </span>
                </td>
                <td class="px-4 py-2.5 text-center text-sm text-gray-700">
                  {{ result.sampleSize > 0 ? result.averageRating.toFixed(1) : '-' }}
                </td>
                <td class="px-4 py-2.5 text-center text-sm text-gray-700">
                  {{ result.sampleSize > 0 ? result.averageUserCount.toLocaleString() : '-' }}
                </td>
                <td class="px-4 py-2.5 text-center text-sm text-gray-700">
                  {{ result.averageQualityScore !== null ? result.averageQualityScore.toFixed(1) : '-' }}
                </td>
                <td class="px-4 py-2.5 text-center text-sm text-gray-500">
                  {{ result.sampleSize }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
