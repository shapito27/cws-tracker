<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TranslationAuditReport, TrickBreakdown } from '../../composables/useTranslationAudit';
import { sortBreakdown } from '../../composables/useTranslationAudit';
import { localeName } from '@/shared/utils/locales';
import type { TrickKey, TrickSeverity } from '@/shared/utils/translation-checks';

const props = defineProps<{
  report: TranslationAuditReport;
}>();

const emit = defineEmits<{
  export: [];
}>();

const expanded = ref<Set<TrickKey>>(new Set());

function toggle(key: TrickKey): void {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
}

const rows = computed<TrickBreakdown[]>(() => sortBreakdown(props.report.breakdown));
const detectedCount = computed(() => rows.value.filter((r) => r.findings.length > 0).length);
/** Locales that were actually analysed (those the extension ships). */
const auditedCount = computed(() => props.report.localeCount - props.report.fallbackLocaleCount);

const scoreClasses = computed(() => {
  switch (props.report.label) {
    case 'high':
      return { ring: 'border-red-300 bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-800' };
    case 'medium':
      return { ring: 'border-amber-300 bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800' };
    case 'low':
      return { ring: 'border-yellow-200 bg-yellow-50', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-800' };
    default:
      return { ring: 'border-green-300 bg-green-50', text: 'text-green-700', badge: 'bg-green-100 text-green-800' };
  }
});

const labelText = computed(() => {
  switch (props.report.label) {
    case 'high':
      return 'High risk';
    case 'medium':
      return 'Medium risk';
    case 'low':
      return 'Low risk';
    default:
      return 'Clean';
  }
});

function severityClass(severity: TrickSeverity): string {
  switch (severity) {
    case 'high':
      return 'bg-red-100 text-red-800';
    case 'medium':
      return 'bg-amber-100 text-amber-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function severityText(severity: TrickSeverity): string {
  return severity === 'high' ? 'High' : severity === 'medium' ? 'Medium' : 'Low';
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
</script>

<template>
  <div class="space-y-4" data-testid="audit-report">
    <!-- Summary card -->
    <div class="flex flex-wrap items-center gap-4 rounded-lg border p-4" :class="scoreClasses.ring">
      <div class="flex items-baseline gap-2">
        <span class="text-4xl font-bold tabular-nums" :class="scoreClasses.text" data-testid="audit-score">
          {{ report.score }}
        </span>
        <span class="text-sm text-gray-500">/ 100</span>
      </div>
      <span class="rounded-full px-2.5 py-0.5 text-xs font-semibold" :class="scoreClasses.badge">
        {{ labelText }}
      </span>
      <div class="min-w-0 flex-1 text-sm text-gray-700">
        <p class="text-gray-600">
          Audited {{ formatDate(report.date) }} ·
          {{ report.localeCount }} locale{{ report.localeCount === 1 ? '' : 's' }} ·
          <span :class="report.flaggedLocaleCount > 0 ? 'text-red-700' : 'text-green-700'">
            {{ report.flaggedLocaleCount }} flagged
          </span>
          <span v-if="report.fallbackLocaleCount > 0" class="text-gray-500">
            · {{ report.fallbackLocaleCount }} not localized (store shows the default listing)
          </span>
          <span v-if="!report.baselineLocale" class="text-gray-400">
            · compared against the default-locale listing (no “en” locale captured)
          </span>
        </p>
      </div>
      <button
        class="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        @click="emit('export')"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Export JSON
      </button>
    </div>

    <!-- Breakdown by trick -->
    <div class="rounded-lg border border-gray-200 bg-white">
      <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 class="text-sm font-semibold text-gray-800">Breakdown by manipulation type</h3>
        <span class="text-xs text-gray-500">{{ detectedCount }} of {{ rows.length }} detected</span>
      </div>
      <ul class="divide-y divide-gray-100">
        <li v-for="row in rows" :key="row.key" :data-testid="`trick-${row.key}`">
          <button
            class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-white"
            :disabled="row.findings.length === 0"
            @click="toggle(row.key)"
          >
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              :class="row.findings.length > 0 ? 'bg-red-500' : 'bg-gray-200'"
            />
            <span class="min-w-0 flex-1 text-sm" :class="row.findings.length > 0 ? 'font-medium text-gray-900' : 'text-gray-500'">
              {{ row.label }}
            </span>
            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide" :class="severityClass(row.severity)">
              {{ severityText(row.severity) }}
            </span>
            <span class="w-28 shrink-0 text-right text-xs tabular-nums text-gray-500">
              <template v-if="row.findings.length > 0">
                {{ row.findings.length }} of {{ auditedCount }} locale{{ auditedCount === 1 ? '' : 's' }}
              </template>
              <template v-else>not detected</template>
            </span>
            <svg
              v-if="row.findings.length > 0"
              class="h-4 w-4 shrink-0 text-gray-400 transition-transform"
              :class="expanded.has(row.key) ? 'rotate-180' : ''"
              fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
            <span v-else class="h-4 w-4 shrink-0" />
          </button>

          <div v-if="expanded.has(row.key) && row.findings.length > 0" class="border-t border-gray-100 bg-gray-50 px-4 py-3">
            <ul class="space-y-2">
              <li v-for="f in row.findings" :key="f.locale" class="text-sm">
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <span class="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-gray-700 ring-1 ring-gray-200">{{ f.locale }}</span>
                  <span class="text-gray-500">{{ localeName(f.locale) }}</span>
                  <span v-if="f.detail" class="text-gray-800">{{ f.detail }}</span>
                </div>
                <pre
                  v-if="f.excerpt"
                  class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-red-200 bg-red-50 px-2 py-1.5 font-mono text-xs text-red-900"
                >{{ f.excerpt }}</pre>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
