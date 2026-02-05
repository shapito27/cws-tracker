<script setup lang="ts">
import { computed } from 'vue';
import { getPermissionWarning } from '@/shared/utils/permissions';

const props = defineProps<{
  oldPermissions: string[];
  newPermissions: string[];
}>();

const oldSet = computed(() => new Set(props.oldPermissions));
const newSet = computed(() => new Set(props.newPermissions));

const added = computed(() =>
  [...newSet.value].filter(p => !oldSet.value.has(p)).sort()
);

const removed = computed(() =>
  [...oldSet.value].filter(p => !newSet.value.has(p)).sort()
);

const unchanged = computed(() =>
  [...oldSet.value].filter(p => newSet.value.has(p)).sort()
);

const hasChanges = computed(() =>
  added.value.length > 0 || removed.value.length > 0
);
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <div v-if="!hasChanges" class="text-sm text-gray-500">
      No permission changes.
    </div>

    <div v-else class="space-y-3">
      <!-- Added permissions -->
      <div v-if="added.length > 0">
        <p class="text-xs font-medium text-green-700 mb-1">Added</p>
        <div class="space-y-1">
          <div
            v-for="perm in added"
            :key="'added-' + perm"
            class="flex items-start gap-2 rounded-md bg-green-50 px-3 py-1.5"
          >
            <span class="text-green-600 font-mono text-xs shrink-0">+</span>
            <div>
              <span class="text-sm text-green-800 font-medium">{{ perm }}</span>
              <p
                v-if="getPermissionWarning(perm)"
                class="text-xs text-green-600 mt-0.5"
              >
                {{ getPermissionWarning(perm) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Removed permissions -->
      <div v-if="removed.length > 0">
        <p class="text-xs font-medium text-red-700 mb-1">Removed</p>
        <div class="space-y-1">
          <div
            v-for="perm in removed"
            :key="'removed-' + perm"
            class="flex items-start gap-2 rounded-md bg-red-50 px-3 py-1.5"
          >
            <span class="text-red-600 font-mono text-xs shrink-0">-</span>
            <div>
              <span class="text-sm text-red-800 font-medium">{{ perm }}</span>
              <p
                v-if="getPermissionWarning(perm)"
                class="text-xs text-red-600 mt-0.5"
              >
                {{ getPermissionWarning(perm) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Unchanged permissions -->
      <div v-if="unchanged.length > 0">
        <p class="text-xs font-medium text-gray-500 mb-1">Unchanged</p>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="perm in unchanged"
            :key="'unchanged-' + perm"
            class="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
          >
            {{ perm }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
