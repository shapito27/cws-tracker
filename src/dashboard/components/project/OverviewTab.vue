<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { Project, Extension, EventRecord, Keyword, ListingSnapshot } from '@/shared/types';
import type { RankChartSeries } from '../../composables/useRankings';
import {
  loadRecentRankChanges,
  loadRecentAutocompleteChanges,
  type RankChange,
} from '@/popup/composables/usePopupState';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import { useServiceWorker } from '../../composables/useServiceWorker';
import { useSettings } from '../../composables/useSettings';
import { loadOwnExtensionRankHistory } from '../../composables/useRankings';
import { daysAgo, today } from '@/shared/utils/dates';
import ListingEventItem from '../ListingEventItem.vue';
import RankChangeItem from '../RankChangeItem.vue';
import RankChart from '../charts/RankChart.vue';
import UsersReviewsChart from '../charts/UsersReviewsChart.vue';
import KeywordPositionTable from '../tables/KeywordPositionTable.vue';

const props = defineProps<{
  project: Project;
}>();

const { getExtensionsByProject, getLatestSnapshot } = useExtensions();
const { scanStatus, requestRefresh } = useServiceWorker();
const { settings, loadSettings } = useSettings();

type UnifiedEvent =
  | { kind: 'rank_change'; data: RankChange; sortTime: number }
  | { kind: 'listing_event'; data: EventRecord; sortTime: number };

