<script setup lang="ts">
import { computed } from 'vue';
import {
  AC_APPEARED_SENTINEL,
  AC_DISAPPEARED_SENTINEL,
  type RankChange,
} from '@/popup/composables/usePopupState';
import ExtensionIcon from './ExtensionIcon.vue';

const props = withDefaults(defineProps<{
  rankChange: RankChange;
  linkToProject?: boolean;
  showDate?: boolean;
}>(), {
  linkToProject: true,
  showDate: true,
});

function formatPosition(rc: RankChange, position: number | null): string {
  if (rc.type === 'autocomplete') {
    return position === null ? '—' : `#${position}`;
  }
  return position === null ? '30+' : `#${position}`;
}

const formattedDateTime = computed((): string => {
  const rc = props.rankChange;
  if (rc.scannedAt) {
    const d = rc.scannedAt instanceof Date ? rc.scannedAt : new Date(rc.scannedAt);
    if (!isNaN(d.getTime())) {
      const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (!props.showDate) return timeStr;
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${dateStr}, ${timeStr}`;
    }
  }
  if (!props.showDate) return '';
  const d = new Date(rc.date + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
});

function isNew(rc: RankChange): boolean {
  if (rc.type === 'autocomplete') return rc.change === AC_APPEARED_SENTINEL;
  return rc.change !== null && rc.change > 30;
}

function isOut(rc: RankChange): boolean {
  if (rc.type === 'autocomplete') return rc.change === AC_DISAPPEARED_SENTINEL;
  return rc.change !== null && rc.change < -30;
}
</script>

<template>
  <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
    <ExtensionIcon :icon-url="rankChange.iconUrl" :name="rankChange.extensionName" size="sm" />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5">
        <router-link
          v-if="linkToProject && rankChange.projectId"
          :to="{ name: 'project', params: { id: String(rankChange.projectId) } }"
          class="text-sm font-medium text-gray-900 truncate hover:text-blue-600 hover:underline"
        >{{ rankChange.extensionName }}</router-link>
        <span v-else class="text-sm font-medium text-gray-900 truncate">{{ rankChange.extensionName }}</span>
      </div>
      <div class="flex items-center gap-1.5 text-xs text-gray-500">
        <span
          v-if="rankChange.type === 'autocomplete'"
          class="inline-flex items-center rounded px-1 py-px text-[10px] font-semibold bg-indigo-100 text-indigo-700 shrink-0"
          title="Autocomplete"
        >AC</span>
        <span class="truncate">"{{ rankChange.keyword }}"</span>
        <template v-if="formattedDateTime">
          <span class="text-gray-300">&middot;</span>
          <span class="shrink-0">{{ formattedDateTime }}</span>
        </template>
      </div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <span class="text-xs text-gray-400 tabular-nums">{{ formatPosition(rankChange, rankChange.previousPosition) }}</span>
      <svg class="h-3 w-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
      </svg>
      <span class="text-xs font-semibold tabular-nums" :class="{
        'text-green-700': rankChange.change !== null && rankChange.change > 0,
        'text-red-700': rankChange.change !== null && rankChange.change < 0,
        'text-gray-600': rankChange.currentPosition === null,
      }">{{ formatPosition(rankChange, rankChange.currentPosition) }}</span>
      <span
        v-if="rankChange.change !== null && rankChange.change > 0"
        class="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700"
      >
        <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 2L10 8H2L6 2Z" />
        </svg>
        {{ isNew(rankChange) ? 'New' : '+' + rankChange.change }}
      </span>
      <span
        v-else-if="rankChange.change !== null && rankChange.change < 0"
        class="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700"
      >
        <svg class="w-3 h-3 mr-0.5" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 10L2 4H10L6 10Z" />
        </svg>
        {{ isOut(rankChange) ? 'Out' : Math.abs(rankChange.change) }}
      </span>
    </div>
  </div>
</template>
