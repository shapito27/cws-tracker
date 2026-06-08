<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import type { SavedScanLog } from '../composables/useScanLogs';
import { useScanLogs } from '../composables/useScanLogs';
import RequestStatsChart from '../components/charts/RequestStatsChart.vue';

const {
  logs,
  loading,
  error,
  filterLevel,
  filterJobType,
  jobTypes,
  filteredLogs,
  logGroups,
  stats,
  weeklyStats,
  loadLogs,
} = useScanLogs();

const expandedIds = ref<Set<number>>(new Set());
const advancedMode = ref(false);
const copiedKey = ref<string | null>(null);

onMounted(() => {
  loadLogs();
});

function toggleExpand(id: number): void {
  const next = new Set(expandedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedIds.value = next;
}

function isExpanded(id: number): boolean {
  return expandedIds.value.has(id);
}

async function copyToClipboard(text: string, key: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 1200);
  } catch {
    // Clipboard may be unavailable (permissions / insecure context) - ignore.
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFullTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const base = d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${base}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function levelBadgeClass(level: string): string {
  switch (level) {
    case 'warn':
      return 'bg-amber-100 text-amber-800';
    case 'error':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function levelDotClass(level: string): string {
  switch (level) {
    case 'warn':
      return 'bg-amber-400';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-300';
  }
}

function statusClass(status: number | null): string {
  if (status === null) return 'text-gray-400';
  if (status < 300) return 'text-green-600';
  if (status < 400) return 'text-blue-600';
  return 'text-amber-600';
}

function rowBorderClass(level: string): string {
  switch (level) {
    case 'error':
      return 'border-l-red-500';
    case 'warn':
      return 'border-l-amber-400';
    default:
      return 'border-l-transparent';
  }
}

function jobTypeLabel(type: string): string {
  switch (type) {
    case 'listing_scan':
      return 'Listing';
    case 'keyword_scan':
      return 'Keyword';
    case 'translation_audit':
      return 'Translation';
    case 'autocomplete_scan':
      return 'Autocomplete';
    default:
      return type;
  }
}

/** Render a duration; synthetic / un-timed entries store 0ms — show a dash instead. */
function durationLabel(ms: number): string {
  return ms > 0 ? `${ms}ms` : '—';
}

function pageLabel(log: SavedScanLog): string | null {
  if (log.pageNumber === undefined || log.pageNumber === null) return null;
  return `Page ${log.pageNumber}`;
}

// ---------------------------------------------------------------------------
// Request detail helpers
// ---------------------------------------------------------------------------

interface ParsedRequestParams {
  baseUrl: string;
  params: Array<{ key: string; value: string }>;
}

function parseRequestUrl(url: string): ParsedRequestParams {
  try {
    const parsed = new URL(url);
    const params: Array<{ key: string; value: string }> = [];
    parsed.searchParams.forEach((value, key) => {
      params.push({ key, value });
    });
    return {
      baseUrl: `${parsed.origin}${parsed.pathname}`,
      params,
    };
  } catch {
    return { baseUrl: url, params: [] };
  }
}

/** Cache parsed URLs keyed by log id to avoid re-parsing in template. */
const parsedUrls = computed<Map<number, ParsedRequestParams>>(() => {
  const map = new Map<number, ParsedRequestParams>();
  for (const log of filteredLogs.value) {
    map.set(log.id, parseRequestUrl(log.requestUrl));
  }
  return map;
});

function getParsedUrl(logId: number): ParsedRequestParams {
  return parsedUrls.value.get(logId) ?? { baseUrl: '', params: [] };
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Scan Logs</h1>
      <p class="mt-1 text-sm text-gray-500">Request history for the last 7 days, grouped by scan job</p>
    </div>

    <!-- Daily stats chart -->
    <div class="mb-4">
      <RequestStatsChart :stats="weeklyStats" />
    </div>

    <!-- Filters + Refresh -->
    <div class="mb-4 flex items-center gap-4">
      <select
        v-model="filterLevel"
        class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="all">All levels</option>
        <option value="info">Info</option>
        <option value="warn">Warning</option>
        <option value="error">Error</option>
      </select>

      <select
        v-model="filterJobType"
        class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="all">All job types</option>
        <option v-for="jt in jobTypes" :key="jt" :value="jt">
          {{ jobTypeLabel(jt) }}
        </option>
      </select>

      <button
        class="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
        :class="advancedMode
          ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'"
        :title="advancedMode ? 'Showing request URL, parameters & full response body' : 'Show request URL, parameters & full response body'"
        @click="advancedMode = !advancedMode"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
        </svg>
        {{ advancedMode ? 'Advanced' : 'Simple' }}
      </button>

      <button
        class="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        @click="loadLogs"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
        </svg>
        Refresh
      </button>
    </div>

    <!-- Error banner -->
    <div
      v-if="error"
      class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
    >
      <p class="text-sm text-red-700">Failed to load logs: {{ error }}</p>
    </div>

    <!-- Stats bar -->
    <div
      v-if="!loading && stats.total > 0"
      class="mb-4 flex items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-2 text-xs text-gray-600"
    >
      <span>{{ stats.total }} request{{ stats.total !== 1 ? 's' : '' }}</span>
      <span v-if="stats.warnCount > 0" class="text-gray-300">&middot;</span>
      <span v-if="stats.warnCount > 0" class="text-amber-700">{{ stats.warnCount }} warning{{ stats.warnCount !== 1 ? 's' : '' }}</span>
      <span v-if="stats.errorCount > 0" class="text-gray-300">&middot;</span>
      <span v-if="stats.errorCount > 0" class="text-red-700">{{ stats.errorCount }} error{{ stats.errorCount !== 1 ? 's' : '' }}</span>
      <span class="text-gray-300">&middot;</span>
      <span>avg {{ stats.avgDurationMs }}ms</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="py-8 text-center">
      <p class="text-sm text-gray-500">Loading logs...</p>
    </div>

    <!-- Empty state (no logs at all) -->
    <div
      v-else-if="logs.length === 0 && !error"
      class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center"
    >
      <svg class="mx-auto h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
      <p class="mt-2 text-sm text-gray-500">No scan logs yet. Logs will appear here after your first scan.</p>
    </div>

    <!-- Filtered empty -->
    <div
      v-else-if="filteredLogs.length === 0 && !error"
      class="rounded-lg border border-gray-200 bg-white p-8 text-center"
    >
      <p class="text-sm text-gray-500">No logs match the selected filters.</p>
    </div>

    <!-- Log list grouped by date → scan job -->
    <div v-else class="space-y-5">
      <div v-for="dateGroup in logGroups" :key="dateGroup.date">
        <!-- Date separator -->
        <div class="mb-2 text-xs font-medium text-gray-400">{{ formatDate(dateGroup.jobs[0].timestamp) }}</div>

        <div class="space-y-2">
          <!-- Job group card -->
          <div
            v-for="group in dateGroup.jobs"
            :key="group.key"
            class="overflow-hidden rounded-lg border border-gray-200 border-l-4 bg-white"
            :class="rowBorderClass(group.level)"
          >
            <!-- Job header (only for multi-request jobs, e.g. paginated keyword scans) -->
            <div
              v-if="group.entries.length > 1"
              class="flex items-center gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-2.5"
            >
              <span class="h-2 w-2 shrink-0 rounded-full" :class="levelDotClass(group.level)"></span>
              <span class="shrink-0 rounded bg-white px-1.5 py-0.5 text-xs text-gray-600 ring-1 ring-gray-200">
                {{ jobTypeLabel(group.jobType) }}
              </span>
              <span class="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{{ group.title }}</span>
              <span v-if="group.jobId !== null" class="shrink-0 font-mono text-xs text-gray-400">#{{ group.jobId }}</span>
              <span class="shrink-0 text-xs text-gray-400">{{ group.entries.length }} requests</span>
              <span class="shrink-0 text-xs text-gray-400">{{ durationLabel(group.totalDurationMs) }} total</span>
              <span class="shrink-0 font-mono text-xs text-gray-500">{{ formatTime(group.timestamp) }}</span>
            </div>

            <!-- Request entries -->
            <div
              v-for="entry in group.entries"
              :key="entry.log.id"
              :class="group.entries.length > 1 ? 'border-t border-gray-100 first:border-t-0' : ''"
            >
              <!-- Row header -->
              <div
                class="flex cursor-pointer items-center gap-3 hover:bg-gray-50"
                :class="group.entries.length > 1 ? 'py-2 pl-10 pr-4' : 'px-4 py-2.5'"
                @click="toggleExpand(entry.log.id)"
              >
                <!-- Expand chevron -->
                <button
                  class="shrink-0 text-gray-400 transition-transform"
                  :class="isExpanded(entry.log.id) ? 'rotate-90' : ''"
                >
                  <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <!-- HTTP method badge -->
                <span class="inline-flex shrink-0 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-xs font-medium text-blue-700">
                  {{ entry.log.httpMethod ?? 'GET' }}
                </span>

                <!-- Single-request job: full context inline -->
                <template v-if="group.entries.length === 1">
                  <span class="shrink-0 font-mono text-xs text-gray-500">{{ formatTime(entry.log.timestamp) }}</span>
                  <span
                    class="inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="levelBadgeClass(entry.log.level)"
                  >
                    {{ entry.log.level }}
                  </span>
                  <span class="shrink-0 rounded bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600">
                    {{ jobTypeLabel(entry.log.jobType) }}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-sm text-gray-900">
                    {{ group.title }}<span v-if="entry.summaryText" class="text-gray-500"> · {{ entry.summaryText }}</span>
                  </span>
                </template>

                <!-- Multi-request job: page badge + per-page result -->
                <template v-else>
                  <span
                    v-if="pageLabel(entry.log)"
                    class="shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                  >
                    {{ pageLabel(entry.log) }}
                  </span>
                  <span
                    v-if="entry.log.level !== 'info'"
                    class="inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="levelBadgeClass(entry.log.level)"
                  >
                    {{ entry.log.level }}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-sm text-gray-700">
                    {{ entry.summaryText ?? entry.log.jobDetail }}
                  </span>
                </template>

                <!-- HTTP status -->
                <span class="shrink-0 font-mono text-xs" :class="statusClass(entry.log.responseStatus)">
                  {{ entry.log.responseStatus ?? '---' }}
                </span>

                <!-- Duration -->
                <span class="w-14 shrink-0 text-right text-xs text-gray-400">
                  {{ durationLabel(entry.log.durationMs) }}
                </span>
              </div>

              <!-- Expanded details -->
              <div
                v-if="isExpanded(entry.log.id)"
                class="border-t border-gray-100 bg-gray-50 py-3 pr-4 text-xs"
                :class="group.entries.length > 1 ? 'pl-10' : 'pl-4'"
              >
                <div class="space-y-3">
                  <!-- Error (always shown) -->
                  <div v-if="entry.log.error">
                    <span class="font-medium text-red-600">Error</span>
                    <p class="mt-0.5 whitespace-pre-wrap break-words font-mono text-red-700">{{ entry.log.error }}</p>
                  </div>

                  <!-- Result summary (folded-in per-page diagnostic, always shown) -->
                  <div v-if="entry.summary">
                    <span class="font-medium text-gray-500">Result</span>
                    <p class="mt-0.5 text-gray-700">{{ entry.summary.jobDetail }}</p>
                  </div>

                  <!-- Field grid (always shown) -->
                  <div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                    <div class="min-w-0">
                      <div class="text-gray-400">Time</div>
                      <div class="truncate font-mono text-gray-700">{{ formatFullTimestamp(entry.log.timestamp) }}</div>
                    </div>
                    <div class="min-w-0">
                      <div class="text-gray-400">Level</div>
                      <div class="text-gray-700">{{ entry.log.level }}</div>
                    </div>
                    <div class="min-w-0">
                      <div class="text-gray-400">Job type</div>
                      <div class="text-gray-700">{{ jobTypeLabel(entry.log.jobType) }}</div>
                    </div>
                    <div v-if="entry.log.jobId !== null" class="min-w-0">
                      <div class="text-gray-400">Job ID</div>
                      <div class="font-mono text-gray-700">#{{ entry.log.jobId }}</div>
                    </div>
                    <div v-if="entry.log.pageNumber !== undefined && entry.log.pageNumber !== null" class="min-w-0">
                      <div class="text-gray-400">Page</div>
                      <div class="font-mono text-gray-700">{{ entry.log.pageNumber }}</div>
                    </div>
                    <div class="min-w-0">
                      <div class="text-gray-400">Status</div>
                      <div class="font-mono" :class="statusClass(entry.log.responseStatus)">{{ entry.log.responseStatus ?? '—' }}</div>
                    </div>
                    <div class="min-w-0">
                      <div class="text-gray-400">Duration</div>
                      <div class="font-mono text-gray-700">{{ durationLabel(entry.log.durationMs) }}</div>
                    </div>
                  </div>

                  <!-- Advanced details (behind toggle) -->
                  <template v-if="advancedMode">
                    <!-- Request URL -->
                    <div>
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-medium text-gray-500">Request URL</span>
                        <button
                          class="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50"
                          @click.stop="copyToClipboard(entry.log.requestUrl, `url-${entry.log.id}`)"
                        >
                          {{ copiedKey === `url-${entry.log.id}` ? 'Copied' : 'Copy' }}
                        </button>
                      </div>
                      <p class="mt-0.5 break-all font-mono text-gray-700">
                        <span class="font-semibold">{{ entry.log.httpMethod ?? 'GET' }}</span>
                        {{ getParsedUrl(entry.log.id).baseUrl }}
                      </p>
                    </div>

                    <!-- Query parameters table -->
                    <div v-if="getParsedUrl(entry.log.id).params.length > 0">
                      <span class="font-medium text-gray-500">Parameters</span>
                      <div class="mt-1 overflow-hidden rounded border border-gray-200 bg-white">
                        <div
                          v-for="param in getParsedUrl(entry.log.id).params"
                          :key="param.key"
                          class="flex border-b border-gray-100 last:border-b-0"
                        >
                          <span class="w-20 shrink-0 border-r border-gray-100 px-2 py-1 font-mono font-medium text-gray-600">
                            {{ param.key }}
                          </span>
                          <span class="min-w-0 flex-1 break-all px-2 py-1 font-mono text-gray-700">
                            {{ param.value }}
                          </span>
                        </div>
                      </div>
                    </div>

                    <!-- Response preview -->
                    <div v-if="entry.log.responsePreview">
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-medium text-gray-500">
                          Response preview
                          <span class="text-gray-400">&middot; {{ entry.log.responsePreview.length }} chars</span>
                        </span>
                        <button
                          class="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50"
                          @click.stop="copyToClipboard(entry.log.responsePreview, `body-${entry.log.id}`)"
                        >
                          {{ copiedKey === `body-${entry.log.id}` ? 'Copied' : 'Copy' }}
                        </button>
                      </div>
                      <pre class="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-gray-200 bg-white p-2 font-mono text-[11px] leading-relaxed text-gray-600">{{ entry.log.responsePreview }}</pre>
                    </div>
                  </template>

                  <!-- Hint for simple mode -->
                  <p v-if="!advancedMode" class="text-gray-400 italic">
                    Switch to Advanced for the request URL, parameters, and full response body.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
