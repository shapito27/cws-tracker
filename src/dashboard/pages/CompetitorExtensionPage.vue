<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Project, Extension, EventRecord, Keyword, ListingSnapshot } from '@/shared/types';
import type { RankChartSeries } from '../composables/useRankings';
import type { AutocompleteChartSeries } from '../composables/useAutocomplete';
import {
  loadRecentRankChanges,
  loadRecentAutocompleteChanges,
  type RankChange,
} from '@/popup/composables/usePopupState';
import { db } from '@/shared/db/database';
import { useExtensions } from '../composables/useExtensions';
import { loadExtensionRankHistory } from '../composables/useRankings';
import { loadExtensionAutocompleteHistory } from '../composables/useAutocomplete';
import { daysAgo, today } from '@/shared/utils/dates';
import ListingEventItem from '../components/ListingEventItem.vue';
import RankChangeItem from '../components/RankChangeItem.vue';
import RankChart from '../components/charts/RankChart.vue';
import AutocompleteChart from '../components/charts/AutocompleteChart.vue';
import UsersReviewsChart from '../components/charts/UsersReviewsChart.vue';
import KeywordPositionTable from '../components/tables/KeywordPositionTable.vue';
import AcPositionTable from '../components/tables/AcPositionTable.vue';

type UnifiedEvent =
  | { kind: 'rank_change'; data: RankChange; sortTime: number }
  | { kind: 'listing_event'; data: EventRecord; sortTime: number };

const route = useRoute();
const router = useRouter();
const { getLatestSnapshot } = useExtensions();

const project = ref<Project | null>(null);
const extension = ref<Extension | null>(null);
const snapshot = ref<ListingSnapshot | undefined>(undefined);
const snapshotHistory = ref<ListingSnapshot[]>([]);
const keywords = ref<Keyword[]>([]);
const rankSeries = ref<RankChartSeries[]>([]);
const acSeries = ref<AutocompleteChartSeries[]>([]);
const listingEvents = ref<EventRecord[]>([]);
const rankChanges = ref<RankChange[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

const projectId = computed(() => Number(route.params.id));
const extensionId = computed(() => String(route.params.extId));

const cwsUrl = computed(() =>
  `https://chromewebstore.google.com/detail/-/${extensionId.value}`
);

async function loadAll(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const p = await db.getProject(projectId.value);
    if (!p) {
      router.replace({ name: 'home' });
      return;
    }
    project.value = p;

    // Guard: own extension or unknown id → redirect back to project.
    if (
      extensionId.value === p.ownExtensionId ||
      !p.competitorIds.includes(extensionId.value)
    ) {
      router.replace({ name: 'project', params: { id: String(p.id) } });
      return;
    }

    const ext = await db.getExtension(extensionId.value);
    if (!ext) {
      loadError.value = 'Extension not found';
      return;
    }
    extension.value = ext;

    snapshot.value = await getLatestSnapshot(extensionId.value);

    snapshotHistory.value = await db.getListingSnapshots(
      extensionId.value,
      daysAgo(30),
      today()
    );

    if (p.id !== undefined) {
      keywords.value = await db.getKeywordsByProject(p.id);
    }

    if (keywords.value.length > 0) {
      const [rs, as] = await Promise.all([
        loadExtensionRankHistory(
          keywords.value,
          extensionId.value,
          daysAgo(30),
          today()
        ),
        loadExtensionAutocompleteHistory(
          keywords.value,
          extensionId.value,
          daysAgo(30),
          today()
        ),
      ]);
      rankSeries.value = rs;
      acSeries.value = as;
    } else {
      rankSeries.value = [];
      acSeries.value = [];
    }

    await Promise.all([loadCompetitorRankChanges(), loadCompetitorEvents()]);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load competitor overview';
  } finally {
    loading.value = false;
  }
}

async function loadCompetitorRankChanges(): Promise<void> {
  try {
    const [rankResults, acResults] = await Promise.all([
      loadRecentRankChanges(100),
      loadRecentAutocompleteChanges(100),
    ]);
    const combined = [...rankResults, ...acResults].filter(
      (rc) => rc.extensionId === extensionId.value && rc.projectId === projectId.value
    );
    combined.sort(
      (a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0)
    );
    rankChanges.value = combined.slice(0, 10);
  } catch {
    rankChanges.value = [];
  }
}