const extensions = ref<Extension[]>([]);
const ownExtension = ref<Extension | undefined>(undefined);
const recentEvents = ref<EventRecord[]>([]);
const projectRankChanges = ref<RankChange[]>([]);
const ownKeywordSeries = ref<RankChartSeries[]>([]);
const keywords = ref<Keyword[]>([]);
const ownSnapshot = ref<ListingSnapshot | undefined>(undefined);
const snapshotHistory = ref<ListingSnapshot[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

const cwsUrl = computed(() =>
  `https://chromewebstore.google.com/detail/-/${props.project.ownExtensionId}`
);

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
      ownKeywordSeries.value = await loadOwnExtensionRankHistory(
        keywords.value,
        props.project.ownExtensionId,
        daysAgo(30),
        today()
      );
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

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  return `ev-${(item.data as EventRecord).id}`;
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
    <!-- Extension header card -->
    <div class="rounded-lg border border-gray-200 bg-white p-5 mb-6">
      <div class="flex items-start gap-4">
        <!-- Extension icon -->
        <img
          v-if="ownExtension?.iconUrl"
          :src="ownExtension.iconUrl"
          :alt="ownSnapshot?.title || ownExtension?.name || 'Extension'"
          class="h-14 w-14 rounded-lg flex-shrink-0"
        />
        <div
          v-else
          class="flex h-14 w-14 items-center justify-center rounded-lg bg-blue-100 text-lg font-bold text-blue-600 flex-shrink-0"
          role="img"
          :aria-label="ownSnapshot?.title || ownExtension?.name || 'Extension'"
        >
          {{ (ownSnapshot?.title || ownExtension?.name || '?').charAt(0).toUpperCase() }}
        </div>

        <!-- Extension info -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-3">
            <h3 class="text-lg font-semibold text-gray-900 truncate">
              {{ ownSnapshot?.title || ownExtension?.name || project.ownExtensionId }}
            </h3>
            <a
              :href="cwsUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 flex-shrink-0"
              aria-label="Open in Chrome Web Store (opens in new tab)"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" clip-rule="evenodd" />
                <path fill-rule="evenodd" d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" clip-rule="evenodd" />
              </svg>
              Chrome Web Store
            </a>
          </div>

          <!-- Badges and metadata row -->
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <!-- Rating -->
            <span v-if="ownSnapshot?.rating != null" class="inline-flex items-center gap-1 text-sm text-gray-600">
              <svg class="h-4 w-4 text-yellow-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clip-rule="evenodd" />
              </svg>
              {{ ownSnapshot.rating.toFixed(1) }}
              <span v-if="ownSnapshot.ratingCount" class="text-gray-400">({{ ownSnapshot.ratingCount.toLocaleString() }})</span>
            </span>

            <!-- Separator before version (shown only when both rating and version exist) -->
            <span v-if="ownSnapshot?.rating != null && ownSnapshot?.version" class="text-gray-300" aria-hidden="true">|</span>

            <!-- Version -->
            <span v-if="ownSnapshot?.version" class="text-sm text-gray-500">
              v{{ ownSnapshot.version }}
            </span>

            <!-- Separator before developer (shown only when version and developer both exist) -->
            <span v-if="ownSnapshot?.version && ownSnapshot?.developerName" class="text-gray-300" aria-hidden="true">|</span>

            <!-- Developer -->
            <span v-if="ownSnapshot?.developerName" class="text-sm text-gray-500">
              by {{ ownSnapshot.developerName }}
            </span>

            <!-- Featured badge -->
            <span
              v-if="ownSnapshot?.badgeFlags?.featured"
              class="inline-flex items-center gap-1 rounded-full bg-yellow-50 border border-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-700"
            >
              <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clip-rule="evenodd" />
              </svg>
              Featured
            </span>

            <!-- Developer verified -->
            <span
              v-if="ownSnapshot?.developerVerified"
              class="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700"
            >
              <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M16.403 12.652a3 3 0 0 0 0-5.304 3 3 0 0 0-3.75-3.751 3 3 0 0 0-5.305 0 3 3 0 0 0-3.751 3.75 3 3 0 0 0 0 5.305 3 3 0 0 0 3.75 3.751 3 3 0 0 0 5.305 0 3 3 0 0 0 3.751-3.75Zm-2.546-4.46a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
              </svg>
              Verified Publisher
            </span>

            <!-- Translation count -->
            <span
              v-if="ownSnapshot?.translationCount"
              class="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700"
            >
              <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M7.75 2.75a.75.75 0 0 0-1.5 0v1.258a32.987 32.987 0 0 0-3.599.278.75.75 0 1 0 .198 1.487A31.545 31.545 0 0 1 8.7 5.545 19.381 19.381 0 0 1 7.257 9.22a19.378 19.378 0 0 1-1.307-2.353.75.75 0 0 0-1.397.547c.5 1.27 1.18 2.45 1.997 3.532a20.924 20.924 0 0 1-4.241 3.31.75.75 0 1 0 .78 1.28 22.404 22.404 0 0 0 4.52-3.635 22.403 22.403 0 0 0 4.52 3.635.75.75 0 0 0 .78-1.28 20.932 20.932 0 0 1-4.241-3.31c.816-1.082 1.496-2.263 1.997-3.532a.75.75 0 0 0-1.397-.547 19.38 19.38 0 0 1-1.306 2.353c-.648-.935-1.2-1.942-1.638-3.014A31.52 31.52 0 0 1 14 5.773a.75.75 0 1 0 .198-1.487 32.99 32.99 0 0 0-3.599-.278V2.75Z" />
                <path d="M13 8a.75.75 0 0 1 .671.415l4.25 8.5a.75.75 0 1 1-1.342.67L15.322 15h-4.644l-1.257 2.585a.75.75 0 1 1-1.342-.67l4.25-8.5A.75.75 0 0 1 13 8Zm-1.822 5.5h3.644L13 10.28 11.178 13.5Z" />
              </svg>
              {{ ownSnapshot.translationCount }} languages
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Status bar -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">Users</p>
        <p class="text-lg font-semibold text-gray-900">{{ ownSnapshot?.userCount ?? '--' }}</p>
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
        class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        :disabled="scanStatus.isRunning"
        @click="requestRefresh(project.id)"
      >
        {{ scanStatus.isRunning ? 'Scanning...' : 'Scan Now' }}
      </button>
      <span v-if="scanStatus.isRunning && scanStatus.total > 0" class="text-sm text-gray-500">
        {{ scanStatus.completed }}/{{ scanStatus.total }}
      </span>
    </div>
    <p v-if="scanStatus.isRunning && scanStatus.nextProcessingAt" class="mb-4 text-xs text-gray-500">
      Next job at {{ formatTime(scanStatus.nextProcessingAt) }}
    </p>
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

    <!-- Keyword positions table -->
    <div v-if="keywords.length > 0" class="mb-8">
      <KeywordPositionTable
        :keywords="keywords"
        :own-extension-id="project.ownExtensionId"
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
              :formatted-time="formatEventTime(item.data as EventRecord)"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
