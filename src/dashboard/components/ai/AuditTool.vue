<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Project, Extension, Keyword, ListingSnapshot, RankSnapshot } from '@/shared/types';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import { useSettings } from '../../composables/useSettings';
import { OpenAIClient, OpenAIError } from '@/shared/utils/openai';
import {
  buildCacheKey,
  estimateAuditTokens,
  runKeywordAudit,
  type AuditInput,
  type AuditResult,
  type AuditRecommendation,
  type CachedAuditResult,
  type CustomAuditPrompts,
} from '@/shared/utils/keyword-audit';
import { today } from '@/shared/utils/dates';

const props = defineProps<{
  project: Project;
  /** Pre-selected keyword ID (from "Why higher?" button). */
  preSelectedKeywordId?: number;
  /** Pre-selected competitor extension ID (from "Why higher?" button). */
  preSelectedCompetitorId?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { getExtensionsByProject, getLatestSnapshot } = useExtensions();
const { settings, loadSettings } = useSettings();

// Data
const extensions = ref<Extension[]>([]);
const keywords = ref<Keyword[]>([]);
const snapshots = ref<Map<string, ListingSnapshot>>(new Map());
const latestRanks = ref<Map<string, Map<number, RankSnapshot>>>(new Map());
const loading = ref(true);

// Selection
const selectedKeywordId = ref<number | null>(null);
const selectedCompetitorId = ref<string | null>(null);

// Audit state
const running = ref(false);
const auditError = ref<string | null>(null);
const auditResult = ref<AuditResult | null>(null);
const fromCache = ref(false);

// Computed
const competitors = computed(() =>
  extensions.value.filter((e) => e.id !== props.project.ownExtensionId)
);

const canRun = computed(() =>
  selectedKeywordId.value !== null &&
  selectedCompetitorId.value !== null &&
  settings.openaiApiKey !== null
);

const customPrompts = computed<CustomAuditPrompts>(() => ({
  systemPrompt: settings.auditSystemPrompt || undefined,
  userPromptTemplate: settings.auditUserPromptTemplate || undefined,
}));

const costEstimate = computed(() => {
  if (!selectedKeywordId.value || !selectedCompetitorId.value) return null;

  const ownSnap = snapshots.value.get(props.project.ownExtensionId);
  const compSnap = snapshots.value.get(selectedCompetitorId.value);
  if (!ownSnap || !compSnap) return null;

  const ownRankMap = latestRanks.value.get(props.project.ownExtensionId);
  const compRankMap = latestRanks.value.get(selectedCompetitorId.value);

  const input: AuditInput = {
    keyword: keywords.value.find((k) => k.id === selectedKeywordId.value)?.text ?? '',
    ownListing: ownSnap,
    competitorListing: compSnap,
    ownPosition: ownRankMap?.get(selectedKeywordId.value)?.position ?? null,
    competitorPosition: compRankMap?.get(selectedKeywordId.value)?.position ?? null,
  };

  return estimateAuditTokens(input, customPrompts.value);
});

// Lifecycle
onMounted(async () => {
  await loadSettings();
  extensions.value = await getExtensionsByProject(props.project.id!);
  keywords.value = await db.getKeywordsByProject(props.project.id!);

  // Load snapshots and ranks
  const newSnapshots = new Map<string, ListingSnapshot>();
  const newRanks = new Map<string, Map<number, RankSnapshot>>();

  for (const ext of extensions.value) {
    const snap = await getLatestSnapshot(ext.id);
    if (snap) newSnapshots.set(ext.id, snap);
    newRanks.set(ext.id, new Map());
  }

  // Load latest ranks per keyword per extension
  for (const kw of keywords.value) {
    if (kw.id === undefined) continue;
    const ranks = await db.getLatestRankForKeyword(kw.id);
    for (const r of ranks) {
      const extMap = newRanks.get(r.extensionId);
      if (extMap) extMap.set(kw.id, r);
    }
  }

  snapshots.value = newSnapshots;
  latestRanks.value = newRanks;

  // Apply pre-selections
  if (props.preSelectedKeywordId) {
    selectedKeywordId.value = props.preSelectedKeywordId;
  } else if (keywords.value.length > 0 && keywords.value[0].id !== undefined) {
    selectedKeywordId.value = keywords.value[0].id;
  }

  if (props.preSelectedCompetitorId) {
    selectedCompetitorId.value = props.preSelectedCompetitorId;
  } else if (competitors.value.length > 0) {
    selectedCompetitorId.value = competitors.value[0].id;
  }

  loading.value = false;
});

// Actions
async function runAudit(): Promise<void> {
  if (!canRun.value || !selectedKeywordId.value || !selectedCompetitorId.value) return;
  if (!settings.openaiApiKey) return;

  running.value = true;
  auditError.value = null;
  auditResult.value = null;
  fromCache.value = false;

  const keyword = keywords.value.find((k) => k.id === selectedKeywordId.value);
  if (!keyword) {
    auditError.value = 'Selected keyword not found.';
    running.value = false;
    return;
  }

  const ownSnap = snapshots.value.get(props.project.ownExtensionId);
  const compSnap = snapshots.value.get(selectedCompetitorId.value);
  if (!ownSnap || !compSnap) {
    auditError.value = 'Missing listing data. Run a scan first.';
    running.value = false;
    return;
  }

  const ownRankMap = latestRanks.value.get(props.project.ownExtensionId);
  const compRankMap = latestRanks.value.get(selectedCompetitorId.value);

  const cacheKey = buildCacheKey(
    keyword.text,
    props.project.ownExtensionId,
    selectedCompetitorId.value,
    today()
  );

  try {
    // Check cache first
    const cached = await db.getCachedAudit(cacheKey);
    if (cached) {
      auditResult.value = cached;
      fromCache.value = true;
      running.value = false;
      return;
    }

    // Request permission for OpenAI API if not already granted
    try {
      const granted = await chrome.permissions.request({ origins: ['https://api.openai.com/*'] });
      if (!granted) {
        auditError.value = 'OpenAI API permission is required. Please grant permission when prompted.';
        running.value = false;
        return;
      }
    } catch {
      // Permission request may fail in non-user-gesture contexts;
      // check if we already have the permission before proceeding
      const hasPermission = await chrome.permissions.contains({ origins: ['https://api.openai.com/*'] });
      if (!hasPermission) {
        auditError.value = 'OpenAI API permission could not be verified. Please try again.';
        running.value = false;
        return;
      }
    }

    const client = new OpenAIClient(settings.openaiApiKey);
    const input: AuditInput = {
      keyword: keyword.text,
      ownListing: ownSnap,
      competitorListing: compSnap,
      ownPosition: ownRankMap?.get(selectedKeywordId.value)?.position ?? null,
      competitorPosition: compRankMap?.get(selectedKeywordId.value)?.position ?? null,
    };

    const result = await runKeywordAudit(client, input, customPrompts.value);
    auditResult.value = result;

    // Cache the result
    const cachedResult: CachedAuditResult = { ...result, cacheKey };
    await db.saveAuditResult(cachedResult);
  } catch (e) {
    if (e instanceof OpenAIError) {
      auditError.value = e.message;
    } else {
      auditError.value = e instanceof Error ? e.message : 'An unexpected error occurred';
    }
  } finally {
    running.value = false;
  }
}

function priorityColor(priority: AuditRecommendation['priority']): string {
  switch (priority) {
    case 'high': return 'text-red-700 bg-red-50 border-red-200';
    case 'medium': return 'text-yellow-700 bg-yellow-50 border-yellow-200';
    case 'low': return 'text-blue-700 bg-blue-50 border-blue-200';
  }
}

function priorityLabel(priority: AuditRecommendation['priority']): string {
  switch (priority) {
    case 'high': return 'High';
    case 'medium': return 'Medium';
    case 'low': return 'Low';
  }
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `< $0.01`;
  return `$${usd.toFixed(2)}`;
}

function getExtensionName(id: string): string {
  return extensions.value.find((e) => e.id === id)?.name || id;
}

function getPosition(extId: string, kwId: number): string {
  const rankMap = latestRanks.value.get(extId);
  const rank = rankMap?.get(kwId);
  if (!rank) return '-';
  return rank.position !== null ? `#${rank.position}` : '30+';
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-6">
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg font-semibold text-gray-900">Keyword Audit</h3>
      <button
        class="text-sm text-gray-400 hover:text-gray-600"
        @click="emit('close')"
      >
        Close
      </button>
    </div>

    <div v-if="loading" class="py-8 text-center">
      <p class="text-sm text-gray-500">Loading data...</p>
    </div>

    <div v-else-if="!settings.openaiApiKey" class="rounded-lg border-2 border-dashed border-yellow-300 bg-yellow-50 p-6 text-center">
      <p class="text-sm text-yellow-800">
        OpenAI API key required. Set it in Settings to use AI features.
      </p>
    </div>

    <div v-else>
      <!-- Selection -->
      <div class="mb-4 grid grid-cols-2 gap-4">
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600">Keyword</label>
          <select
            v-model="selectedKeywordId"
            class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option v-for="kw in keywords" :key="kw.id" :value="kw.id">
              {{ kw.text }}
              (You: {{ getPosition(project.ownExtensionId, kw.id!) }})
            </option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600">Competitor</label>
          <select
            v-model="selectedCompetitorId"
            class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option v-for="comp in competitors" :key="comp.id" :value="comp.id">
              {{ comp.name || comp.id }}
              <template v-if="selectedKeywordId">
                ({{ getPosition(comp.id, selectedKeywordId) }})
              </template>
            </option>
          </select>
        </div>
      </div>

      <!-- Cost estimate & Run button -->
      <div class="mb-6 flex items-center gap-4">
        <button
          :disabled="!canRun || running"
          class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          @click="runAudit"
        >
          <template v-if="running">Analyzing...</template>
          <template v-else>Run Audit</template>
        </button>
        <span v-if="costEstimate" class="text-xs text-gray-500">
          Est. ~{{ costEstimate.inputTokens + costEstimate.outputTokens }} tokens
          ({{ formatCost(costEstimate.estimatedCostUsd) }})
        </span>
      </div>

      <!-- Error -->
      <div v-if="auditError" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
        <p class="text-sm text-red-700">{{ auditError }}</p>
      </div>

      <!-- Results -->
      <div v-if="auditResult" class="space-y-4">
        <div v-if="fromCache" class="rounded-md bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
          Cached result from today. Re-run tomorrow for fresh analysis.
        </div>

        <!-- Header -->
        <div class="rounded-lg bg-gray-50 p-4">
          <div class="flex items-center justify-between text-sm text-gray-600">
            <span>
              <strong>{{ getExtensionName(auditResult.ownExtensionId) }}</strong>
              vs
              <strong>{{ getExtensionName(auditResult.competitorExtensionId) }}</strong>
              for "<em>{{ auditResult.keyword }}</em>"
            </span>
            <span class="text-xs text-gray-400">
              {{ auditResult.inputTokens + auditResult.outputTokens }} tokens
              ({{ formatCost(auditResult.costUsd) }})
            </span>
          </div>
        </div>

        <!-- Relevance Analysis -->
        <div class="rounded-lg border border-gray-200 p-4">
          <h4 class="mb-2 text-sm font-semibold text-gray-800">Relevance Analysis</h4>
          <p class="whitespace-pre-line text-sm text-gray-600">{{ auditResult.relevanceAnalysis }}</p>
        </div>

        <!-- Metric Comparison -->
        <div v-if="auditResult.metricComparison" class="rounded-lg border border-gray-200 p-4">
          <h4 class="mb-2 text-sm font-semibold text-gray-800">Metric Comparison</h4>
          <p class="whitespace-pre-line text-sm text-gray-600">{{ auditResult.metricComparison }}</p>
        </div>

        <!-- Recommendations -->
        <div v-if="auditResult.recommendations.length > 0" class="rounded-lg border border-gray-200 p-4">
          <h4 class="mb-3 text-sm font-semibold text-gray-800">Recommendations</h4>
          <div class="space-y-2">
            <div
              v-for="(rec, idx) in auditResult.recommendations"
              :key="idx"
              class="rounded-md border p-3"
              :class="priorityColor(rec.priority)"
            >
              <div class="mb-1 flex items-center gap-2">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="priorityColor(rec.priority)">
                  {{ priorityLabel(rec.priority) }}
                </span>
                <span class="text-xs font-semibold">{{ rec.area }}</span>
              </div>
              <p class="text-sm">{{ rec.suggestion }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
