<script setup lang="ts">
import { computed } from 'vue';
import type { EventRecord } from '@/shared/types';
import { EVENT_TYPE_LABELS, getEventTypeBadgeClass } from '@/shared/utils/event-colors';
import ExtensionIcon from './ExtensionIcon.vue';

const props = defineProps<{
  event: EventRecord;
  extensionName: string;
  extensionIconUrl: string | null;
  isOwn: boolean;
  formattedTime: string;
  /** Project id - enables competitor name → competitor overview link. Optional for contexts without a project. */
  projectId?: number | null;
}>();

const linkTarget = computed(() => {
  if (props.isOwn || props.projectId == null) return null;
  return {
    name: 'competitorExtension',
    params: { id: String(props.projectId), extId: props.event.extensionId },
  };
});
</script>

<template>
  <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
    <ExtensionIcon
      :icon-url="extensionIconUrl"
      :name="extensionName"
      size="sm"
    />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5">
        <router-link
          v-if="linkTarget"
          :to="linkTarget"
          class="text-sm font-medium text-gray-900 truncate hover:text-blue-600 hover:underline"
        >{{ extensionName }}</router-link>
        <span v-else class="text-sm font-medium text-gray-900 truncate">
          {{ extensionName }}
        </span>
        <span
          v-if="isOwn"
          class="inline-flex rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 shrink-0"
        >You</span>
      </div>
      <div class="flex items-center gap-1.5 text-xs text-gray-500">
        <span class="truncate">{{ event.note }}</span>
        <template v-if="formattedTime">
          <span class="text-gray-300">&middot;</span>
          <span class="shrink-0">{{ formattedTime }}</span>
        </template>
      </div>
    </div>
    <span
      class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium shrink-0"
      :class="getEventTypeBadgeClass(event.type)"
    >
      {{ EVENT_TYPE_LABELS[event.type] }}
    </span>
  </div>
</template>
