<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Project, Extension } from '@/shared/types';
import { AUDIT_LOCALE_OPTIONS, localeName } from '@/shared/utils/locales';
import { useExtensions } from '../../composables/useExtensions';
import { useServiceWorker } from '../../composables/useServiceWorker';
import { useSettings } from '../../composables/useSettings';
import { useProxyStatus } from '../../composables/useProxyStatus';
import {
  loadAuditDates,
  loadAuditReport,
  loadAuditSummaries,
  downloadAuditReport,
  estimateAuditDurationMs,
  formatDuration,
  type AuditSummary,
  type TranslationAuditReport,
} from '../../composables/useTranslationAudit';
import AuditReport from '../translation/AuditReport.vue';
import LocaleComparisonTable from '../translation/LocaleComparisonTable.vue';
import ExtensionIcon from '../ExtensionIcon.vue';
import ExtensionNameLink from '../ExtensionNameLink.vue';

const props = defineProps<{ project: Project }>();

const { getExtensionsByProject } = useExtensions();
const { scanStatus, requestTranslationAudit } = useServiceWorker();
const { settings, loadSettings } = useSettings();
const { scanBlocked } = useProxyStatus();

const extensions = ref<Extension[]>([]);
const selectedExtIds = ref<string[]>([]);
const selectedLocales = ref<string[]>([]);
const summaries = ref<AuditSummary[]>([]);
const activeExtId = ref<string>('');
const activeDate = ref<string>('');
const dates = ref<string[]>([]);
const report = ref<TranslationAuditReport | null>(null);
const loading = ref(true);
const starting = ref(false);
const startNote = ref<string | null>(null);
const showSetup = ref(true);

/** Locale options: the known list plus any custom codes saved in Settings. */
const localeOptions = computed(() => {
  const known = new Set(AUDIT_LOCALE_OPTIONS.map((o) => o.code));
  const extras = settings.translationLocales.filter((c) => !known.has(c)).map((code) => ({ code, name: code }));
  return [...AUDIT_LOCALE_OPTIONS, ...extras];
});

const jobCount = computed(() => selectedExtIds.value.length * selectedLocales.value.length);
const estimate = computed(() => formatDuration(estimateAuditDurationMs(jobCount.value, settings.queueDelayMs)));
const canStart = computed(() => jobCount.value > 0 && !scanBlocked.value && !starting.value);

const activeSummary = computed(() => summaries.value.find((s) => s.extensionId === activeExtId.value) ?? null);
const activeExtension = computed(() => extensions.value.find((e) => e.id === activeExtId.value) ?? null);
const anyAudited = computed(() => summaries.value.some((s) => s.date !== null));

function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
function toggleExtension(id: string): void {
  selectedExtIds.value = toggleIn(selectedExtIds.value, id);
}
function toggleLocale(code: string): void {
  selectedLocales.value = toggleIn(selectedLocales.value, code);
}
function selectAllExtensions(): void {
  selectedExtIds.value = extensions.value.map((e) => e.id);
}
function selectDefaultLocales(): void {
  selectedLocales.value = [...settings.translationLocales];
}
function clearLocales(): void {
  selectedLocales.value = [];
}

function isOwn(extensionId: string): boolean {
  return extensionId === props.project.ownExtensionId;
}

function onCardKeydown(event: KeyboardEvent, extensionId: string): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    viewExtension(extensionId);
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function scoreBadgeClass(label: AuditSummary['label']): string {
  switch (label) {
    case 'high':
      return 'bg-red-100 text-red-800';
    case 'medium':
      return 'bg-amber-100 text-amber-800';
    case 'low':
      return 'bg-yellow-100 text-yellow-800';
    case 'clean':
      return 'bg-green-100 text-green-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

async function loadSummaries(): Promise<void> {
  summaries.value = await loadAuditSummaries(extensions.value);
}

async function loadReport(): Promise<void> {
  if (!activeExtId.value) {
    report.value = null;
    return;
  }
  dates.value = await loadAuditDates(activeExtId.value);
  if (!activeDate.value || !dates.value.includes(activeDate.value)) {
    activeDate.value = dates.value[0] ?? '';
  }
  report.value = activeDate.value ? await loadAuditReport(activeExtId.value, activeDate.value) : null;
}

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    extensions.value = await getExtensionsByProject(props.project.id!);
    await loadSummaries();
    if (!activeExtId.value) {
      const firstAudited = summaries.value.find((s) => s.date !== null);
      activeExtId.value = firstAudited?.extensionId ?? props.project.ownExtensionId ?? extensions.value[0]?.id ?? '';
    }
    await loadReport();
  } finally {
    loading.value = false;
  }
}

