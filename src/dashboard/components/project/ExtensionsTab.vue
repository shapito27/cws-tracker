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
                <span
                  v-if="ext.id === project.ownExtensionId"
                  class="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
                >
                  Own
                </span>
                <div>
                  <p class="text-sm font-medium text-gray-900">
                    {{ ext.name || ext.id }}
                  </p>
                  <p v-if="ext.name" class="text-xs text-gray-400 font-mono">{{ ext.id }}</p>
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
              {{ snapshots.get(ext.id)?.userCount ?? '-' }}
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
