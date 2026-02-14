<script setup lang="ts">
import { ref, watch } from 'vue';
import type { AutocompleteKeywordSuggestion, Keyword } from '@/shared/types';
import { loadKeywordSuggestions } from '../../composables/useAutocomplete';

const props = defineProps<{
  keywords: Keyword[];
  projectId: number;
}>();

const emit = defineEmits<{
  addKeyword: [text: string];
}>();

const selectedKeywordId = ref<number | null>(null);
const suggestions = ref<AutocompleteKeywordSuggestion[]>([]);
const loading = ref(false);

/** Deduplicated list of unique suggestion texts from all dates. */
const uniqueSuggestions = ref<string[]>([]);

/** Tracks which keywords are already tracked (lowercase for comparison). */
const trackedKeywordsLower = new Set<string>();

watch(
  () => props.keywords,
  (kws) => {
    trackedKeywordsLower.clear();
    for (const kw of kws) {
      trackedKeywordsLower.add(kw.text.toLowerCase());
    }
    // Auto-select first keyword if none selected
    if (selectedKeywordId.value === null && kws.length > 0 && kws[0].id !== undefined) {
      selectedKeywordId.value = kws[0].id;
    }
  },
  { immediate: true }
);

watch(selectedKeywordId, async (kwId) => {
  if (kwId === null) {
    suggestions.value = [];
    uniqueSuggestions.value = [];
    return;
  }

  loading.value = true;
  try {
    const data = await loadKeywordSuggestions(kwId, 30);
    suggestions.value = data;

    // Collect unique suggestions across all dates, most recent first
    const seen = new Set<string>();
    const unique: string[] = [];
    // Sort by date descending so the most recent appear first
    const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date));
    for (const entry of sorted) {
      for (const text of entry.suggestions) {
        const lower = text.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          unique.push(text);
        }
      }
    }
    uniqueSuggestions.value = unique;
  } catch (e) {
    console.error('Failed to load keyword suggestions:', e);
    suggestions.value = [];
    uniqueSuggestions.value = [];
  } finally {
    loading.value = false;
  }
});

function isAlreadyTracked(text: string): boolean {
  return trackedKeywordsLower.has(text.toLowerCase());
}

function handleAdd(text: string): void {
  emit('addKeyword', text);
  // Optimistically add to tracked set
  trackedKeywordsLower.add(text.toLowerCase());
}

function getSelectedKeywordText(): string {
  const kw = props.keywords.find((k) => k.id === selectedKeywordId.value);
  return kw?.text ?? '';
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold text-gray-900">Keyword Suggestions</h4>
      <select
        v-if="keywords.length > 0"
        v-model="selectedKeywordId"
        class="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option
          v-for="kw in keywords"
          :key="kw.id"
          :value="kw.id"
        >
          {{ kw.text }}
        </option>
      </select>
    </div>

    <p class="mb-3 text-xs text-gray-500">
      Text suggestions CWS returns when users type "{{ getSelectedKeywordText() }}". Use these for keyword discovery.
    </p>

    <div v-if="loading" class="py-4 text-center">
      <p class="text-xs text-gray-400">Loading suggestions...</p>
    </div>

    <div v-else-if="uniqueSuggestions.length === 0" class="py-4 text-center">
      <p class="text-xs text-gray-400">
        No suggestions yet. Run an autocomplete scan to discover keyword ideas.
      </p>
    </div>

    <div v-else class="space-y-1.5">
      <div
        v-for="text in uniqueSuggestions"
        :key="text"
        class="flex items-center justify-between rounded-md px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        <span class="text-gray-700">{{ text }}</span>
        <button
          v-if="!isAlreadyTracked(text)"
          class="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
          @click="handleAdd(text)"
        >
          + Track
        </button>
        <span
          v-else
          class="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-400"
        >
          Tracked
        </span>
      </div>
    </div>

    <!-- Timeline view: show by date -->
    <details v-if="suggestions.length > 1" class="mt-4">
      <summary class="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
        View by date
      </summary>
      <div class="mt-2 space-y-3">
        <div
          v-for="entry in [...suggestions].sort((a, b) => b.date.localeCompare(a.date))"
          :key="entry.date"
          class="border-l-2 border-gray-200 pl-3"
        >
          <p class="text-xs font-medium text-gray-500">{{ entry.date }}</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <span
              v-for="s in entry.suggestions"
              :key="s"
              class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            >
              {{ s }}
            </span>
          </div>
        </div>
      </div>
    </details>
  </div>
</template>
