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
import ExtensionListingCard from '../components/project/ExtensionListingCard.vue';

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
    // Pass an effectively-unbounded limit so this competitor's changes are
    // not clipped by the global magnitude sort inside the loaders before
    // we filter down to this one extension + project.
    const [rankResults, acResults] = await Promise.all([
      loadRecentRankChanges(Number.MAX_SAFE_INTEGER),
      loadRecentAutocompleteChanges(Number.MAX_SAFE_INTEGER),
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
  const ev = item.data as EventRecord;
  return `ev-${ev.id ?? `${ev.extensionId}-${ev.field}-${ev.date}`}`;
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

    <ExtensionListingCard
      :extension="extension"
      :snapshot="snapshot"
      :extension-id="extensionId"
      badge="competitor"
    />

    <!-- Status bar -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">Users</p>
        <p class="text-lg font-semibold text-gray-900">{{ snapshot?.userCountNumeric == null ? '--' : snapshot.userCountNumeric >= 1000 ? snapshot.userCount : snapshot.userCountNumeric.toLocaleString() }}</p>
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
