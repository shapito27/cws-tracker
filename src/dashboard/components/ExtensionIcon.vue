<script setup lang="ts">
const props = withDefaults(defineProps<{
  iconUrl: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md';
}>(), {
  size: 'sm',
});

const sizeClasses: Record<string, string> = {
  xs: 'h-4 w-4',
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
};

const textClasses: Record<string, string> = {
  xs: 'text-[8px]',
  sm: 'text-[10px]',
  md: 'text-xs',
};
</script>

<template>
  <img
    v-if="props.iconUrl"
    :src="props.iconUrl"
    :alt="props.name"
    class="rounded shrink-0"
    :class="sizeClasses[props.size!]"
  />
  <div
    v-else
    class="rounded bg-blue-100 flex items-center justify-center shrink-0 font-bold text-blue-600"
    :class="[sizeClasses[props.size!], textClasses[props.size!]]"
    role="img"
    :aria-label="props.name"
  >
    {{ props.name ? props.name.charAt(0).toUpperCase() : '?' }}
  </div>
</template>
