<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Project, Extension, EventRecord, EventType } from '@/shared/types';
import { db } from '@/shared/db/database';
import { useExtensions } from '../../composables/useExtensions';
import { ALL_EVENT_TYPES, EVENT_TYPE_LABELS, getEventTypeBadgeClass } from '@/shared/utils/event-colors';
import DiffView from '../comparison/DiffView.vue';
import PermissionsDiff from '../comparison/PermissionsDiff.vue';
import ExtensionIcon from '../ExtensionIcon.vue';

const props = defineProps<{
  project: Project;
}>();

const { getExtensionsByProject } = useExtensions();

const events = ref<EventRecord[]>([]);
const extensions = ref<Extension[]>([]);
const loading = ref(true);
const filterType = ref<EventType | 'all'>('all');
const filterExtension = ref<string>('all');
const expandedEventIds = ref<Set<number>>(new Set());

onMounted(async () => {
  extensions.value = await getExtensionsByProject(props.project.id!);

  const allExtIds = [props.project.ownExtensionId, ...props.project.competitorIds];
  const allEvents: EventRecord[] = [];
  for (const extId of allExtIds) {
    const extEvents = await db.getEvents(extId, '2000-01-01', '2099-12-31');
    allEvents.push(...extEvents);
  }
  // Sort by detectedAt descending (falls back to date string for legacy records)
  allEvents.sort((a, b) => {
    const aTime = a.detectedAt?.getTime() ?? 0;
    const bTime = b.detectedAt?.getTime() ?? 0;
    if (aTime || bTime) return bTime - aTime;
    return b.date.localeCompare(a.date);
  });
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

function getExtensionIconUrl(extensionId: string): string | null {
  const ext = extensions.value.find((e) => e.id === extensionId);
  return ext?.iconUrl ?? null;
}

function isCompetitor(extensionId: string): boolean {
  return extensionId !== props.project.ownExtensionId;
}

function toggleExpand(eventId: number): void {
  const newSet = new Set(expandedEventIds.value);
  if (newSet.has(eventId)) {
    newSet.delete(eventId);
  } else {
    newSet.add(eventId);
  }
  expandedEventIds.value = newSet;
}

function isExpanded(eventId: number): boolean {
  return expandedEventIds.value.has(eventId);
}

function hasDiffData(event: EventRecord): boolean {
  return event.oldValue !== null && event.newValue !== null;
}

function isPermissionEvent(event: EventRecord): boolean {
  return event.type === 'permission_change';
}

function isTextDiffEvent(event: EventRecord): boolean {
  return (
    event.type === 'title_change' ||
    event.type === 'description_change'
  );
}

function parsePermissions(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Override badge class for rank_change events to differentiate improvements (green) from drops (red).
 * Falls back to the default event type badge class for non-rank events.
 */
function getSmartBadgeClass(event: EventRecord): string {
  if (event.type === 'rank_change') {
    const note = event.note.toLowerCase();
    if (note.includes('improved') || note.includes('entered')) {
      return 'bg-green-100 text-green-800';
    }
    if (note.includes('dropped') || note.includes('left')) {
      return 'bg-red-100 text-red-800';
    }
  }
  return getEventTypeBadgeClass(event.type);
}

function formatEventDateTime(event: EventRecord): string {
  if (!event.detectedAt) return event.date;
  const d = event.detectedAt;
  if (isNaN(d.getTime())) return event.date;
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
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
        class="rounded-lg border border-gray-200 bg-white"
      >
        <!-- Event header (clickable if has diff data) -->
        <div
          class="flex items-start justify-between gap-4 px-4 py-3"
          :class="hasDiffData(event) ? 'cursor-pointer hover:bg-gray-50' : ''"
          @click="hasDiffData(event) && event.id !== undefined ? toggleExpand(event.id) : undefined"
        >
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <p class="text-sm text-gray-900">{{ event.note }}</p>
              <button
                v-if="hasDiffData(event)"
                class="shrink-0 text-gray-400 hover:text-gray-600 transition-transform"
                :class="event.id !== undefined && isExpanded(event.id) ? 'rotate-90' : ''"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <span
                class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                :class="getSmartBadgeClass(event)"
              >
                {{ EVENT_TYPE_LABELS[event.type] }}
              </span>
              <span class="inline-flex items-center gap-1 text-xs text-gray-500">
                <ExtensionIcon :icon-url="getExtensionIconUrl(event.extensionId)" :name="getExtensionName(event.extensionId)" size="xs" />
                <router-link
                  v-if="isCompetitor(event.extensionId) && project.id !== undefined"
                  :to="{ name: 'competitorExtension', params: { id: String(project.id), extId: event.extensionId } }"
                  class="hover:text-blue-600 hover:underline"
                  @click.stop
                >{{ getExtensionName(event.extensionId) }}</router-link>
                <template v-else>{{ getExtensionName(event.extensionId) }}</template>
              </span>
            </div>
          </div>
          <span class="shrink-0 text-xs text-gray-500">{{ formatEventDateTime(event) }}</span>
        </div>

        <!-- Expanded diff detail -->
        <div
          v-if="event.id !== undefined && isExpanded(event.id) && hasDiffData(event)"
          class="border-t border-gray-200 px-4 py-3"
        >
          <!-- Permission diff -->
          <PermissionsDiff
            v-if="isPermissionEvent(event)"
            :old-permissions="parsePermissions(event.oldValue)"
            :new-permissions="parsePermissions(event.newValue)"
          />

          <!-- Text diff for title/description changes -->
          <DiffView
            v-else-if="isTextDiffEvent(event)"
            :old-text="event.oldValue ?? ''"
            :new-text="event.newValue ?? ''"
          />

          <!-- Generic old/new display for other event types -->
          <div v-else class="space-y-2">
            <div class="rounded-md bg-red-50 px-3 py-2">
              <p class="text-xs font-medium text-red-700 mb-0.5">Previous</p>
              <p class="text-sm text-red-900">{{ event.oldValue }}</p>
            </div>
            <div class="rounded-md bg-green-50 px-3 py-2">
              <p class="text-xs font-medium text-green-700 mb-0.5">Current</p>
              <p class="text-sm text-green-900">{{ event.newValue }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
