<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { Project, Extension, Keyword, ListingSnapshot, RankSnapshot, AutocompleteSnapshot, EventRecord } from '@/shared/types';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import { useSettings } from '../../composables/useSettings';
import { OpenAIClient, OpenAIError } from '@/shared/utils/openai';
import {
  buildAuditPrompt,
  buildCacheKey,
  estimateAuditTokens,
  runKeywordAudit,
  type AuditInput,
  type AuditResult,
  type AuditRecommendation,
  type AuditHistoricalContext,
  type AdditionalKeywordContext,
  type CachedAuditResult,
  type CustomAuditPrompts,
} from '@/shared/utils/keyword-audit';
import { today, daysAgo } from '@/shared/utils/dates';

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
const selectedKeywordIds = ref<number[]>([]);
const selectedCompetitorId = ref<string | null>(null);
const keywordDropdownOpen = ref(false);
const keywordDropdownRef = ref<HTMLElement | null>(null);

const primaryKeywordId = computed(() => selectedKeywordIds.value[0] ?? null);

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
  primaryKeywordId.value !== null &&
  selectedCompetitorId.value !== null &&
  settings.openaiApiKey !== null
);

const customPrompts = computed<CustomAuditPrompts>(() => ({
  systemPrompt: settings.auditSystemPrompt || undefined,
  userPromptTemplate: settings.auditUserPromptTemplate || undefined,
}));

const costEstimate = computed(() => {
  if (!primaryKeywordId.value || !selectedCompetitorId.value) return null;

  const ownSnap = snapshots.value.get(props.project.ownExtensionId);
  const compSnap = snapshots.value.get(selectedCompetitorId.value);
  if (!ownSnap || !compSnap) return null;

  const ownRankMap = latestRanks.value.get(props.project.ownExtensionId);
  const compRankMap = latestRanks.value.get(selectedCompetitorId.value);

  const additional: AdditionalKeywordContext[] = selectedKeywordIds.value.slice(1).map((kwId) => {
    const kw = keywords.value.find((k) => k.id === kwId);
    return {
      keyword: kw?.text ?? '',
      ownPosition: ownRankMap?.get(kwId)?.position ?? null,
      competitorPosition: compRankMap?.get(kwId)?.position ?? null,
    };
  });

  const input: AuditInput = {
    keyword: keywords.value.find((k) => k.id === primaryKeywordId.value)?.text ?? '',
    ownListing: ownSnap,
    competitorListing: compSnap,
    ownPosition: ownRankMap?.get(primaryKeywordId.value!)?.position ?? null,
    competitorPosition: compRankMap?.get(primaryKeywordId.value!)?.position ?? null,
    additionalKeywords: additional.length > 0 ? additional : undefined,
  };

  return estimateAuditTokens(input, customPrompts.value);
});

const previewMessages = computed(() => {
  if (!primaryKeywordId.value || !selectedCompetitorId.value) return null;
  const ownSnap = snapshots.value.get(props.project.ownExtensionId);
  const compSnap = snapshots.value.get(selectedCompetitorId.value);
  if (!ownSnap || !compSnap) return null;

  const ownRankMap = latestRanks.value.get(props.project.ownExtensionId);
  const compRankMap = latestRanks.value.get(selectedCompetitorId.value);
  const additional: AdditionalKeywordContext[] = selectedKeywordIds.value.slice(1).map((kwId) => {
    const kw = keywords.value.find((k) => k.id === kwId);
    return {
      keyword: kw?.text ?? '',
      ownPosition: ownRankMap?.get(kwId)?.position ?? null,
      competitorPosition: compRankMap?.get(kwId)?.position ?? null,
    };
  });

  const input: AuditInput = {
    keyword: keywords.value.find((k) => k.id === primaryKeywordId.value)?.text ?? '',
    ownListing: ownSnap,
    competitorListing: compSnap,
    ownPosition: ownRankMap?.get(primaryKeywordId.value!)?.position ?? null,
    competitorPosition: compRankMap?.get(primaryKeywordId.value!)?.position ?? null,
    additionalKeywords: additional.length > 0 ? additional : undefined,
  };

  return buildAuditPrompt(input, customPrompts.value);
});

