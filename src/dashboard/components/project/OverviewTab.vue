<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { Project, Extension, EventRecord, Keyword, ListingSnapshot } from '@/shared/types';
import type { RankChartSeries } from '../../composables/useRankings';
import type { AutocompleteChartSeries } from '../../composables/useAutocomplete';
import {
  loadRecentRankChanges,
  loadRecentAutocompleteChanges,
  type RankChange,
} from '@/popup/composables/usePopupState';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import { useServiceWorker } from '../../composables/useServiceWorker';
import { useSettings } from '../../composables/useSettings';
import { useProxyStatus } from '../../composables/useProxyStatus';
import { loadExtensionRankHistory } from '../../composables/useRankings';
import { loadExtensionAutocompleteHistory } from '../../composables/useAutocomplete';
import { daysAgo, today } from '@/shared/utils/dates';
import ListingEventItem from '../ListingEventItem.vue';
import RankChangeItem from '../RankChangeItem.vue';
import RankChart from '../charts/RankChart.vue';
import AutocompleteChart from '../charts/AutocompleteChart.vue';
import UsersReviewsChart from '../charts/UsersReviewsChart.vue';
import KeywordPositionTable from '../tables/KeywordPositionTable.vue';
import AcPositionTable from '../tables/AcPositionTable.vue';
import ExtensionListingCard from './ExtensionListingCard.vue';

const props = defineProps<{
  project: Project;
}>();

const { getExtensionsByProject, getLatestSnapshot } = useExtensions();
const { scanStatus, requestRefresh } = useServiceWorker();
const { settings, loadSettings } = useSettings();
const { scanBlocked } = useProxyStatus();

type UnifiedEvent =
  | { kind: 'rank_change'; data: RankChange; sortTime: number }
  | { kind: 'listing_event'; data: EventRecord; sortTime: number };

const extensions = ref<Extension[]>([]);
const ownExtension = ref<Extension | undefined>(undefined);
const recentEvents = ref<EventRecord[]>([]);
const projectRankChanges = ref<RankChange[]>([]);
const ownKeywordSeries = ref<RankChartSeries[]>([]);
const ownAcSeries = ref<AutocompleteChartSeries[]>([]);
const keywords = ref<Keyword[]>([]);
const ownSnapshot = ref<ListingSnapshot | undefined>(undefined);
const snapshotHistory = ref<ListingSnapshot[]>([]);
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
    ownExtension.value = extensions.value.find(e => e.id === props.project.ownExtensionId);

    // Load latest snapshot for own extension
    ownSnapshot.value = await getLatestSnapshot(props.project.ownExtensionId);

    // Load snapshot history for own extension (users/reviews trend chart)
    snapshotHistory.value = await db.getListingSnapshots(
      props.project.ownExtensionId,
      daysAgo(30),
      today()
    );

    // Load keyword position history for own extension
    keywords.value = await db.getKeywordsByProject(props.project.id);
    if (keywords.value.length > 0) {
      const [rankSeries, acSeries] = await Promise.all([
        loadExtensionRankHistory(
          keywords.value,
          props.project.ownExtensionId,
          daysAgo(30),
          today()
        ),
        loadExtensionAutocompleteHistory(
          keywords.value,
          props.project.ownExtensionId,
          daysAgo(30),
          today()
        ),
      ]);
      ownKeywordSeries.value = rankSeries;
      ownAcSeries.value = acSeries;
    }

    await Promise.all([loadProjectRankChanges(), loadProjectEvents()]);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load overview';
  } finally {
    loading.value = false;
  }
});

async function loadProjectRankChanges(): Promise<void> {
  try {
    const [rankResults, acResults] = await Promise.all([
      loadRecentRankChanges(50),
      loadRecentAutocompleteChanges(50),
    ]);
    const combined = [...rankResults, ...acResults]
      .filter(rc => rc.projectId === props.project.id);
    combined.sort((a, b) => {
      if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
      return Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0);
    });
    projectRankChanges.value = combined.slice(0, 10);
  } catch {
    // Keep existing value on error
  }
}

async function loadProjectEvents(): Promise<void> {
  try {
    const allExtIds = [props.project.ownExtensionId, ...props.project.competitorIds];
    const results = await Promise.all(
      allExtIds.map(extId => db.getEvents(extId, daysAgo(90), today()))
    );
    const events = results.flat();
    events.sort((a, b) => {
      const aTime = a.detectedAt?.getTime() ?? 0;
      const bTime = b.detectedAt?.getTime() ?? 0;
      if (aTime && bTime) return bTime - aTime;
      if (aTime) return -1;
      if (bTime) return 1;
      return b.date.localeCompare(a.date);
    });
    recentEvents.value = events.filter(e => e.type !== 'rank_change').slice(0, 20);
  } catch {
    // Keep existing value on error
  }
}

const unifiedEvents = computed((): UnifiedEvent[] => {
  const items: UnifiedEvent[] = [];
  for (const rc of projectRankChanges.value) {
    const t = rc.scannedAt instanceof Date ? rc.scannedAt.getTime() : new Date(rc.scannedAt).getTime();
    items.push({ kind: 'rank_change', data: rc, sortTime: t || 0 });
  }
  for (const ev of recentEvents.value) {
    const t = ev.detectedAt?.getTime() ?? new Date(ev.date + 'T00:00:00').getTime();
    items.push({ kind: 'listing_event', data: ev, sortTime: t || 0 });
  }
  items.sort((a, b) => b.sortTime - a.sortTime);
  return items.slice(0, 15);
});

// Reload events after scan completes
watch(
  () => scanStatus.value.isRunning,
  async (isRunning, wasRunning) => {
    if (wasRunning && !isRunning) {
      await Promise.all([loadProjectRankChanges(), loadProjectEvents()]);
    }
  }
);

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

