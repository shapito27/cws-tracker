<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Project, Extension, RankSnapshot } from '@/shared/types';
import { useKeywords } from '../../composables/useKeywords';
import { useExtensions } from '../../composables/useExtensions';
import { db } from '@/shared/db/database';
import ExtensionIcon from '../ExtensionIcon.vue';

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  updated: [];
}>();

const { keywords, loadKeywords, addKeyword, removeKeyword } = useKeywords();
const { getExtensionsByProject } = useExtensions();

const extensions = ref<Extension[]>([]);
const latestRanks = ref<Map<string, RankSnapshot>>(new Map());
const loading = ref(true);
const newKeyword = ref('');
const addError = ref<string | null>(null);
const confirmRemoveId = ref<number | null>(null);

async function loadData(): Promise<void> {
  loading.value = true;
  await loadKeywords(props.project.id!);
  extensions.value = await getExtensionsByProject(props.project.id!);

  // Load latest rank data for each keyword-extension pair
  const ranks = new Map<string, RankSnapshot>();
  for (const kw of keywords.value) {
    if (kw.id === undefined) continue;
    const latest = await db.getLatestRankForKeyword(kw.id);
    for (const snap of latest) {
      ranks.set(`${kw.id}-${snap.extensionId}`, snap);
    }
  }
  latestRanks.value = ranks;
  loading.value = false;
}

onMounted(loadData);

async function handleAdd(): Promise<void> {
  addError.value = null;
  try {
    await addKeyword(props.project.id!, newKeyword.value);
    newKeyword.value = '';
    emit('updated');
    await loadData();
  } catch (e) {
    addError.value = e instanceof Error ? e.message : String(e);
  }
}

async function handleRemove(keywordId: number): Promise<void> {
  await removeKeyword(keywordId, props.project.id!);
  confirmRemoveId.value = null;
  emit('updated');
  await loadData();
}

function getPosition(keywordId: number, extensionId: string): string {
  const snap = latestRanks.value.get(`${keywordId}-${extensionId}`);
  if (!snap) return '-';
  return snap.position === null ? '30+' : String(snap.position);
}

function getPositionClass(keywordId: number, extensionId: string): string {
  const snap = latestRanks.value.get(`${keywordId}-${extensionId}`);
  if (!snap) return 'text-gray-400';
  if (snap.position === null) return 'text-gray-400';
  if (snap.position <= 3) return 'text-green-600 font-semibold';
  if (snap.position <= 10) return 'text-blue-600';
  return 'text-gray-700';
}
</script>

<template>
  <div>
    <!-- Add keyword form -->
    <div class="mb-4 flex items-start gap-3">
      <div class="flex-1">
        <div class="flex gap-2">
          <input
            v-model="newKeyword"
            type="text"
            placeholder="Enter a keyword to track..."
            class="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            @keydown.enter.prevent="handleAdd"
          />
          <button
            class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            :disabled="!newKeyword.trim()"
            @click="handleAdd"
          >
            Add
          </button>
        </div>
        <p v-if="addError" class="mt-1 text-sm text-red-600">{{ addError }}</p>
      </div>
    </div>

    <div v-if="loading" class="text-center py-8">
      <p class="text-sm text-gray-500">Loading keywords...</p>
    </div>

    <div v-else-if="keywords.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
      <p class="text-sm text-gray-500">Add keywords to track search rankings.</p>
    </div>

    <!-- Keywords table -->
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Keyword</th>
            <th
              v-for="ext in extensions"
              :key="ext.id"
              class="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              <div class="flex items-center justify-center gap-1">
                <ExtensionIcon :icon-url="ext.iconUrl" :name="ext.name || ext.id" size="xs" />
                <span :class="ext.id === project.ownExtensionId ? 'text-blue-600' : ''">
                  {{ ext.name || ext.id.slice(0, 8) + '...' }}
                </span>
              </div>
            </th>
            <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white">
          <tr v-for="kw in keywords" :key="kw.id" class="hover:bg-gray-50">
            <td class="px-4 py-3 text-sm font-medium text-gray-900">{{ kw.text }}</td>
            <td
              v-for="ext in extensions"
              :key="ext.id"
              class="px-4 py-3 text-center text-sm"
              :class="getPositionClass(kw.id!, ext.id)"
            >
              {{ getPosition(kw.id!, ext.id) }}
            </td>
            <td class="px-4 py-3 text-right">
              <button
                class="text-sm text-red-600 hover:text-red-800"
                @click="confirmRemoveId = kw.id!"
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
      v-if="confirmRemoveId !== null"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="confirmRemoveId = null"
    >
      <div class="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h3 class="text-base font-semibold text-gray-900 mb-2">Remove Keyword</h3>
        <p class="text-sm text-gray-600 mb-4">
          Are you sure you want to stop tracking this keyword?
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
  </div>
</template>
