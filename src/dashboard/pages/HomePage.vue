<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useProjects } from '../composables/useProjects';
import { useServiceWorker } from '../composables/useServiceWorker';
import { useSettings } from '../composables/useSettings';
import { db } from '@/shared/db/database';
import type { Project, Extension } from '@/shared/types';
import ExtensionsOverviewTable from '../components/tables/ExtensionsOverviewTable.vue';
import RecentRankChanges from '../components/RecentRankChanges.vue';

const router = useRouter();
const { projects, loading, loadProjects, createProject } = useProjects();
const { scanStatus, requestRefresh } = useServiceWorker();
const { settings, loadSettings } = useSettings();

const showCreateModal = ref(false);
const createExtensionInput = ref('');
const createError = ref<string | null>(null);
const creating = ref(false);
const extensionMap = ref<Map<string, Extension>>(new Map());

async function loadExtensions(): Promise<void> {
  try {
    const allExts = await db.extensions.toArray();
    const map = new Map<string, Extension>();
    for (const ext of allExts) {
      map.set(ext.id, ext);
    }
    extensionMap.value = map;
  } catch {
    // Non-critical: cards will show "Never" for scan time
  }
}

onMounted(async () => {
  await loadProjects();
  await Promise.all([loadExtensions(), loadSettings()]);
});

// Reload extension data when a scan completes so lastScannedAt updates
watch(
  () => scanStatus.value.isRunning,
  (isRunning, wasRunning) => {
    if (wasRunning && !isRunning) {
      loadExtensions();
      loadProjects();
    }
  }
);

// ---------------------------------------------------------------------------
// Per-project last scan time
// ---------------------------------------------------------------------------

function getProjectLastScan(project: Project): Date | null {
  const extIds = [project.ownExtensionId, ...project.competitorIds];
  let latest: Date | null = null;
  for (const id of extIds) {
    const ext = extensionMap.value.get(id);
    if (ext?.lastScannedAt) {
      if (!latest || ext.lastScannedAt.getTime() > latest.getTime()) {
        latest = ext.lastScannedAt;
      }
    }
  }
  return latest;
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return 'Never';
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 0) return 'Just now';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMs / 3_600_000);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getLastScanLabel(project: Project): string {
  const lastScan = getProjectLastScan(project);
  return formatRelativeTime(lastScan);
}

function getLastScanTooltip(project: Project): string {
  const lastScan = getProjectLastScan(project);
  if (!lastScan) return '';
  return lastScan.toLocaleString();
}

function lastScanDotClass(project: Project): string {
  const lastScan = getProjectLastScan(project);
  if (!lastScan) return 'bg-gray-300';
  const hoursAgo = (Date.now() - lastScan.getTime()) / 3_600_000;
  if (hoursAgo < 24) return 'bg-green-400';
  if (hoursAgo < 48) return 'bg-yellow-400';
  return 'bg-orange-400';
}

// ---------------------------------------------------------------------------
// Global next scan time
// ---------------------------------------------------------------------------

const nextScanLabel = computed<string>(() => {
  if (scanStatus.value.isRunning) return 'Scanning...';
  if (!settings.dailyScanEnabled) return 'Auto-scan off';

  const [hours, minutes] = settings.dailyScanTime.split(':').map(Number);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const nextDate = new Date();
  nextDate.setHours(hours, minutes, 0, 0);

  // If already scanned today or the scheduled time has passed, next is tomorrow
  if (settings.lastDailyScanDate === todayStr || nextDate.getTime() <= now.getTime()) {
    nextDate.setDate(nextDate.getDate() + 1);
  }

  return formatNextScanDate(nextDate);
});

