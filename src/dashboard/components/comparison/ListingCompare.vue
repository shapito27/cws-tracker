<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import type { Project, Extension, Keyword, ListingSnapshot } from '@/shared/types';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import ExtensionIcon from '../ExtensionIcon.vue';
import {
  highlightKeywords,
  computePermissionDiff,
  computeKeywordDensityMatrix,
  computeTextMetrics,
  fleschReadingEase,
  readabilityLabel,
  type HighlightSegment,
  type PermissionDiffResult,
  type KeywordDensityRow,
} from '@/shared/utils/comparison';
import { keywordDensity } from '@/shared/utils/text-analysis';
import { getPermissionWarning } from '@/shared/utils/permissions';
import AuditTool from '../ai/AuditTool.vue';

const props = defineProps<{
  project: Project;
}>();

const { getExtensionsByProject, getLatestSnapshot } = useExtensions();

const extensions = ref<Extension[]>([]);
const keywords = ref<Keyword[]>([]);
const snapshots = ref<Map<string, ListingSnapshot>>(new Map());
const selectedIds = ref<string[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

const EXTENSION_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B'];

// Audit tool state
const showAudit = ref(false);
const auditCompetitorId = ref<string | undefined>(undefined);
const auditPanelRef = ref<HTMLElement | null>(null);

function openAudit(competitorId?: string): void {
  auditCompetitorId.value = competitorId;
  showAudit.value = true;
  nextTick(() => {
    auditPanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function closeAudit(): void {
  showAudit.value = false;
}

onMounted(async () => {
  try {
    extensions.value = await getExtensionsByProject(props.project.id!);
    keywords.value = await db.getKeywordsByProject(props.project.id!);

    const newSnapshots = new Map<string, ListingSnapshot>();
    for (const ext of extensions.value) {
      const snapshot = await getLatestSnapshot(ext.id);
      if (snapshot) {
        newSnapshots.set(ext.id, snapshot);
      }
    }
    snapshots.value = newSnapshots;

    // Pre-select own extension + first competitor (up to 2)
    const preselect: string[] = [];
    if (extensions.value.length > 0) {
      const own = extensions.value.find(e => e.id === props.project.ownExtensionId);
      if (own) preselect.push(own.id);
      const firstComp = extensions.value.find(e => e.id !== props.project.ownExtensionId);
      if (firstComp) preselect.push(firstComp.id);
    }
    selectedIds.value = preselect;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
});

const selectedExtensions = computed(() =>
  selectedIds.value
    .map(id => extensions.value.find(e => e.id === id))
    .filter((e): e is Extension => e !== undefined)
);

const selectedSnapshots = computed(() => {
  const result = new Map<string, ListingSnapshot>();
  for (const id of selectedIds.value) {
    const s = snapshots.value.get(id);
    if (s) result.set(id, s);
  }
  return result;
});

const keywordTexts = computed(() => keywords.value.map(k => k.text));

const hasData = computed(() => selectedSnapshots.value.size >= 2);

// --- Permission diff ---
const permissionDiff = computed<PermissionDiffResult>(() => {
  const permMap = new Map<string, string[]>();
  for (const [id, snap] of selectedSnapshots.value) {
    permMap.set(id, [...snap.permissions, ...snap.hostPermissions]);
  }
  return computePermissionDiff(permMap);
});

// --- Keyword density matrix ---
const densityMatrix = computed<KeywordDensityRow[]>(() =>
  computeKeywordDensityMatrix(keywordTexts.value, selectedSnapshots.value)
);

// --- Memoized keyword highlighting ---
const highlightedTitles = computed(() => {
  const result = new Map<string, HighlightSegment[]>();
  for (const id of selectedIds.value) {
    const snap = snapshots.value.get(id);
    if (snap) {
      result.set(id, highlightKeywords(snap.title, keywordTexts.value));
    }
  }
  return result;
});

const highlightedShortDescs = computed(() => {
  const result = new Map<string, HighlightSegment[]>();
  for (const id of selectedIds.value) {
    const snap = snapshots.value.get(id);
    if (snap) {
      result.set(id, highlightKeywords(snap.shortDescription, keywordTexts.value));
    }
  }
  return result;
});

function toggleExtension(id: string): void {
  const idx = selectedIds.value.indexOf(id);
  if (idx >= 0) {
    // Only allow deselection if we'd still have at least 2 remaining
    if (selectedIds.value.length > 2) {
      selectedIds.value = selectedIds.value.filter(x => x !== id);
    }
  } else if (selectedIds.value.length < 4) {
    selectedIds.value = [...selectedIds.value, id];
  }
}

function getExtName(id: string): string {
  const ext = extensions.value.find(e => e.id === id);
  return ext?.name || id.slice(0, 12) + '...';
}

function getExtIconUrl(id: string): string | null {
  const ext = extensions.value.find(e => e.id === id);
  return ext?.iconUrl ?? null;
}

function getColor(id: string): string {
  const idx = selectedIds.value.indexOf(id);
  return EXTENSION_COLORS[idx >= 0 ? idx : 0];
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function getMaxMetric(metric: (snap: ListingSnapshot) => number): number {
  let max = 0;
  for (const [, snap] of selectedSnapshots.value) {
    max = Math.max(max, metric(snap));
  }
  return max || 1;
}
</script>

<template>
  <div>
    <div v-if="loading" class="text-center py-8">
      <p class="text-sm text-gray-500">Loading comparison data...</p>
    </div>

    <div v-else-if="loadError" class="rounded-lg bg-red-50 border border-red-200 p-6 text-center">
      <p class="text-sm text-red-700">Failed to load comparison data: {{ loadError }}</p>
    </div>

    <template v-else>
      <!-- Extension Selector -->
      <div class="mb-6">
        <h3 class="text-sm font-medium text-gray-700 mb-2">
          Select 2-4 extensions to compare
        </h3>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="ext in extensions"
            :key="ext.id"
            class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
            :class="selectedIds.includes(ext.id)
              ? 'border-blue-600 bg-blue-50 text-blue-700'
              : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'"
            :disabled="!selectedIds.includes(ext.id) && selectedIds.length >= 4"
            @click="toggleExtension(ext.id)"
          >
            <span
              v-if="selectedIds.includes(ext.id)"
              class="h-2.5 w-2.5 rounded-full"
              :style="{ backgroundColor: getColor(ext.id) }"
            />
            <ExtensionIcon :icon-url="ext.iconUrl" :name="ext.name || ext.id" size="xs" />
            <span
              v-if="ext.id === project.ownExtensionId"
              class="inline-flex rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800"
            >
              Own
            </span>
            {{ ext.name || ext.id }}
          </button>
        </div>
      </div>

      <!-- AI Analysis Section (only when exactly 2 extensions are selected) -->
      <section v-if="selectedIds.length === 2" class="mb-6">
        <h3 class="text-base font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-2">AI Analysis</h3>
        <div v-if="!showAudit" class="rounded-lg border-2 border-dashed border-purple-200 bg-purple-50 p-6 text-center">
          <p class="text-sm text-gray-600 mb-3">
            Use AI to analyze why a competitor ranks higher for a specific keyword.
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            <button
              v-for="id in selectedIds.filter(sid => sid !== project.ownExtensionId)"
              :key="'audit-' + id"
              class="rounded-md border border-purple-300 bg-white px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-100"
              @click="openAudit(id)"
            >
              Why higher: {{ getExtName(id) }}?
            </button>
          </div>
        </div>
        <Transition
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 -translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition-all duration-200 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 -translate-y-2"
        >
          <div v-if="showAudit" ref="auditPanelRef">
            <AuditTool
              :project="project"
              :pre-selected-competitor-id="auditCompetitorId"
              @close="closeAudit"
            />
          </div>
        </Transition>
      </section>

      <!-- No data state -->
      <div v-if="!hasData" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p class="text-sm text-gray-500">
          Select at least 2 extensions with scan data to see the comparison.
        </p>
      </div>

      <template v-else>
        <!-- Extension header with color indicators -->
        <div class="mb-6 grid gap-4" :style="{ gridTemplateColumns: `repeat(${selectedSnapshots.size}, minmax(0, 1fr))` }">
          <div
            v-for="id in selectedIds"
            :key="'header-' + id"
            class="rounded-lg border-t-4 bg-white p-3 shadow-sm"
            :style="{ borderTopColor: getColor(id) }"
          >
            <div class="flex items-center gap-1.5">
              <ExtensionIcon :icon-url="getExtIconUrl(id)" :name="getExtName(id)" size="sm" />
              <p class="text-sm font-semibold text-gray-900">{{ getExtName(id) }}</p>
            </div>
            <p class="text-xs text-gray-400 font-mono truncate" :title="id">{{ id.slice(0, 8) }}…</p>
          </div>
        </div>

        <!-- 2.2.2 Title Comparison -->
        <section class="mb-8">
          <h3 class="text-base font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-2">Title</h3>
          <div class="grid gap-4" :style="{ gridTemplateColumns: `repeat(${selectedSnapshots.size}, minmax(0, 1fr))` }">
            <div v-for="id in selectedIds" :key="'title-' + id" class="rounded-lg border border-gray-200 bg-white p-4">
              <template v-if="snapshots.get(id)">
                <p class="text-sm text-gray-900 mb-2">
                  <template v-for="(seg, i) in highlightedTitles.get(id)" :key="i">
                    <mark v-if="seg.highlighted" class="bg-yellow-200 rounded px-0.5">{{ seg.text }}</mark>
                    <span v-else>{{ seg.text }}</span>
                  </template>
                </p>
                <p class="text-xs text-gray-500">
                  {{ snapshots.get(id)!.title.length }} characters
                </p>
              </template>
              <p v-else class="text-sm text-gray-400">No data</p>
            </div>
          </div>
        </section>

        <!-- 2.2.2 Short Description Comparison -->
        <section class="mb-8">
          <h3 class="text-base font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-2">Short Description</h3>
          <div class="grid gap-4" :style="{ gridTemplateColumns: `repeat(${selectedSnapshots.size}, minmax(0, 1fr))` }">
            <div v-for="id in selectedIds" :key="'shortdesc-' + id" class="rounded-lg border border-gray-200 bg-white p-4">
              <template v-if="snapshots.get(id)">
                <p class="text-sm text-gray-900 mb-2">
                  <template v-for="(seg, i) in highlightedShortDescs.get(id)" :key="i">
                    <mark v-if="seg.highlighted" class="bg-yellow-200 rounded px-0.5">{{ seg.text }}</mark>
                    <span v-else>{{ seg.text }}</span>
                  </template>
                </p>
                <p class="text-xs text-gray-500">
                  {{ snapshots.get(id)!.shortDescription.length }}/132 characters
                </p>
              </template>
              <p v-else class="text-sm text-gray-400">No data</p>
            </div>
          </div>
        </section>

        <!-- 2.2.3 Full Description Comparison -->
        <section class="mb-8">
          <h3 class="text-base font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-2">Full Description</h3>
          <div class="grid gap-4" :style="{ gridTemplateColumns: `repeat(${selectedSnapshots.size}, minmax(0, 1fr))` }">
            <div v-for="id in selectedIds" :key="'fulldesc-' + id" class="rounded-lg border border-gray-200 bg-white p-4">
              <template v-if="snapshots.get(id)">
                <div class="flex flex-wrap gap-3 mb-3">
                  <span class="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
                    {{ computeTextMetrics(snapshots.get(id)!.fullDescription).wordCount }} words
                  </span>
                  <span class="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
                    {{ computeTextMetrics(snapshots.get(id)!.fullDescription).charCount }} chars
                  </span>
                  <span class="inline-flex items-center rounded-md px-2 py-1 text-xs"
                    :class="fleschReadingEase(snapshots.get(id)!.fullDescription) >= 60
                      ? 'bg-green-100 text-green-700'
                      : fleschReadingEase(snapshots.get(id)!.fullDescription) >= 40
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'"
                  >
                    Readability: {{ fleschReadingEase(snapshots.get(id)!.fullDescription) }}
                    ({{ readabilityLabel(fleschReadingEase(snapshots.get(id)!.fullDescription)) }})
                  </span>
                </div>
                <!-- Keyword density per tracked keyword -->
                <div v-if="keywordTexts.length > 0" class="mb-3">
                  <p class="text-xs font-medium text-gray-500 mb-1">Keyword density:</p>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="kw in keywordTexts"
                      :key="kw"
                      class="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
                    >
                      {{ kw }}: {{ (keywordDensity(snapshots.get(id)!.fullDescription, kw) * 100).toFixed(1) }}%
                    </span>
                  </div>
                </div>
                <div class="max-h-48 overflow-y-auto text-xs text-gray-700 whitespace-pre-wrap border-t border-gray-100 pt-2">
                  {{ snapshots.get(id)!.fullDescription.slice(0, 1000) }}{{ snapshots.get(id)!.fullDescription.length > 1000 ? '...' : '' }}
                </div>
              </template>
              <p v-else class="text-sm text-gray-400">No data</p>
            </div>
          </div>
        </section>

        <!-- 2.2.4 Permissions Comparison -->
        <section class="mb-8">
          <h3 class="text-base font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-2">Permissions</h3>

          <!-- Risk score bars -->
          <div class="mb-4">
            <p class="text-xs font-medium text-gray-500 mb-2">Permission Risk Score</p>
            <div class="space-y-2">
              <div v-for="id in selectedIds" :key="'risk-' + id" class="flex items-center gap-3">
                <span class="w-24 text-xs text-gray-700 truncate">{{ getExtName(id) }}</span>
                <div class="flex-1 h-4 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :style="{
                      width: (snapshots.get(id)?.permissionRiskScore ?? 0) + '%',
                      backgroundColor: (snapshots.get(id)?.permissionRiskScore ?? 0) >= 50
                        ? '#EF4444'
                        : (snapshots.get(id)?.permissionRiskScore ?? 0) >= 20
                          ? '#F59E0B'
                          : '#10B981'
                    }"
                  />
                </div>
                <span class="w-8 text-xs font-medium text-right"
                  :class="(snapshots.get(id)?.permissionRiskScore ?? 0) >= 50
                    ? 'text-red-600'
                    : (snapshots.get(id)?.permissionRiskScore ?? 0) >= 20
                      ? 'text-yellow-600'
                      : 'text-green-600'"
                >
                  {{ snapshots.get(id)?.permissionRiskScore ?? 0 }}
                </span>
              </div>
            </div>
          </div>

          <!-- Shared permissions -->
          <div v-if="permissionDiff.shared.length > 0" class="mb-3">
            <p class="text-xs font-medium text-gray-500 mb-1">Shared Permissions</p>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="perm in permissionDiff.shared"
                :key="perm"
                class="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                :title="getPermissionWarning(perm) ?? ''"
              >
                {{ perm }}
              </span>
            </div>
          </div>

          <!-- Unique permissions per extension -->
          <div class="grid gap-4" :style="{ gridTemplateColumns: `repeat(${selectedSnapshots.size}, minmax(0, 1fr))` }">
            <div v-for="id in selectedIds" :key="'perms-' + id">
              <p class="text-xs font-medium mb-1" :style="{ color: getColor(id) }">
                Unique to {{ getExtName(id) }}
              </p>
              <div v-if="(permissionDiff.uniquePerExtension.get(id) ?? []).length > 0" class="flex flex-wrap gap-1">
                <span
                  v-for="perm in permissionDiff.uniquePerExtension.get(id)"
                  :key="perm"
                  class="inline-flex rounded px-2 py-0.5 text-xs"
                  :class="getPermissionWarning(perm) ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'"
                  :title="getPermissionWarning(perm) ?? ''"
                >
                  {{ perm }}
                </span>
              </div>
              <p v-else class="text-xs text-gray-400">None</p>
            </div>
          </div>
        </section>

        <!-- 2.2.5 Metrics Comparison -->
        <section class="mb-8">
          <h3 class="text-base font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-2">Metrics</h3>

          <!-- Rating -->
          <div class="mb-4">
            <p class="text-xs font-medium text-gray-500 mb-2">Rating</p>
            <div class="space-y-1.5">
              <div v-for="id in selectedIds" :key="'rating-' + id" class="flex items-center gap-3">
                <span class="w-24 text-xs text-gray-700 truncate">{{ getExtName(id) }}</span>
                <div class="flex-1 h-3.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    class="h-full rounded-full"
                    :style="{
                      width: ((snapshots.get(id)?.rating ?? 0) / 5 * 100) + '%',
                      backgroundColor: getColor(id)
                    }"
                  />
                </div>
                <span class="w-10 text-xs text-gray-700 text-right">
                  {{ snapshots.get(id)?.rating?.toFixed(1) ?? '-' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Review Count -->
          <div class="mb-4">
            <p class="text-xs font-medium text-gray-500 mb-2">Reviews</p>
            <div class="space-y-1.5">
              <div v-for="id in selectedIds" :key="'reviews-' + id" class="flex items-center gap-3">
                <span class="w-24 text-xs text-gray-700 truncate">{{ getExtName(id) }}</span>
                <div class="flex-1 h-3.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    class="h-full rounded-full"
                    :style="{
                      width: (snapshots.get(id) ? snapshots.get(id)!.reviewCount / getMaxMetric(s => s.reviewCount) * 100 : 0) + '%',
                      backgroundColor: getColor(id)
                    }"
                  />
                </div>
                <span class="w-10 text-xs text-gray-700 text-right">
                  {{ snapshots.get(id) ? formatNumber(snapshots.get(id)!.reviewCount) : '-' }}
                </span>
              </div>
            </div>
          </div>

          <!-- User Count -->
          <div class="mb-4">
            <p class="text-xs font-medium text-gray-500 mb-2">Users</p>
            <div class="space-y-1.5">
              <div v-for="id in selectedIds" :key="'users-' + id" class="flex items-center gap-3">
                <span class="w-24 text-xs text-gray-700 truncate">{{ getExtName(id) }}</span>
                <div class="flex-1 h-3.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    class="h-full rounded-full"
                    :style="{
                      width: (snapshots.get(id) ? snapshots.get(id)!.userCountNumeric / getMaxMetric(s => s.userCountNumeric) * 100 : 0) + '%',
                      backgroundColor: getColor(id)
                    }"
                  />
                </div>
                <span class="w-14 text-xs text-gray-700 text-right">
                  {{ snapshots.get(id)?.userCountNumeric != null && snapshots.get(id)!.userCountNumeric >= 1000 ? snapshots.get(id)!.userCount : '-' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Screenshot Count -->
          <div class="mb-4">
            <p class="text-xs font-medium text-gray-500 mb-2">Screenshots</p>
            <div class="space-y-1.5">
              <div v-for="id in selectedIds" :key="'screenshots-' + id" class="flex items-center gap-3">
                <span class="w-24 text-xs text-gray-700 truncate">{{ getExtName(id) }}</span>
                <div class="flex-1 h-3.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    class="h-full rounded-full"
                    :style="{
                      width: (snapshots.get(id) ? snapshots.get(id)!.screenshotCount / getMaxMetric(s => s.screenshotCount) * 100 : 0) + '%',
                      backgroundColor: getColor(id)
                    }"
                  />
                </div>
                <span class="w-10 text-xs text-gray-700 text-right">
                  {{ snapshots.get(id)?.screenshotCount ?? '-' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Translation Count -->
          <div class="mb-4">
            <p class="text-xs font-medium text-gray-500 mb-2">Translations</p>
            <div class="space-y-1.5">
              <div v-for="id in selectedIds" :key="'translations-' + id" class="flex items-center gap-3">
                <span class="w-24 text-xs text-gray-700 truncate">{{ getExtName(id) }}</span>
                <div class="flex-1 h-3.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    class="h-full rounded-full"
                    :style="{
                      width: (snapshots.get(id) ? snapshots.get(id)!.translationCount / getMaxMetric(s => s.translationCount) * 100 : 0) + '%',
                      backgroundColor: getColor(id)
                    }"
                  />
                </div>
                <span class="w-10 text-xs text-gray-700 text-right">
                  {{ snapshots.get(id)?.translationCount ?? '-' }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- 2.2.6 Keyword Density Matrix -->
        <section v-if="keywordTexts.length > 0" class="mb-8">
          <h3 class="text-base font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-2">Keyword Density Matrix</h3>
          <div class="overflow-x-auto rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Keyword
                  </th>
                  <template v-for="id in selectedIds" :key="'kd-header-' + id">
                    <th class="px-2 py-2 text-center text-xs font-medium tracking-wide border-l border-gray-200"
                      :style="{ color: getColor(id) }"
                      colspan="3"
                    >
                      <div class="inline-flex items-center gap-1">
                        <ExtensionIcon :icon-url="getExtIconUrl(id)" :name="getExtName(id)" size="xs" />
                        {{ getExtName(id) }}
                      </div>
                    </th>
                  </template>
                </tr>
                <tr>
                  <th class="px-3 py-1 text-left text-xs text-gray-400"></th>
                  <template v-for="id in selectedIds" :key="'kd-subheader-' + id">
                    <th class="px-2 py-1 text-center text-xs text-gray-400 border-l border-gray-200">Title</th>
                    <th class="px-2 py-1 text-center text-xs text-gray-400">Short</th>
                    <th class="px-2 py-1 text-center text-xs text-gray-400">Full</th>
                  </template>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 bg-white">
                <tr v-for="row in densityMatrix" :key="row.keyword" class="hover:bg-gray-50">
                  <td class="px-3 py-2 text-sm text-gray-900 font-medium">{{ row.keyword }}</td>
                  <template v-for="cell in row.extensions" :key="cell.extensionId">
                    <td class="px-2 py-2 text-center text-sm border-l border-gray-200"
                      :class="cell.titleCount > 0 ? 'text-green-700 font-medium' : 'text-gray-400'"
                    >
                      {{ cell.titleCount }}
                    </td>
                    <td class="px-2 py-2 text-center text-sm"
                      :class="cell.shortDescCount > 0 ? 'text-green-700 font-medium' : 'text-gray-400'"
                    >
                      {{ cell.shortDescCount }}
                    </td>
                    <td class="px-2 py-2 text-center text-sm"
                      :class="cell.fullDescCount > 0 ? 'text-green-700 font-medium' : 'text-gray-400'"
                    >
                      {{ cell.fullDescCount }}
                    </td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- No keywords state for density matrix -->
        <section v-else class="mb-8">
          <h3 class="text-base font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-2">Keyword Density Matrix</h3>
          <div class="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
            <p class="text-sm text-gray-500">
              Add keywords in the Keywords tab to see keyword density comparison.
            </p>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