function viewExtension(extensionId: string): void {
  activeExtId.value = extensionId;
  activeDate.value = '';
}

async function onStart(): Promise<void> {
  if (!canStart.value) return;
  starting.value = true;
  startNote.value = null;
  try {
    const jobs = await requestTranslationAudit(selectedExtIds.value, selectedLocales.value);
    startNote.value = jobs > 0
      ? `Translation audit queued: ${jobs} locale page${jobs === 1 ? '' : 's'}, ${estimate.value}. Results appear here as each locale is fetched.`
      : 'The audit could not be started. Check that a proxy is configured in Settings.';
    if (jobs > 0) showSetup.value = false;
  } finally {
    starting.value = false;
  }
}

function onExport(): void {
  if (report.value) downloadAuditReport(report.value);
}

onMounted(async () => {
  await loadSettings();
  selectedLocales.value = [...settings.translationLocales];
  await loadAll();
  selectedExtIds.value = extensions.value.map((e) => e.id);
});

watch(activeExtId, loadReport);
watch(activeDate, loadReport);

// Refresh stored results whenever the queue makes progress or finishes: each
// translation_audit job writes a locale as it lands, so the report fills in
// while the audit is still running.
watch(
  () => [scanStatus.value.isRunning, scanStatus.value.completed] as const,
  async ([isRunning], [wasRunning]) => {
    if (loading.value) return;
    await loadSummaries();
    await loadReport();
    if (wasRunning && !isRunning) startNote.value = null;
  }
);
</script>

