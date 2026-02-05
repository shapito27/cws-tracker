<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { Project, Extension, Keyword, EventRecord } from '@/shared/types';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import { useRankings } from '../../composables/useRankings';
import { daysAgo, today } from '@/shared/utils/dates';
import { ALL_EVENT_TYPES, EVENT_TYPE_COLORS, EVENT_TYPE_LABELS } from '@/shared/utils/event-colors';
import RankChart from '../charts/RankChart.vue';
import type { RankChartSeries } from '../../composables/useRankings';

const props = defineProps<{
  project: Project;
}>();

const { getExtensionsByProject } = useExtensions();
const { loadRankHistory } = useRankings();

const extensions = ref<Extension[]>([]);
const keywords = ref<Keyword[]>([]);
const selectedKeywordId = ref<number | null>(null);
const dateRange = ref<'7' | '30' | '90' | '365'>('30');
const series = ref<RankChartSeries[]>([]);
const events = ref<EventRecord[]>([]);
const loading = ref(true);
const chartLoading = ref(false);

/** Which event types are currently visible as annotations. */
const visibleEventTypes = ref<Set<string>>(new Set(ALL_EVENT_TYPES));

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

  loading.value = false;
});

watch([selectedKeywordId, dateRange], async () => {
  if (selectedKeywordId.value === null) {
    series.value = [];
    events.value = [];
    return;
  }

  chartLoading.value = true;
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

  // Merge all events, sorted by date ascending for consistent annotation order
  const allEvents: EventRecord[] = eventArrays.flat();
  allEvents.sort((a, b) => a.date.localeCompare(b.date));
  events.value = allEvents;

  chartLoading.value = false;
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
      </div>
    </div>
  </div>
</template>