function formatNextScanDate(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today ~${timeStr}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ~${timeStr}`;
  return `${date.toLocaleDateString()} ~${timeStr}`;
}

// ---------------------------------------------------------------------------
// Create project + utilities
// ---------------------------------------------------------------------------

async function handleCreate(): Promise<void> {
  createError.value = null;
  creating.value = true;
  try {
    const project = await createProject(createExtensionInput.value);
    showCreateModal.value = false;
    createExtensionInput.value = '';
    router.push({ name: 'project', params: { id: String(project.id) } });
    // Trigger scan so listing name populates the project name
    requestRefresh(project.id);
  } catch (e) {
    createError.value = e instanceof Error ? e.message : String(e);
  } finally {
    creating.value = false;
  }
}

function openCreateModal(): void {
  createError.value = null;
  createExtensionInput.value = '';
  showCreateModal.value = true;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-gray-900">Projects</h2>
      <div class="flex items-center gap-3">
        <button
          v-if="projects.length > 0"
          class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          :disabled="scanStatus.isRunning"
          @click="requestRefresh()"
        >
          {{ scanStatus.isRunning ? 'Scanning...' : 'Refresh All' }}
        </button>
        <button
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          @click="openCreateModal"
        >
          Create Project
        </button>
      </div>
    </div>

    <!-- Scan status banner -->
    <div
      v-if="scanStatus.isRunning"
      class="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3"
    >
      <div class="flex items-center gap-3">
        <svg class="h-5 w-5 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <div>
          <p class="text-sm font-medium text-blue-800">
            Scan in progress: {{ scanStatus.currentJob }}
          </p>
          <p class="text-xs text-blue-600">
            {{ scanStatus.completed }}/{{ scanStatus.total }} jobs completed
            <span v-if="scanStatus.nextProcessingAt">
              &middot; Next job at {{ formatTime(scanStatus.nextProcessingAt) }}
            </span>
          </p>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="text-center py-12">
      <p class="text-sm text-gray-500">Loading projects...</p>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="projects.length === 0"
      class="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center"
    >
      <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
      </svg>
      <h3 class="mt-2 text-sm font-semibold text-gray-900">No projects</h3>
      <p class="mt-1 text-sm text-gray-500">
        Create your first project to start tracking Chrome Web Store extensions.
      </p>
      <button
        class="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        @click="openCreateModal"
      >
        Create Project
      </button>
    </div>

    <!-- Project cards grid -->
    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <router-link
        v-for="project in projects"
        :key="project.id"
        :to="{ name: 'project', params: { id: String(project.id) } }"
        class="group rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-blue-300"
      >
        <h3 class="text-base font-semibold text-gray-900 group-hover:text-blue-700">
          {{ project.name }}
        </h3>
        <p class="mt-2 text-xs text-gray-500">
          {{ 1 + project.competitorIds.length }} extension{{ project.competitorIds.length > 0 ? 's' : '' }}
          &middot;
          {{ project.keywordIds.length > 0
            ? `${project.keywordIds.length} keyword${project.keywordIds.length !== 1 ? 's' : ''}`
            : 'No keywords yet' }}
        </p>
        <div class="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
          <div class="flex items-center gap-1.5" :title="getLastScanTooltip(project)">
            <span class="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0" :class="lastScanDotClass(project)" />
            <span class="text-xs text-gray-500">Last scan: {{ getLastScanLabel(project) }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span
              class="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
              :class="scanStatus.isRunning ? 'bg-blue-400 animate-pulse' : 'bg-gray-300'"
            />
            <span class="text-xs text-gray-400">Next: {{ nextScanLabel }}</span>
          </div>
        </div>
      </router-link>
    </div>

    <!-- Recent Rank Changes -->
    <RecentRankChanges v-if="!loading && projects.length > 0" class="mt-8" />

    <!-- Extensions Overview Table -->
    <ExtensionsOverviewTable v-if="!loading && projects.length > 0" class="mt-8" />

    <!-- Create Project Modal -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showCreateModal = false"
    >
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Create Project</h3>

        <form @submit.prevent="handleCreate">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Extension URL or ID
              </label>
              <input
                v-model="createExtensionInput"
                type="text"
                placeholder="chrome.google.com/webstore/detail/.../ID or 32-char ID"
                class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
              <p class="mt-1 text-xs text-gray-400">
                Paste a Chrome Web Store URL or extension ID
              </p>
            </div>

          </div>

          <div v-if="createError" class="mt-3 rounded-md bg-red-50 p-3">
            <p class="text-sm text-red-700">{{ createError }}</p>
          </div>

          <div class="mt-6 flex justify-end gap-3">
            <button
              type="button"
              class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              @click="showCreateModal = false"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="creating || !createExtensionInput.trim()"
            >
              {{ creating ? 'Creating...' : 'Create' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