// Outside-click handler for keyword dropdown
function handleOutsideClick(event: MouseEvent): void {
  if (keywordDropdownRef.value && !keywordDropdownRef.value.contains(event.target as Node)) {
    keywordDropdownOpen.value = false;
  }
}

function toggleKeyword(id: number): void {
  const idx = selectedKeywordIds.value.indexOf(id);
  if (idx === -1) {
    selectedKeywordIds.value = [...selectedKeywordIds.value, id];
  } else {
    selectedKeywordIds.value = selectedKeywordIds.value.filter((kid) => kid !== id);
  }
}

const keywordDropdownLabel = computed(() => {
  if (selectedKeywordIds.value.length === 0) return 'Select keywords...';
  const primary = keywords.value.find((k) => k.id === primaryKeywordId.value);
  const name = primary?.text ?? '';
  const extra = selectedKeywordIds.value.length - 1;
  return extra > 0 ? `${name} + ${extra} more` : name;
});

// Lifecycle
onMounted(async () => {
  document.addEventListener('click', handleOutsideClick);

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
    selectedKeywordIds.value = [props.preSelectedKeywordId];
  } else if (keywords.value.length > 0 && keywords.value[0].id !== undefined) {
    selectedKeywordIds.value = [keywords.value[0].id];
  }

  if (props.preSelectedCompetitorId) {
    selectedCompetitorId.value = props.preSelectedCompetitorId;
  } else if (competitors.value.length > 0) {
    selectedCompetitorId.value = competitors.value[0].id;
  }

  loading.value = false;
});

onUnmounted(() => {
  document.removeEventListener('click', handleOutsideClick);
});