<template>
  <div class="space-y-6" data-testid="translations-tab">
    <!-- Intro + setup -->
    <div class="rounded-lg border border-gray-200 bg-white">
      <button
        class="flex w-full items-center justify-between px-4 py-3 text-left"
        @click="showSetup = !showSetup"
      >
        <div>
          <h3 class="text-sm font-semibold text-gray-800">Run translation audit</h3>
          <p class="text-xs text-gray-500">
            Fetches each selected extension's listing in each selected locale and checks for
            translation manipulation: swapped names, keyword stuffing, competitor names, padded
            descriptions, untranslated copy.
          </p>
        </div>
        <svg
          class="h-4 w-4 shrink-0 text-gray-400 transition-transform"
          :class="showSetup ? 'rotate-180' : ''"
          fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      <div v-if="showSetup" class="space-y-4 border-t border-gray-200 px-4 py-4">
        <!-- Extensions -->
        <div>
          <div class="mb-2 flex items-center justify-between">
            <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Extensions</p>
            <button class="text-xs text-blue-600 hover:underline" @click="selectAllExtensions">Select all</button>
          </div>
          <p v-if="extensions.length === 0" class="text-sm text-gray-500">No extensions tracked in this project yet.</p>
          <div v-else class="flex flex-wrap gap-2">
            <label
              v-for="ext in extensions"
              :key="ext.id"
              class="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              :class="selectedExtIds.includes(ext.id) ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-gray-300 text-gray-700 hover:bg-gray-50'"
            >
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-gray-300 text-blue-600"
                :checked="selectedExtIds.includes(ext.id)"
                :data-testid="`ext-toggle-${ext.id}`"
                @change="toggleExtension(ext.id)"
              />
              <ExtensionIcon :icon-url="ext.iconUrl" :name="ext.name || ext.id" size="xs" />
              <span class="truncate">{{ ext.name || ext.id }}</span>
              <span v-if="isOwn(ext.id)" class="text-xs text-gray-400">(own)</span>
            </label>
          </div>
        </div>

        <!-- Locales -->
        <div>
          <div class="mb-2 flex items-center justify-between">
            <p class="text-xs font-medium uppercase tracking-wide text-gray-500">
              Locales <span class="font-normal normal-case text-gray-400">({{ selectedLocales.length }} selected)</span>
            </p>
            <div class="flex gap-3">
              <button class="text-xs text-blue-600 hover:underline" @click="selectDefaultLocales">Use defaults</button>
              <button class="text-xs text-gray-500 hover:underline" @click="clearLocales">Clear</button>
            </div>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="opt in localeOptions"
              :key="opt.code"
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs"
              :class="selectedLocales.includes(opt.code) ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'"
              :data-testid="`locale-toggle-${opt.code}`"
              @click="toggleLocale(opt.code)"
            >
              <span class="font-mono">{{ opt.code }}</span>
              <span class="ml-1 text-gray-500">{{ opt.name }}</span>
            </button>
          </div>
          <p class="mt-1.5 text-xs text-gray-400">
            Default selection comes from Settings → Translation audit. Include <span class="font-mono">en</span>
            to compare against the English listing; otherwise the default-locale listing is used as the baseline.
          </p>
        </div>

        <!-- Cost + start -->
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <p class="text-sm text-gray-600" data-testid="audit-estimate">
            <span class="font-medium text-gray-900">{{ jobCount }}</span> request{{ jobCount === 1 ? '' : 's' }}
            <span v-if="jobCount > 0">· {{ estimate }} at the current queue delay</span>
          </p>
          <button
            class="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            :disabled="!canStart"
            :title="scanBlocked ? 'A proxy is required to scan — configure one in Settings.' : jobCount === 0 ? 'Select at least one extension and one locale' : ''"
            data-testid="run-audit"
            @click="onStart"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
            {{ starting ? 'Starting…' : 'Run translation audit' }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="startNote" class="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700" data-testid="start-note">
      {{ startNote }}
    </p>

    <!-- Progress -->
    <div
      v-if="scanStatus.isRunning"
      class="flex items-center gap-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800"
      data-testid="audit-progress"
    >
      <span class="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
      <span>
        Queue running: {{ scanStatus.completed }} of {{ scanStatus.total }} jobs done
        <span v-if="scanStatus.currentJob" class="text-blue-600">· {{ scanStatus.currentJob }}</span>
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="py-12 text-center text-sm text-gray-500">Loading translation audits…</div>

    <!-- Empty -->
    <div
      v-else-if="!anyAudited"
      class="rounded-lg border border-dashed border-gray-300 py-12 text-center"
      data-testid="audit-empty"
    >
      <p class="text-sm font-medium text-gray-700">No translation audits yet</p>
      <p class="mt-1 text-sm text-gray-500">
        Select extensions and locales above and run an audit. Results are stored per extension and date.
      </p>
    </div>

    <template v-else>
      <!-- Per-extension summary cards -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="audit-summaries">
        <div
          v-for="s in summaries"
          :key="s.extensionId"
          role="button"
          tabindex="0"
          class="cursor-pointer rounded-lg border bg-white p-4 text-left transition-colors hover:border-blue-300"
          :class="s.extensionId === activeExtId ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'"
          :data-testid="`summary-${s.extensionId}`"
          @click="viewExtension(s.extensionId)"
          @keydown="onCardKeydown($event, s.extensionId)"
        >
          <div class="flex items-start justify-between gap-2">
            <ExtensionNameLink
              :extension-id="s.extensionId"
              :name="s.extensionName"
              :icon-url="s.iconUrl"
              :project-id="project.id"
              :own="isOwn(s.extensionId)"
            />
            <span
              class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
              :class="scoreBadgeClass(s.label)"
            >
              {{ s.score === null ? 'not audited' : s.score }}
            </span>
          </div>
          <p class="mt-1 text-xs text-gray-500">
            <template v-if="s.date">
              {{ formatDate(s.date) }} · {{ s.localeCount }} locale{{ s.localeCount === 1 ? '' : 's' }} ·
              <span :class="s.flaggedLocaleCount > 0 ? 'text-red-700' : 'text-green-700'">{{ s.flaggedLocaleCount }} flagged</span>
            </template>
            <template v-else>Run an audit to check this extension.</template>
          </p>
        </div>
      </div>

      <!-- Active report -->
      <div v-if="activeSummary" class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <ExtensionNameLink
            :extension-id="activeSummary.extensionId"
            :name="activeSummary.extensionName"
            :icon-url="activeExtension?.iconUrl ?? activeSummary.iconUrl"
            :project-id="project.id"
            :own="isOwn(activeSummary.extensionId)"
            size="md"
            data-testid="active-extension"
          />
          <div v-if="dates.length > 1" class="flex items-center gap-2 text-sm">
            <label class="text-gray-500">Audit date</label>
            <select
              v-model="activeDate"
              class="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
              data-testid="audit-date"
            >
              <option v-for="d in dates" :key="d" :value="d">{{ formatDate(d) }}</option>
            </select>
          </div>
        </div>

        <template v-if="report">
          <AuditReport :report="report" @export="onExport" />
          <LocaleComparisonTable :locales="report.locales" :baseline-locale="report.baselineLocale" />
          <p class="text-xs text-gray-400">
            Heuristic checks over listing text - not a semantic judgement. Review the flagged excerpts before
            drawing conclusions; a fluent, unrelated translation cannot be told apart from an honest one
            without reading it. Locales: {{ report.locales.map((l) => localeName(l.locale)).join(', ') }}.
          </p>
        </template>
        <div v-else class="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500">
          This extension has not been audited yet.
        </div>
      </div>
    </template>
  </div>
</template>
