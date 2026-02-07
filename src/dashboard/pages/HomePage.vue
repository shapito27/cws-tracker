<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProjects } from '../composables/useProjects';
import { useServiceWorker } from '../composables/useServiceWorker';
import ExtensionsOverviewTable from '../components/tables/ExtensionsOverviewTable.vue';

const router = useRouter();
const { projects, loading, loadProjects, createProject } = useProjects();
const { scanStatus, requestRefresh } = useServiceWorker();

const showCreateModal = ref(false);
const createName = ref('');
const createExtensionInput = ref('');
const createError = ref<string | null>(null);
const creating = ref(false);

onMounted(loadProjects);

async function handleCreate(): Promise<void> {
  createError.value = null;
  creating.value = true;
  try {
    const project = await createProject(
      createName.value,
      createExtensionInput.value
    );
    showCreateModal.value = false;
    createName.value = '';
    createExtensionInput.value = '';
    router.push({ name: 'project', params: { id: String(project.id) } });
  } catch (e) {
    createError.value = e instanceof Error ? e.message : String(e);
  } finally {
    creating.value = false;
  }
}

function openCreateModal(): void {
  createError.value = null;
  createName.value = '';
  createExtensionInput.value = '';
  showCreateModal.value = true;
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
        <div class="mt-2 space-y-1">
          <p class="text-xs text-gray-500">
            {{ 1 + project.competitorIds.length }} extension{{ project.competitorIds.length > 0 ? 's' : '' }}
          </p>
          <p class="text-xs text-gray-500">
            {{ project.keywordIds.length }} keyword{{ project.keywordIds.length !== 1 ? 's' : '' }}
          </p>
        </div>
        <p class="mt-3 text-xs text-gray-400">
          Created {{ project.createdAt.toLocaleDateString() }}
        </p>
      </router-link>
    </div>

    <!-- Extensions Overview Table -->
    <ExtensionsOverviewTable v-if="projects.length > 0" class="mt-8" />

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

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Project Name
              </label>
              <input
                v-model="createName"
                type="text"
                placeholder="My Extension (optional, defaults to extension ID)"
                class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
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
