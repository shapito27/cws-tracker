<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Project } from '@/shared/types';
import { db } from '@/shared/db/database';
import OverviewTab from '../components/project/OverviewTab.vue';
import RankingsTab from '../components/project/RankingsTab.vue';
import ExtensionsTab from '../components/project/ExtensionsTab.vue';
import KeywordsTab from '../components/project/KeywordsTab.vue';
import EventsTab from '../components/project/EventsTab.vue';

const route = useRoute();
const router = useRouter();

const project = ref<Project | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
const activeTab = ref<'overview' | 'rankings' | 'extensions' | 'keywords' | 'events'>('overview');

const tabs = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'rankings' as const, label: 'Rankings' },
  { id: 'extensions' as const, label: 'Extensions' },
  { id: 'keywords' as const, label: 'Keywords' },
  { id: 'events' as const, label: 'Events' },
];

const projectId = computed(() => Number(route.params.id));

async function loadProject(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const p = await db.getProject(projectId.value);
    if (!p) {
      router.replace({ name: 'home' });
      return;
    }
    project.value = p;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadProject);

watch(projectId, loadProject);
</script>

<template>
  <div v-if="loading" class="text-center py-12">
    <p class="text-sm text-gray-500">Loading project...</p>
  </div>

  <div v-else-if="loadError" class="rounded-lg bg-red-50 border border-red-200 p-6 text-center">
    <p class="text-sm text-red-700">Failed to load project: {{ loadError }}</p>
    <button
      class="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
      @click="loadProject"
    >
      Retry
    </button>
  </div>

  <div v-else-if="project">
    <!-- Header -->
    <div class="mb-6">
      <div class="flex items-center gap-2 mb-1">
        <router-link to="/" class="text-sm text-gray-500 hover:text-gray-700">Projects</router-link>
        <span class="text-sm text-gray-400">/</span>
      </div>
      <h2 class="text-2xl font-bold text-gray-900">{{ project.name }}</h2>
    </div>

    <!-- Tab navigation -->
    <div class="border-b border-gray-200 mb-6">
      <nav class="-mb-px flex gap-6">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors"
          :class="activeTab === tab.id
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <!-- Tab content -->
    <OverviewTab
      v-if="activeTab === 'overview'"
      :project="project"
    />
    <RankingsTab
      v-else-if="activeTab === 'rankings'"
      :project="project"
    />
    <ExtensionsTab
      v-else-if="activeTab === 'extensions'"
      :project="project"
      @updated="loadProject"
    />
    <KeywordsTab
      v-else-if="activeTab === 'keywords'"
      :project="project"
      @updated="loadProject"
    />
    <EventsTab
      v-else-if="activeTab === 'events'"
      :project="project"
    />
  </div>
</template>
