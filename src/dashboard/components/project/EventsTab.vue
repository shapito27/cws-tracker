<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Project, Extension, EventRecord, EventType } from '@/shared/types';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import { ALL_EVENT_TYPES, EVENT_TYPE_LABELS, getEventTypeBadgeClass } from '@/shared/utils/event-colors';

const props = defineProps<{
  project: Project;
}>();

const { getExtensionsByProject } = useExtensions();

const events = ref<EventRecord[]>([]);
const extensions = ref<Extension[]>([]);
const loading = ref(true);
const filterType = ref<EventType | 'all'>('all');
const filterExtension = ref<string>('all');

onMounted(async () => {
  extensions.value = await getExtensionsByProject(props.project.id!);

  const allExtIds = [props.project.ownExtensionId, ...props.project.competitorIds];
  const allEvents: EventRecord[] = [];
  for (const extId of allExtIds) {
    const extEvents = await db.getEvents(extId, '2000-01-01', '2099-12-31');
    allEvents.push(...extEvents);
  }
  // Sort by date descending
  allEvents.sort((a, b) => b.date.localeCompare(a.date));
  events.value = allEvents;
  loading.value = false;
});

const filteredEvents = computed(() => {
  return events.value.filter((e) => {
    if (filterType.value !== 'all' && e.type !== filterType.value) return false;
    if (filterExtension.value !== 'all' && e.extensionId !== filterExtension.value) return false;
    return true;
  });
});

function getExtensionName(extensionId: string): string {
  const ext = extensions.value.find((e) => e.id === extensionId);
  return ext?.name || extensionId.slice(0, 12) + '...';
}

</script>

<template>
  <div>
    <!-- Filters -->
    <div class="mb-4 flex items-center gap-4">
      <div>
        <select
          v-model="filterType"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All event types</option>
          <option v-for="type in ALL_EVENT_TYPES" :key="type" :value="type">
            {{ EVENT_TYPE_LABELS[type] }}
          </option>
        </select>
      </div>
      <div>
        <select
          v-model="filterExtension"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All extensions</option>
          <option v-for="ext in extensions" :key="ext.id" :value="ext.id">
            {{ ext.name || ext.id.slice(0, 12) + '...' }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="text-center py-8">
      <p class="text-sm text-gray-500">Loading events...</p>
    </div>

    <div v-else-if="events.length === 0" class="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
      <p class="text-sm text-gray-500">No changes detected yet. Events appear after your second scan.</p>
    </div>

    <div v-else-if="filteredEvents.length === 0" class="rounded-lg border border-gray-200 bg-white p-8 text-center">
      <p class="text-sm text-gray-500">No events match the selected filters.</p>
    </div>

    <!-- Event timeline -->
    <div v-else class="space-y-3">
      <div
        v-for="event in filteredEvents"
        :key="event.id"
        class="rounded-lg border border-gray-200 bg-white px-4 py-3"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <p class="text-sm text-gray-900">{{ event.note }}</p>
            <div class="mt-1.5 flex items-center gap-2">
              <span
                class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                :class="getEventTypeBadgeClass(event.type)"
              >
                {{ EVENT_TYPE_LABELS[event.type] }}
              </span>
              <span class="text-xs text-gray-500">
                {{ getExtensionName(event.extensionId) }}
              </span>
            </div>
          </div>
          <span class="shrink-0 text-xs text-gray-500">{{ event.date }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
