<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { Project, Extension, Keyword, EventRecord, RankSnapshot } from '@/shared/types';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import { useRankings } from '../../composables/useRankings';
import { daysAgo, today } from '@/shared/utils/dates';
import { ALL_EVENT_TYPES, EVENT_TYPE_COLORS, EVENT_TYPE_LABELS } from '@/shared/utils/event-colors';
import RankChart from '../charts/RankChart.vue';
import RankHeatmap from '../charts/RankHeatmap.vue';
import KeywordCoverageChart from '../charts/KeywordCoverageChart.vue';
import KeywordScatterPlot from '../charts/KeywordScatterPlot.vue';
import AuditTool from '../ai/AuditTool.vue';
import type {
  RankChartSeries,
  RankDelta,
  HeatmapCell,
  CoverageData,
  ScatterPoint,
} from '../../composables/useRankings';

const props = defineProps<{
  project: Project;
}>();

const { getExtensionsByProject } = useExtensions();
const {
  loadRankHistory,
  loadAllKeywordLatestRanks,
  loadRankDeltas,
  buildHeatmapData,
  buildCoverageData,
  buildScatterData,
} = useRankings();

const extensions = ref<Extension[]>([]);
const keywords = ref<Keyword[]>([]);
const selectedKeywordId = ref<number | null>(null);
const dateRange = ref<'7' | '30' | '90' | '365'>('30');
const series = ref<RankChartSeries[]>([]);
const events = ref<EventRecord[]>([]);
const loading = ref(true);
const chartLoading = ref(false);
const chartError = ref<string | null>(null);
const latestRanks = ref<RankSnapshot[]>([]);

// New visualization data
const heatmapCells = ref<HeatmapCell[]>([]);
const coverageData = ref<CoverageData[]>([]);
const scatterData = ref<ScatterPoint[]>([]);
const rankDeltas = ref<Map<string, RankDelta>>(new Map());

// Audit tool state
const showAudit = ref(false);
const auditKeywordId = ref<number | undefined>(undefined);
const auditCompetitorId = ref<string | undefined>(undefined);

/** Which event types are currently visible as annotations. */
const visibleEventTypes = ref<Set<string>>(new Set(ALL_EVENT_TYPES));

/** Latest positions per extension for the selected keyword. */
const currentPositions = computed(() => {
  const map = new Map<string, number | null>();
  for (const rank of latestRanks.value) {
    map.set(rank.extensionId, rank.position);
  }
  return map;
});

function openAudit(competitorId: string): void {
  auditKeywordId.value = selectedKeywordId.value ?? undefined;
  auditCompetitorId.value = competitorId;
  showAudit.value = true;
}

function closeAudit(): void {
  showAudit.value = false;
}

function getPosition(extId: string): string {
  const pos = currentPositions.value.get(extId);
  if (pos === undefined) return '-';
  return pos !== null ? `#${pos}` : '30+';
}

function isCompetitorHigher(competitorId: string): boolean {
  const ownPos = currentPositions.value.get(props.project.ownExtensionId);
  const compPos = currentPositions.value.get(competitorId);
  if (compPos === undefined || compPos === null) return false;
  if (ownPos === undefined || ownPos === null) return true;
  return compPos < ownPos;
}

function getDeltaDisplay(extId: string): string {
  const d = rankDeltas.value.get(extId);
  if (!d || d.delta === null) return '';
  if (d.delta === 0) return '0';
  return d.delta > 0 ? `+${d.delta}` : String(d.delta);
}

function getDeltaClasses(extId: string): string {
  const d = rankDeltas.value.get(extId);
  if (!d || d.delta === null) return 'text-gray-400';
  if (d.delta > 0) return 'text-green-600';
  if (d.delta < 0) return 'text-red-600';
  return 'text-gray-400';
}

function getDeltaArrow(extId: string): string {
  const d = rankDeltas.value.get(extId);
  if (!d || d.delta === null) return '';
  if (d.delta > 0) return '\u25B2'; // ▲
  if (d.delta < 0) return '\u25BC'; // ▼
  return '\u2013'; // –
}

function toggleEventType(type: string): void {
  const next = new Set(visibleEventTypes.value);
  if (next.has(type)) {
    next.delete(type);
  } else {
    next.add(type);
  }
  visibleEventTypes.value = next;
}

