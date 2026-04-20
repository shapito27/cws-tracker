<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Project, Extension, ListingSnapshot } from '@/shared/types';
import { useProjects } from '../../composables/useProjects';
import { useExtensions } from '../../composables/useExtensions';

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  updated: [];
}>();

const { addCompetitor, removeCompetitor } = useProjects();
const { getExtensionsByProject, getLatestSnapshot } = useExtensions();

const extensions = ref<Extension[]>([]);
const snapshots = ref<Map<string, ListingSnapshot>>(new Map());
const loading = ref(true);
const showAddModal = ref(false);
const addInput = ref('');
const addError = ref<string | null>(null);
const adding = ref(false);
const confirmRemoveId = ref<string | null>(null);

async function loadData(): Promise<void> {
  loading.value = true;
  extensions.value = await getExtensionsByProject(props.project.id!);
  const newSnapshots = new Map<string, ListingSnapshot>();
  for (const ext of extensions.value) {
    const snapshot = await getLatestSnapshot(ext.id);
    if (snapshot) {
      newSnapshots.set(ext.id, snapshot);
    }
  }
  snapshots.value = newSnapshots;
  loading.value = false;
}

onMounted(loadData);

async function handleAdd(): Promise<void> {
  addError.value = null;
  adding.value = true;
  try {
    await addCompetitor(props.project.id!, addInput.value);
    showAddModal.value = false;
    addInput.value = '';
    emit('updated');
    await loadData();
  } catch (e) {
    addError.value = e instanceof Error ? e.message : String(e);
  } finally {
    adding.value = false;
  }
}

async function handleRemove(extensionId: string): Promise<void> {
  await removeCompetitor(props.project.id!, extensionId);
  confirmRemoveId.value = null;
  emit('updated');
  await loadData();
}