async function loadCompetitorEvents(): Promise<void> {
  try {
    const events = await db.getEvents(extensionId.value, daysAgo(90), today());
    events.sort((a, b) => {
      const aTime = a.detectedAt?.getTime() ?? 0;
      const bTime = b.detectedAt?.getTime() ?? 0;
      if (aTime && bTime) return bTime - aTime;
      if (aTime) return -1;
      if (bTime) return 1;
      return b.date.localeCompare(a.date);
    });
    listingEvents.value = events.filter((e) => e.type !== 'rank_change').slice(0, 20);
  } catch {
    listingEvents.value = [];
  }
}

const unifiedEvents = computed((): UnifiedEvent[] => {
  const items: UnifiedEvent[] = [];
  for (const rc of rankChanges.value) {
    const t = rc.scannedAt instanceof Date ? rc.scannedAt.getTime() : new Date(rc.scannedAt).getTime();
    items.push({ kind: 'rank_change', data: rc, sortTime: t || 0 });
  }
  for (const ev of listingEvents.value) {
    const t = ev.detectedAt?.getTime() ?? new Date(ev.date + 'T00:00:00').getTime();
    items.push({ kind: 'listing_event', data: ev, sortTime: t || 0 });
  }
  items.sort((a, b) => b.sortTime - a.sortTime);
  return items.slice(0, 15);
});

onMounted(loadAll);

watch(
  () => [projectId.value, extensionId.value],
  loadAll
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
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
}

const lastScanned = computed<string>(() => {
  const d = extension.value?.lastScannedAt;
  if (!d) return 'Never';
  return formatRelativeDateTime(d);
});

const lastScannedTooltip = computed<string>(() => {
  const d = extension.value?.lastScannedAt;
  return d ? d.toLocaleString() : '';
});

function formatEventTime(event: EventRecord): string {
  if (event.detectedAt) return formatRelativeDateTime(event.detectedAt);
  return event.date;
}

function getExtensionIconUrl(): string | null {
  return extension.value?.iconUrl ?? null;
}