onMounted(async () => {
  extensions.value = await getExtensionsByProject(props.project.id!);
  keywords.value = await db.getKeywordsByProject(props.project.id!);

  if (keywords.value.length > 0 && keywords.value[0].id !== undefined) {
    selectedKeywordId.value = keywords.value[0].id;
  }

  // Load cross-keyword data for heatmap, coverage, and scatter
  await loadCrossKeywordData();

  loading.value = false;
});

async function loadCrossKeywordData(): Promise<void> {
  if (keywords.value.length === 0 || extensions.value.length === 0) return;

  try {
    const allRanks = await loadAllKeywordLatestRanks(keywords.value);
    const cells = buildHeatmapData(allRanks);
    heatmapCells.value = cells;
    coverageData.value = buildCoverageData(cells, extensions.value);
    scatterData.value = buildScatterData(allRanks, keywords.value, props.project.ownExtensionId);
  } catch (err) {
    console.error('Failed to load cross-keyword visualization data:', err);
    heatmapCells.value = [];
    coverageData.value = [];
    scatterData.value = [];
  }
}

watch([selectedKeywordId, dateRange], async () => {
  if (selectedKeywordId.value === null) {
    series.value = [];
    events.value = [];
    return;
  }

  chartLoading.value = true;
  chartError.value = null;

  try {
    const days = Number(dateRange.value);
    const startDate = daysAgo(days);
    const endDate = today();

    // Load rank data and events in parallel
    const allExtIds = [props.project.ownExtensionId, ...props.project.competitorIds];

    const [rankSeries, ...eventArrays] = await Promise.all([
      loadRankHistory(selectedKeywordId.value, extensions.value, startDate, endDate),
      ...allExtIds.map((extId) => db.getEvents(extId, startDate, endDate)),
    ]);

    series.value = rankSeries;

    // Load latest rank positions for the summary table
    if (selectedKeywordId.value !== null) {
      latestRanks.value = await db.getLatestRankForKeyword(selectedKeywordId.value);
      // Load deltas for the selected keyword
      rankDeltas.value = await loadRankDeltas(selectedKeywordId.value, extensions.value);
    }

    // Merge all events, sorted by date ascending for consistent annotation order
    const allEvents: EventRecord[] = eventArrays.flat();
    allEvents.sort((a, b) => a.date.localeCompare(b.date));
    events.value = allEvents;
  } catch (e) {
    chartError.value = e instanceof Error ? e.message : 'Failed to load chart data';
    series.value = [];
    events.value = [];
  } finally {
    chartLoading.value = false;
  }
}, { immediate: true });
</script>

