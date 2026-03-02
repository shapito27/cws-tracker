<script setup lang="ts">
import { ref, computed, onMounted, watch, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Project } from '@/shared/types';
import { db } from '@/shared/db/database';
import { useServiceWorker } from '../composables/useServiceWorker';

const OverviewTab = defineAsyncComponent(() => import('../components/project/OverviewTab.vue'));
const RankingsTab = defineAsyncComponent(() => import('../components/project/RankingsTab.vue'));
const ExtensionsTab = defineAsyncComponent(() => import('../components/project/ExtensionsTab.vue'));
const KeywordsTab = defineAsyncComponent(() => import('../components/project/KeywordsTab.vue'));
const EventsTab = defineAsyncComponent(() => import('../components/project/EventsTab.vue'));
const ListingCompare = defineAsyncComponent(() => import('../components/comparison/ListingCompare.vue'));
const KeywordAnalysis = defineAsyncComponent(() => import('../components/tables/KeywordAnalysis.vue'));

const route = useRoute();
const router = useRouter();
const { scanStatus } = useServiceWorker();

const project = ref<Project | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
const activeTab = ref<'overview' | 'rankings' | 'extensions' | 'keywords' | 'events' | 'compare' | 'analysis'>('overview');

const tabs = [
  {
    id: 'overview' as const,
    label: 'Overview',
    icon: ['M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z'],
  },
  {
    id: 'rankings' as const,
    label: 'Rankings',
    icon: ['M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941'],
  },
  {
    id: 'extensions' as const,
    label: 'Competitors',
    icon: ['M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z'],
  },
  {
    id: 'keywords' as const,
    label: 'Keywords',
    icon: ['M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z', 'M6 6h.008v.008H6V6Z'],
  },
  {
    id: 'events' as const,
    label: 'Events',
    icon: ['M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0'],
  },
  {
    id: 'compare' as const,
    label: 'Compare',
    icon: ['M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5'],
  },
  {
    id: 'analysis' as const,
    label: 'Analysis',
    icon: ['M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9', 'M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z'],
  },
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

// Reload project when a scan completes (e.g., to pick up auto-filled name)
watch(
  () => scanStatus.value.isRunning,
  (isRunning, wasRunning) => {
    if (wasRunning && !isRunning) {
      loadProject();
    }
  }
);
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
          class="flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors"
          :class="activeTab === tab.id
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'"
          @click="activeTab = tab.id"
        >
          <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path v-for="(d, i) in tab.icon" :key="i" stroke-linecap="round" stroke-linejoin="round" :d="d" />
          </svg>
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
    <ListingCompare
      v-else-if="activeTab === 'compare'"
      :project="project"
    />
    <KeywordAnalysis
      v-else-if="activeTab === 'analysis'"
      :project="project"
    />
  </div>
</template>
