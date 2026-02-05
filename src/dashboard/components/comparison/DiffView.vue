<script setup lang="ts">
import { computed } from 'vue';
import { computeTextDiff, type DiffSegment } from '@/shared/utils/diff';

const props = defineProps<{
  oldText: string;
  newText: string;
}>();

const segments = computed<DiffSegment[]>(() =>
  computeTextDiff(props.oldText, props.newText)
);

const hasChanges = computed(() =>
  segments.value.some(s => s.type !== 'equal')
);
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <div v-if="!hasChanges" class="text-sm text-gray-500">
      No differences found.
    </div>
    <div v-else class="text-sm leading-relaxed whitespace-pre-wrap break-words">
      <template v-for="(seg, i) in segments" :key="i">
        <span
          v-if="seg.type === 'equal'"
          class="text-gray-900"
        >{{ seg.text }}</span>
        <span
          v-else-if="seg.type === 'added'"
          class="bg-green-100 text-green-800"
        >{{ seg.text }}</span>
        <span
          v-else
          class="bg-red-100 text-red-800 line-through"
        >{{ seg.text }}</span>
      </template>
    </div>
  </div>
</template>