// Actions
async function runAudit(): Promise<void> {
  if (!canRun.value || !primaryKeywordId.value || !selectedCompetitorId.value) return;
  if (!settings.openaiApiKey) return;

  running.value = true;
  auditError.value = null;
  auditResult.value = null;
  fromCache.value = false;

  const keyword = keywords.value.find((k) => k.id === primaryKeywordId.value);
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

  // Build keyword list for cache key
  const allKeywordTexts = selectedKeywordIds.value.map((kwId) =>
    keywords.value.find((k) => k.id === kwId)?.text ?? ''
  );

  const cacheKey = buildCacheKey(
    allKeywordTexts,
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

    // Load historical context for primary keyword (14d is superset of 7d — query once, filter in memory)
    const todayStr = today();
    const start14d = daysAgo(14);
    const start7d = daysAgo(7);
    const ownExtId = props.project.ownExtensionId;
    const compExtId = selectedCompetitorId.value;
    const kwId = primaryKeywordId.value;

    const [ownRanks14d, compRanks14d, ownAc14d, compAc14d, ownEv14d, compEv14d] = await Promise.all([
      db.getRankSnapshots(kwId, ownExtId, start14d, todayStr),
      db.getRankSnapshots(kwId, compExtId, start14d, todayStr),
      db.getAutocompleteSnapshots(kwId, ownExtId, start14d, todayStr),
      db.getAutocompleteSnapshots(kwId, compExtId, start14d, todayStr),
      db.getEvents(ownExtId, start14d, todayStr),
      db.getEvents(compExtId, start14d, todayStr),
    ]);

    // Filter 14d results to get 7d subsets
    const filterByDate = <T extends { date: string }>(items: T[], startDate: string): T[] =>
      items.filter((item) => item.date >= startDate);

    const history7d: AuditHistoricalContext = {
      ownRankHistory: filterByDate(ownRanks14d, start7d),
      compRankHistory: filterByDate(compRanks14d, start7d),
      ownAutocompleteHistory: filterByDate(ownAc14d, start7d),
      compAutocompleteHistory: filterByDate(compAc14d, start7d),
      ownEvents: filterByDate(ownEv14d, start7d),
      compEvents: filterByDate(compEv14d, start7d),
    };

    const history14d: AuditHistoricalContext = {
      ownRankHistory: ownRanks14d,
      compRankHistory: compRanks14d,
      ownAutocompleteHistory: ownAc14d,
      compAutocompleteHistory: compAc14d,
      ownEvents: ownEv14d,
      compEvents: compEv14d,
    };

    // Build additional keyword context from non-primary selections
    const additional: AdditionalKeywordContext[] = selectedKeywordIds.value.slice(1).map((kwId) => {
      const kw = keywords.value.find((k) => k.id === kwId);
      return {
        keyword: kw?.text ?? '',
        ownPosition: ownRankMap?.get(kwId)?.position ?? null,
        competitorPosition: compRankMap?.get(kwId)?.position ?? null,
      };
    });

    const input: AuditInput = {
      keyword: keyword.text,
      ownListing: ownSnap,
      competitorListing: compSnap,
      ownPosition: ownRankMap?.get(primaryKeywordId.value)?.position ?? null,
      competitorPosition: compRankMap?.get(primaryKeywordId.value)?.position ?? null,
      history7d,
      history14d,
      additionalKeywords: additional.length > 0 ? additional : undefined,
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
          <label class="mb-1 block text-xs font-medium text-gray-600">Keywords</label>
          <div ref="keywordDropdownRef" class="relative">
            <button
              type="button"
              class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-left text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              @click.stop="keywordDropdownOpen = !keywordDropdownOpen"
            >
              <span class="block truncate">{{ keywordDropdownLabel }}</span>
              <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
              </span>
            </button>
            <div
              v-if="keywordDropdownOpen"
              class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
            >
              <label
                v-for="kw in keywords"
                :key="kw.id"
                class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  :checked="selectedKeywordIds.includes(kw.id!)"
                  class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  @change="toggleKeyword(kw.id!)"
                />
                <span class="flex-1 truncate">{{ kw.text }}</span>
                <span class="shrink-0 text-xs text-gray-400">
                  {{ getPosition(project.ownExtensionId, kw.id!) }}
                </span>
                <span
                  v-if="selectedKeywordIds.indexOf(kw.id!) === 0"
                  class="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700"
                >primary</span>
              </label>
              <p v-if="selectedKeywordIds.length > 1" class="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-400">
                First selected keyword is primary (gets historical data)
              </p>
            </div>
          </div>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-600">Competitor</label>
          <select
            v-model="selectedCompetitorId"
            class="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option v-for="comp in competitors" :key="comp.id" :value="comp.id">
              {{ comp.name || comp.id }}
              <template v-if="primaryKeywordId">
                ({{ getPosition(comp.id, primaryKeywordId) }})
              </template>
            </option>
          </select>
        </div>
      </div>

      <!-- Prompt Preview -->
      <details v-if="previewMessages" class="mb-4">
        <summary class="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
          Preview prompt
        </summary>
        <div class="mt-2 space-y-3">
          <div v-for="(msg, idx) in previewMessages" :key="idx">
            <p class="mb-1 text-xs font-semibold text-gray-500 uppercase">{{ msg.role }}</p>
            <pre class="max-h-64 overflow-auto rounded-md bg-gray-50 p-3 text-xs text-gray-700 whitespace-pre-wrap break-words">{{ msg.content }}</pre>
          </div>
        </div>
      </details>

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
              <template v-if="auditResult.additionalKeywords && auditResult.additionalKeywords.length > 0">
                + {{ auditResult.additionalKeywords.length }} more keyword{{ auditResult.additionalKeywords.length > 1 ? 's' : '' }}
              </template>
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

        <!-- Trend Analysis -->
        <div v-if="auditResult.trendAnalysis" class="rounded-lg border border-gray-200 p-4">
          <h4 class="mb-2 text-sm font-semibold text-gray-800">Trend Analysis</h4>
          <p class="whitespace-pre-line text-sm text-gray-600">{{ auditResult.trendAnalysis }}</p>
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
              <p v-if="rec.impact" class="mt-1 text-xs text-gray-500 italic">Impact: {{ rec.impact }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
