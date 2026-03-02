<script setup lang="ts">
import type { EventRecord } from '@/shared/types';
import { EVENT_TYPE_LABELS, getEventTypeBadgeClass } from '@/shared/utils/event-colors';
import ExtensionIcon from './ExtensionIcon.vue';

defineProps<{
  event: EventRecord;
  extensionName: string;
  extensionIconUrl: string | null;
  isOwn: boolean;
  formattedTime: string;
}>();
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
        <span class="text-sm font-medium text-gray-900 truncate">
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