function getRiskColor(score: number): string {
  if (score >= 50) return 'text-red-600';
  if (score >= 20) return 'text-yellow-600';
  return 'text-green-600';
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-base font-semibold text-gray-900">Tracked Extensions</h3>
      <button
        class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        @click="showAddModal = true; addError = null; addInput = ''"
      >
        Add Competitor
      </button>
    </div>

    <div v-if="loading" class="text-center py-8">
      <p class="text-sm text-gray-500">Loading extensions...</p>
    </div>

    <div v-else-if="extensions.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
      <p class="text-sm text-gray-500">Add competitor extensions to start tracking.</p>
    </div>

    <!-- Extensions table -->
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Extension</th>
            <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Rating</th>
            <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Users</th>
            <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Version</th>
            <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Updated</th>
            <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Risk Score</th>
            <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white">
          <tr v-for="ext in extensions" :key="ext.id" class="hover:bg-gray-50">
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <img
                  v-if="ext.iconUrl"
                  :src="ext.iconUrl"
                  :alt="ext.name || ext.id"
                  class="h-8 w-8 rounded flex-shrink-0"
                />
                <div
                  v-else
                  class="h-8 w-8 rounded bg-gray-200 flex items-center justify-center flex-shrink-0"
                >
                  <span class="text-xs text-gray-400">?</span>
                </div>
                <span
                  v-if="ext.id === project.ownExtensionId"
                  class="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
                >
                  Own
                </span>
                <div>
                  <div class="flex items-center gap-2">
                    <router-link
                      v-if="ext.id !== project.ownExtensionId && project.id !== undefined"
                      :to="{ name: 'competitorExtension', params: { id: String(project.id), extId: ext.id } }"
                      class="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {{ ext.name || ext.id }}
                    </router-link>
                    <a
                      v-else
                      :href="`https://chromewebstore.google.com/detail/-/${ext.id}`"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {{ ext.name || ext.id }}
                    </a>
                    <a
                      v-if="ext.id !== project.ownExtensionId"
                      :href="`https://chromewebstore.google.com/detail/-/${ext.id}`"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center text-gray-400 hover:text-gray-600"
                      title="Open in Chrome Web Store"
                      :aria-label="`Open ${ext.name || ext.id} in Chrome Web Store`"
                    >
                      <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" clip-rule="evenodd" />
                        <path fill-rule="evenodd" d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" clip-rule="evenodd" />
                      </svg>
                    </a>
                  </div>
                  <p v-if="ext.name" class="text-xs text-gray-400 font-mono" :title="ext.id">{{ ext.id.slice(0, 8) }}…</p>
                </div>
              </div>
            </td>
            <td class="px-4 py-3 text-right text-sm text-gray-700">
              <template v-if="snapshots.get(ext.id)">
                {{ snapshots.get(ext.id)!.rating?.toFixed(1) ?? '-' }}
              </template>
              <template v-else>-</template>
            </td>
            <td class="px-4 py-3 text-right text-sm text-gray-700">
              {{ snapshots.get(ext.id)?.userCountNumeric == null ? '-' : snapshots.get(ext.id)!.userCountNumeric >= 1000 ? snapshots.get(ext.id)!.userCount : snapshots.get(ext.id)!.userCountNumeric.toLocaleString() }}
            </td>
            <td class="px-4 py-3 text-right text-sm text-gray-700 font-mono">
              {{ snapshots.get(ext.id)?.version ?? '-' }}
            </td>
            <td class="px-4 py-3 text-right text-sm text-gray-700">
              {{ snapshots.get(ext.id)?.lastUpdated ?? '-' }}
            </td>
            <td class="px-4 py-3 text-right text-sm font-medium">
              <template v-if="snapshots.get(ext.id)">
                <span :class="getRiskColor(snapshots.get(ext.id)!.permissionRiskScore)">
                  {{ snapshots.get(ext.id)!.permissionRiskScore }}
                </span>
              </template>
              <template v-else>-</template>
            </td>
            <td class="px-4 py-3 text-right">
              <button
                v-if="ext.id !== project.ownExtensionId"
                class="text-sm text-red-600 hover:text-red-800"
                @click="confirmRemoveId = ext.id"
              >
                Remove
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Risk Score explanation (collapsed by default) -->
    <details v-if="extensions.length > 0" class="mt-3">
      <summary class="cursor-pointer select-none text-xs font-medium text-gray-500 hover:text-gray-700">
        How is Risk Score calculated?
      </summary>
      <div class="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <p class="mb-2">
          The <strong class="text-gray-900">Permission Risk Score</strong> (0–100) measures the potential danger of permissions
          requested by an extension. Higher scores indicate more sensitive data access.
        </p>
        <table class="w-full text-xs mb-3">
          <thead>
            <tr class="border-b border-gray-200">
              <th class="py-1 text-left font-medium text-gray-700">Permission</th>
              <th class="py-1 text-right font-medium text-gray-700">Weight</th>
              <th class="py-1 text-left pl-4 font-medium text-gray-700">Chrome Install Warning</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr>
              <td class="py-1 font-mono">&lt;all_urls&gt; / broad hosts</td>
              <td class="py-1 text-right text-red-600 font-semibold">30</td>
              <td class="py-1 pl-4">Read and change all your data on all websites</td>
            </tr>
            <tr>
              <td class="py-1 font-mono">history</td>
              <td class="py-1 text-right text-red-600 font-semibold">25</td>
              <td class="py-1 pl-4">Read your browsing history</td>
            </tr>
            <tr>
              <td class="py-1 font-mono">tabs</td>
              <td class="py-1 text-right text-red-600 font-semibold">20</td>
              <td class="py-1 pl-4">Read your browsing history</td>
            </tr>
            <tr>
              <td class="py-1 font-mono">bookmarks</td>
              <td class="py-1 text-right text-yellow-600 font-semibold">15</td>
              <td class="py-1 pl-4">Read and change your bookmarks</td>
            </tr>
            <tr>
              <td class="py-1 font-mono">webRequest</td>
              <td class="py-1 text-right text-yellow-600 font-semibold">15</td>
              <td class="py-1 pl-4">Observe and intercept network requests</td>
            </tr>
            <tr>
              <td class="py-1 font-mono">cookies</td>
              <td class="py-1 text-right text-yellow-600 font-semibold">15</td>
              <td class="py-1 pl-4">Read cookies for all sites</td>
            </tr>
            <tr>
              <td class="py-1 font-mono">activeTab</td>
              <td class="py-1 text-right text-green-600 font-semibold">5</td>
              <td class="py-1 pl-4">Access current tab on click</td>
            </tr>
            <tr>
              <td class="py-1 font-mono">Narrow host (single domain)</td>
              <td class="py-1 text-right text-green-600 font-semibold">5</td>
              <td class="py-1 pl-4">Read/change data on that site</td>
            </tr>
            <tr>
              <td class="py-1 font-mono">storage, alarms, notifications, etc.</td>
              <td class="py-1 text-right font-semibold">0</td>
              <td class="py-1 pl-4 text-gray-400">No warning</td>
            </tr>
          </tbody>
        </table>
        <p class="mb-1">
          <strong class="text-gray-700">Formula:</strong> Sum all permission weights, then clamp to 0–100.
        </p>
        <div class="flex gap-4 text-xs mt-2">
          <span><span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-1"></span> 0–19 Low</span>
          <span><span class="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-1"></span> 20–49 Medium</span>
          <span><span class="inline-block w-2 h-2 rounded-full bg-red-500 mr-1"></span> 50–100 High</span>
        </div>
      </div>
    </details>

    <!-- Confirm remove dialog -->
    <div
      v-if="confirmRemoveId"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="confirmRemoveId = null"
    >
      <div class="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h3 class="text-base font-semibold text-gray-900 mb-2">Remove Competitor</h3>
        <p class="text-sm text-gray-600 mb-4">
          Are you sure you want to remove this competitor from the project?
        </p>
        <div class="flex justify-end gap-3">
          <button
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            @click="confirmRemoveId = null"
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            @click="handleRemove(confirmRemoveId!)"
          >
            Remove
          </button>
        </div>
      </div>
    </div>

    <!-- Add competitor modal -->
    <div
      v-if="showAddModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showAddModal = false"
    >
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Add Competitor</h3>
        <form @submit.prevent="handleAdd">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Extension URL or ID
            </label>
            <input
              v-model="addInput"
              type="text"
              placeholder="Paste CWS URL or 32-char extension ID"
              class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>
          <div v-if="addError" class="mt-3 rounded-md bg-red-50 p-3">
            <p class="text-sm text-red-700">{{ addError }}</p>
          </div>
          <div class="mt-4 flex justify-end gap-3">
            <button
              type="button"
              class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              @click="showAddModal = false"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="adding || !addInput.trim()"
            >
              {{ adding ? 'Adding...' : 'Add' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
