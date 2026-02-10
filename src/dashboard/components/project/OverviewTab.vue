<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Project, Extension, EventRecord, Keyword } from '@/shared/types';
import type { RankChartSeries } from '../../composables/useRankings';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import { useServiceWorker } from '../../composables/useServiceWorker';
import { useSettings } from '../../composables/useSettings';
import { loadOwnExtensionRankHistory } from '../../composables/useRankings';
import { daysAgo, today } from '@/shared/utils/dates';
import RankChart from '../charts/RankChart.vue';
import KeywordPositionTable from '../tables/KeywordPositionTable.vue';

const props = defineProps<{
  project: Project;
}>();

const { getExtensionsByProject, getLatestSnapshot } = useExtensions();
const { scanStatus, requestRefresh } = useServiceWorker();
const { settings, loadSettings } = useSettings();

const extensions = ref<Extension[]>([]);
const recentEvents = ref<EventRecord[]>([]);
const ownKeywordSeries = ref<RankChartSeries[]>([]);
const keywords = ref<Keyword[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

onMounted(async () => {
  if (!props.project.id) {
    loading.value = false;
    return;
  }

  try {
    await loadSettings();
    extensions.value = await getExtensionsByProject(props.project.id);

    // Load keyword position history for own extension
    keywords.value = await db.getKeywordsByProject(props.project.id);
    if (keywords.value.length > 0) {
      ownKeywordSeries.value = await loadOwnExtensionRankHistory(
        keywords.value,
        props.project.ownExtensionId,
        daysAgo(30),
        today()
      );
    }

    // Get recent events across all project extensions
    const allExtIds = [props.project.ownExtensionId, ...props.project.competitorIds];
    const events: EventRecord[] = [];
    for (const extId of allExtIds) {
      const extEvents = await db.getEvents(extId, '2000-01-01', '2099-12-31');
      events.push(...extEvents);
    }
    // Sort by date descending, take last 10
    events.sort((a, b) => b.date.localeCompare(a.date));
    recentEvents.value = events.slice(0, 10);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load overview';
  } finally {
    loading.value = false;
  }
});

function formatRelativeDateTime(date: Date): string {
  if (isNaN(date.getTime())) return 'Unknown';

  const now = new Date();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((dateStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return `Today, ${timeStr}`;
  if (diffDays === -1) return `Yesterday, ${timeStr}`;
  if (diffDays === 1) return `Tomorrow, ${timeStr}`;

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
}

function getLastScannedDate(): Date | null {
  const dates = extensions.value
    .filter((e) => e.lastScannedAt)
    .map((e) => e.lastScannedAt!.getTime());
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates));
}

const lastScanned = computed<string>(() => {
  const latest = getLastScannedDate();
  if (!latest) return 'Never';
  return formatRelativeDateTime(latest);
});

function getLastScannedTooltip(): string {
  const latest = getLastScannedDate();
  if (!latest) return '';
  return latest.toLocaleString();
}

function getNextScan(): string {
  if (scanStatus.value.isRunning) return 'Scanning...';
  if (!settings.dailyScanEnabled) return 'Auto-scan off';

  const [hours, minutes] = settings.dailyScanTime.split(':').map(Number);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const nextDate = new Date();
  nextDate.setHours(hours, minutes, 0, 0);

  if (settings.lastDailyScanDate === todayStr || nextDate.getTime() <= now.getTime()) {
    nextDate.setDate(nextDate.getDate() + 1);
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const timeStr = nextDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (nextDate.toDateString() === now.toDateString()) return `Today ~${timeStr}`;
  if (nextDate.toDateString() === tomorrow.toDateString()) return `Tomorrow ~${timeStr}`;
  return `${nextDate.toLocaleDateString()} ~${timeStr}`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<template>
  <div v-if="loading" class="text-center py-8">
    <p class="text-sm text-gray-500">Loading overview...</p>
  </div>

  <div v-else-if="loadError" class="rounded-lg bg-red-50 border border-red-200 p-6 text-center">
    <p class="text-sm text-red-700">Failed to load overview: {{ loadError }}</p>
  </div>

  <div v-else>
    <!-- Metric cards -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-8">
      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Extensions</p>
        <p class="mt-1 text-2xl font-bold text-gray-900">
          {{ 1 + project.competitorIds.length }}
        </p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Keywords</p>
        <p class="mt-1 text-2xl font-bold text-gray-900">
          {{ project.keywordIds.length }}
        </p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-4" :title="getLastScannedTooltip()">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Last Scan</p>
        <p class="mt-1 text-lg font-bold text-gray-900">
          {{ lastScanned }}
        </p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Next Scan</p>
        <p
          class="mt-1 text-lg font-bold"
          :class="scanStatus.isRunning ? 'text-blue-600' : settings.dailyScanEnabled ? 'text-gray-900' : 'text-gray-400'"
        >
          {{ getNextScan() }}
        </p>
      </div>
    </div>

    <!-- Quick actions -->
    <div class="mb-8">
      <button
        class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        :disabled="scanStatus.isRunning"
        @click="requestRefresh(project.id)"
      >
        {{ scanStatus.isRunning ? 'Scan Running...' : 'Scan This Project' }}
      </button>
      <span v-if="scanStatus.isRunning && scanStatus.total > 0" class="ml-3 text-sm text-gray-500">
        {{ scanStatus.completed }}/{{ scanStatus.total }} jobs
      </span>
      <p v-if="scanStatus.isRunning && scanStatus.nextProcessingAt" class="mt-1 text-xs text-gray-500">
        Next job at {{ formatTime(scanStatus.nextProcessingAt) }}
      </p>
      <p v-if="scanStatus.lastError" class="mt-2 text-sm text-red-600">
        Scan error: {{ scanStatus.lastError }}
      </p>
    </div>

    <!-- Keyword positions chart (own extension only) -->
    <div class="mb-8">
      <h3 class="text-base font-semibold text-gray-900 mb-3">My Keyword Positions (Last 30 Days)</h3>
      <div v-if="ownKeywordSeries.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No ranking data yet. Run a scan to track keyword positions.</p>
      </div>
      <RankChart v-else :series="ownKeywordSeries" />
    </div>

    <!-- Keyword positions table -->
    <div v-if="keywords.length > 0" class="mb-8">
      <KeywordPositionTable
        :keywords="keywords"
        :own-extension-id="project.ownExtensionId"
      />
    </div>

    <!-- Recent events -->
    <div>
      <h3 class="text-base font-semibold text-gray-900 mb-3">Recent Events</h3>
      <div v-if="recentEvents.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No data yet. Run your first scan.</p>
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="event in recentEvents"
          :key="event.id"
          class="rounded-md border border-gray-200 bg-white px-4 py-3"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-900">{{ event.note }}</span>
            <span class="text-xs text-gray-500">{{ event.date }}</span>
          </div>
          <div class="mt-1 flex items-center gap-2">
            <span class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              {{ event.type.replace('_', ' ') }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