function getExtensionName(extensionId: string): string {
  const ext = extensions.value.find((e) => e.id === extensionId);
  return ext?.name || extensionId.slice(0, 12) + '...';
}

function getExtensionIconUrl(extensionId: string): string | null {
  const ext = extensions.value.find((e) => e.id === extensionId);
  return ext?.iconUrl ?? null;
}

function isOwnExtension(extensionId: string): boolean {
  return extensionId === props.project.ownExtensionId;
}

function formatEventTime(event: EventRecord): string {
  if (event.detectedAt) return formatRelativeDateTime(event.detectedAt);
  return event.date;
}

function getUnifiedEventKey(item: UnifiedEvent): string {
  if (item.kind === 'rank_change') {
    const rc = item.data as RankChange;
    return `rc-${rc.type}-${rc.extensionId}-${rc.keywordId}-${rc.date}`;
  }
  const ev = item.data as EventRecord;
  return `ev-${ev.id ?? `${ev.extensionId}-${ev.field}-${ev.date}`}`;
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
    <ExtensionListingCard
      :extension="ownExtension ?? null"
      :snapshot="ownSnapshot"
      :extension-id="project.ownExtensionId"
    />

    <!-- Status bar -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">Users</p>
        <p class="text-lg font-semibold text-gray-900">{{ ownSnapshot?.userCountNumeric == null ? '--' : ownSnapshot.userCountNumeric >= 1000 ? ownSnapshot.userCount : ownSnapshot.userCountNumeric.toLocaleString() }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">Reviews</p>
        <p class="text-lg font-semibold text-gray-900">{{ ownSnapshot?.reviewCount != null ? ownSnapshot.reviewCount.toLocaleString() : '--' }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">Keywords</p>
        <p class="text-lg font-semibold text-gray-900">{{ project.keywordIds.length }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3" :title="getLastScannedTooltip()">
        <p class="text-xs text-gray-500">Last Scan</p>
        <p class="text-lg font-semibold text-gray-900">{{ lastScanned }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">Next Scan</p>
        <p
          class="text-lg font-semibold"
          :class="scanStatus.isRunning ? 'text-blue-600' : settings.dailyScanEnabled ? 'text-gray-900' : 'text-gray-400'"
        >{{ getNextScan() }}</p>
      </div>
    </div>

    <!-- Scan actions -->
    <div class="flex items-center gap-3 mb-6">
      <button
        class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="scanStatus.isRunning || scanBlocked"
        :title="scanBlocked ? 'Configure a proxy in Settings to enable scanning' : ''"
        @click="requestRefresh(project.id)"
      >
        {{ scanStatus.isRunning ? 'Scanning...' : 'Scan Now' }}
      </button>
    </div>
    <p v-if="scanStatus.lastError" class="mb-4 text-sm text-red-600">
      Scan error: {{ scanStatus.lastError }}
    </p>

    <!-- Users & Reviews chart -->
    <div class="mb-8">
      <h3 class="text-base font-semibold text-gray-900 mb-3">Users & Reviews (Last 30 Days)</h3>
      <div v-if="snapshotHistory.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No listing data yet. Run a scan to track users and reviews.</p>
      </div>
      <UsersReviewsChart v-else :snapshots="snapshotHistory" />
    </div>

    <!-- Keyword positions chart (own extension only) -->
    <div class="mb-8">
      <h3 class="text-base font-semibold text-gray-900 mb-3">My Keyword Positions (Last 30 Days)</h3>
      <div v-if="ownKeywordSeries.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No ranking data yet. Run a scan to track keyword positions.</p>
      </div>
      <RankChart v-else :series="ownKeywordSeries" />
    </div>

    <!-- Autocomplete positions chart (own extension only) -->
    <div class="mb-8">
      <h3 class="text-base font-semibold text-gray-900 mb-3">My Autocomplete Positions (Last 30 Days)</h3>
      <div v-if="ownAcSeries.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No autocomplete data yet. Run a scan to track autocomplete positions.</p>
      </div>
      <AutocompleteChart v-else :series="ownAcSeries" />
    </div>

    <!-- Keyword positions table -->
    <div v-if="keywords.length > 0" class="mb-8">
      <KeywordPositionTable
        :keywords="keywords"
        :extension-id="project.ownExtensionId"
        :project-id="project.id"
      />
    </div>

    <!-- AC positions table -->
    <div v-if="keywords.length > 0" class="mb-8">
      <AcPositionTable
        :keywords="keywords"
        :extension-id="project.ownExtensionId"
        :project-id="project.id"
      />
    </div>

    <!-- Recent Events (unified: rank changes + listing events) -->
    <div>
      <h3 class="text-base font-semibold text-gray-900 mb-3">Recent Events</h3>
      <div v-if="unifiedEvents.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No data yet. Run your first scan.</p>
      </div>
      <div v-else class="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div class="divide-y divide-gray-50">
          <template v-for="item in unifiedEvents" :key="getUnifiedEventKey(item)">
            <RankChangeItem
              v-if="item.kind === 'rank_change'"
              :rank-change="(item.data as RankChange)"
              :link-to-project="false"
              :show-date="true"
            />
            <ListingEventItem
              v-else
              :event="(item.data as EventRecord)"
              :extension-name="getExtensionName((item.data as EventRecord).extensionId)"
              :extension-icon-url="getExtensionIconUrl((item.data as EventRecord).extensionId)"
              :is-own="isOwnExtension((item.data as EventRecord).extensionId)"
              :project-id="project.id ?? null"
              :formatted-time="formatEventTime(item.data as EventRecord)"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