<template>
  <div>
    <div v-if="loading" class="text-center py-8">
      <p class="text-sm text-gray-500">Loading rankings...</p>
    </div>

    <div v-else-if="keywords.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
      <p class="text-sm text-gray-500">
        No keywords tracked yet. Add keywords in the Keywords tab to see ranking charts.
      </p>
    </div>

    <div v-else>
      <!-- Controls -->
      <div class="mb-4 flex items-center gap-4">
        <div>
          <select
            v-model="selectedKeywordId"
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option
              v-for="kw in keywords"
              :key="kw.id"
              :value="kw.id"
            >
              {{ kw.text }}
            </option>
          </select>
        </div>
        <div class="flex rounded-md border border-gray-300">
          <button
            v-for="range in (['7', '30', '90', '365'] as const)"
            :key="range"
            class="px-3 py-1.5 text-xs font-medium first:rounded-l-md last:rounded-r-md"
            :class="dateRange === range
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'"
            @click="dateRange = range"
          >
            {{ range }}d
          </button>
        </div>
      </div>

      <!-- Event type filter toggles -->
      <div v-if="events.length > 0" class="mb-4 flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium text-gray-500">Events:</span>
        <button
          v-for="type in ALL_EVENT_TYPES"
          :key="type"
          class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
          :class="visibleEventTypes.has(type)
            ? 'border-transparent text-white'
            : 'border-gray-300 bg-white text-gray-400'"
          :style="visibleEventTypes.has(type) ? { backgroundColor: EVENT_TYPE_COLORS[type] } : undefined"
          @click="toggleEventType(type)"
        >
          {{ EVENT_TYPE_LABELS[type] }}
        </button>
      </div>

      <!-- Chart -->
      <div v-if="chartLoading" class="text-center py-12">
        <p class="text-sm text-gray-500">Loading chart data...</p>
      </div>
      <div v-else-if="chartError" class="rounded-lg border border-red-200 bg-red-50 p-4">
        <p class="text-sm text-red-700">{{ chartError }}</p>
      </div>
      <div v-else-if="series.every(s => s.data.length === 0)" class="rounded-lg border border-gray-200 bg-white p-12 text-center">
        <p class="text-sm text-gray-500">
          No ranking data available for this keyword and date range. Data will appear after scans complete.
        </p>
      </div>
      <div v-else>
        <RankChart
          :series="series"
          :events="events"
          :visible-event-types="visibleEventTypes"
        />

        <!-- Current positions table with "Why higher?" buttons -->
        <div v-if="latestRanks.length > 0" class="mt-6">
          <h4 class="mb-2 text-sm font-semibold text-gray-700">Current Positions</h4>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 text-left text-xs font-medium text-gray-500">
                <th class="py-2 pr-4">Extension</th>
                <th class="py-2 pr-4">Position</th>
                <th class="py-2 pr-4">Change</th>
                <th class="py-2"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ext in extensions"
                :key="ext.id"
                class="border-b border-gray-100"
              >
                <td class="py-2 pr-4">
                  <div class="flex items-center gap-2">
                    <img
                      v-if="ext.iconUrl"
                      :src="ext.iconUrl"
                      :alt="ext.name || ext.id"
                      class="h-5 w-5 rounded"
                    />
                    <span
                      v-else
                      class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-200 text-[9px] font-bold text-gray-500"
                    >
                      {{ (ext.name || ext.id).charAt(0).toUpperCase() }}
                    </span>
                    <span :class="ext.id === project.ownExtensionId ? 'font-semibold text-blue-700' : 'text-gray-700'">
                      {{ ext.name || ext.id }}
                    </span>
                    <span v-if="ext.id === project.ownExtensionId" class="text-xs text-blue-500">(yours)</span>
                  </div>
                </td>
                <td class="py-2 pr-4 font-mono text-gray-800">
                  {{ getPosition(ext.id) }}
                </td>
                <td class="py-2 pr-4">
                  <span
                    v-if="getDeltaDisplay(ext.id)"
                    class="inline-flex items-center gap-0.5 font-mono text-xs font-medium"
                    :class="getDeltaClasses(ext.id)"
                  >
                    <span>{{ getDeltaArrow(ext.id) }}</span>
                    <span>{{ getDeltaDisplay(ext.id) }}</span>
                  </span>
                  <span v-else class="text-xs text-gray-300">&mdash;</span>
                </td>
                <td class="py-2 text-right">
                  <button
                    v-if="ext.id !== project.ownExtensionId && isCompetitorHigher(ext.id)"
                    class="rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100"
                    @click="openAudit(ext.id)"
                  >
                    Why higher?
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Rank Position Heatmap (all keywords × all extensions) -->
      <div v-if="heatmapCells.length > 0" class="mt-6">
        <RankHeatmap
          :keywords="keywords"
          :extensions="extensions"
          :cells="heatmapCells"
          :own-extension-id="project.ownExtensionId"
        />
      </div>

      <!-- Keyword Coverage + Scatter Plot side by side -->
      <div v-if="coverageData.length > 0 || scatterData.length > 0" class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <KeywordCoverageChart
          v-if="coverageData.length > 0"
          :data="coverageData"
          :own-extension-id="project.ownExtensionId"
        />
        <KeywordScatterPlot
          v-if="scatterData.length > 0"
          :data="scatterData"
        />
      </div>

      <!-- Audit Tool panel -->
      <div v-if="showAudit" class="mt-6">
        <AuditTool
          :project="project"
          :pre-selected-keyword-id="auditKeywordId"
          :pre-selected-competitor-id="auditCompetitorId"
          @close="closeAudit"
        />
      </div>
    </div>
  </div>
</template>