function getDisplayName(): string {
  return snapshot.value?.title || extension.value?.name || extensionId.value;
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
  <div v-if="loading" class="text-center py-12">
    <p class="text-sm text-gray-500">Loading competitor overview...</p>
  </div>

  <div v-else-if="loadError" class="rounded-lg bg-red-50 border border-red-200 p-6 text-center">
    <p class="text-sm text-red-700">Failed to load competitor: {{ loadError }}</p>
    <button
      class="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
      @click="loadAll"
    >
      Retry
    </button>
  </div>

  <div v-else-if="project && extension">
    <!-- Breadcrumb -->
    <div class="mb-6">
      <div class="flex items-center gap-2 mb-1 text-sm">
        <router-link to="/" class="text-gray-500 hover:text-gray-700">Projects</router-link>
        <span class="text-gray-400">/</span>
        <router-link
          :to="{ name: 'project', params: { id: String(project.id) } }"
          class="text-gray-500 hover:text-gray-700"
        >{{ project.name }}</router-link>
        <span class="text-gray-400">/</span>
        <span class="text-gray-400">Competitor</span>
      </div>
      <h2 class="text-2xl font-bold text-gray-900">{{ getDisplayName() }}</h2>
    </div>

    <!-- Extension header card -->
    <div class="rounded-lg border border-gray-200 bg-white p-5 mb-6">
      <div class="flex items-start gap-4">
        <img
          v-if="extension.iconUrl"
          :src="extension.iconUrl"
          :alt="getDisplayName()"
          class="h-14 w-14 rounded-lg flex-shrink-0"
        />
        <div
          v-else
          class="flex h-14 w-14 items-center justify-center rounded-lg bg-gray-100 text-lg font-bold text-gray-600 flex-shrink-0"
          role="img"
          :aria-label="getDisplayName()"
        >
          {{ getDisplayName().charAt(0).toUpperCase() }}
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-3">
            <h3 class="text-lg font-semibold text-gray-900 truncate">
              {{ getDisplayName() }}
            </h3>
            <span class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 shrink-0">
              Competitor
            </span>
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

          <div class="mt-2 flex flex-wrap items-center gap-2">
            <span v-if="snapshot?.rating != null" class="inline-flex items-center gap-1 text-sm text-gray-600">
              <svg class="h-4 w-4 text-yellow-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clip-rule="evenodd" />
              </svg>
              {{ snapshot.rating.toFixed(1) }}
              <span v-if="snapshot.ratingCount" class="text-gray-400">({{ snapshot.ratingCount.toLocaleString() }})</span>
            </span>
            <span v-if="snapshot?.rating != null && snapshot?.version" class="text-gray-300" aria-hidden="true">|</span>
            <span v-if="snapshot?.version" class="text-sm text-gray-500">
              v{{ snapshot.version }}
            </span>
            <span v-if="snapshot?.version && snapshot?.developerName" class="text-gray-300" aria-hidden="true">|</span>
            <span v-if="snapshot?.developerName" class="text-sm text-gray-500">
              by {{ snapshot.developerName }}
            </span>
            <span
              v-if="snapshot?.badgeFlags?.featured"
              class="inline-flex items-center gap-1 rounded-full bg-yellow-50 border border-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-700"
            >
              <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clip-rule="evenodd" />
              </svg>
              Featured
            </span>
            <span
              v-if="snapshot?.developerVerified"
              class="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700"
            >
              <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M16.403 12.652a3 3 0 0 0 0-5.304 3 3 0 0 0-3.75-3.751 3 3 0 0 0-5.305 0 3 3 0 0 0-3.751 3.75 3 3 0 0 0 0 5.305 3 3 0 0 0 3.75 3.751 3 3 0 0 0 5.305 0 3 3 0 0 0 3.751-3.75Zm-2.546-4.46a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
              </svg>
              Verified Publisher
            </span>
            <span
              v-if="snapshot?.translationCount"
              class="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700"
            >
              {{ snapshot.translationCount }} languages
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Status bar -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">Users</p>
        <p class="text-lg font-semibold text-gray-900">{{ snapshot?.userCount ?? '--' }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">Reviews</p>
        <p class="text-lg font-semibold text-gray-900">{{ snapshot?.reviewCount != null ? snapshot.reviewCount.toLocaleString() : '--' }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">Keywords</p>
        <p class="text-lg font-semibold text-gray-900">{{ project.keywordIds.length }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3" :title="lastScannedTooltip">
        <p class="text-xs text-gray-500">Last Scan</p>
        <p class="text-lg font-semibold text-gray-900">{{ lastScanned }}</p>
      </div>
    </div>

    <!-- Users & Reviews chart -->
    <div class="mb-8">
      <h3 class="text-base font-semibold text-gray-900 mb-3">Users & Reviews (Last 30 Days)</h3>
      <div v-if="snapshotHistory.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No listing data yet for this competitor.</p>
      </div>
      <UsersReviewsChart v-else :snapshots="snapshotHistory" />
    </div>

    <!-- Keyword positions chart -->
    <div class="mb-8">
      <h3 class="text-base font-semibold text-gray-900 mb-3">Keyword Positions (Last 30 Days)</h3>
      <div v-if="rankSeries.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No ranking data yet for this competitor.</p>
      </div>
      <RankChart v-else :series="rankSeries" />
    </div>

    <!-- Autocomplete positions chart -->
    <div class="mb-8">
      <h3 class="text-base font-semibold text-gray-900 mb-3">Autocomplete Positions (Last 30 Days)</h3>
      <div v-if="acSeries.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No autocomplete data yet for this competitor.</p>
      </div>
      <AutocompleteChart v-else :series="acSeries" />
    </div>

    <!-- Keyword positions table -->
    <div v-if="keywords.length > 0" class="mb-8">
      <KeywordPositionTable
        :keywords="keywords"
        :extension-id="extensionId"
      />
    </div>

    <!-- AC positions table -->
    <div v-if="keywords.length > 0" class="mb-8">
      <AcPositionTable
        :keywords="keywords"
        :extension-id="extensionId"
      />
    </div>

    <!-- Recent Events -->
    <div>
      <h3 class="text-base font-semibold text-gray-900 mb-3">Recent Events</h3>
      <div v-if="unifiedEvents.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">No events for this competitor yet.</p>
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
              :extension-name="getDisplayName()"
              :extension-icon-url="getExtensionIconUrl()"
              :is-own="false"
              :project-id="project.id ?? null"
              :formatted-time="formatEventTime(item.data as EventRecord)"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
