<script setup lang="ts">
/**
 * Icon + name + link for an extension, the same shape the Extensions tab uses:
 * a competitor links to its detail page inside the dashboard (plus a small
 * "open in Chrome Web Store" icon), the project's own extension links straight
 * to its store listing.
 */
import ExtensionIcon from './ExtensionIcon.vue';

const props = withDefaults(defineProps<{
  extensionId: string;
  name: string;
  iconUrl: string | null;
  /** Project the extension is viewed in; competitors link to its detail route. */
  projectId: number | undefined;
  /** True when this is the project's own extension. */
  own: boolean;
  size?: 'sm' | 'md';
}>(), {
  size: 'sm',
});

const storeUrl = `https://chromewebstore.google.com/detail/-/${props.extensionId}`;
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-2" data-testid="extension-name-link">
    <ExtensionIcon :icon-url="props.iconUrl" :name="props.name || props.extensionId" :size="props.size" />
    <span
      v-if="props.own"
      class="inline-flex shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
    >Own</span>
    <router-link
      v-if="!props.own && props.projectId !== undefined"
      :to="{ name: 'competitorExtension', params: { id: String(props.projectId), extId: props.extensionId } }"
      class="truncate font-medium text-blue-600 hover:text-blue-800 hover:underline"
      :class="props.size === 'md' ? 'text-base' : 'text-sm'"
      @click.stop
    >{{ props.name || props.extensionId }}</router-link>
    <a
      v-else
      :href="storeUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="truncate font-medium text-blue-600 hover:text-blue-800 hover:underline"
      :class="props.size === 'md' ? 'text-base' : 'text-sm'"
      @click.stop
    >{{ props.name || props.extensionId }}</a>
    <a
      v-if="!props.own"
      :href="storeUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex shrink-0 items-center text-gray-400 hover:text-gray-600"
      title="Open in Chrome Web Store"
      :aria-label="`Open ${props.name || props.extensionId} in Chrome Web Store`"
      @click.stop
    >
      <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" clip-rule="evenodd" />
        <path fill-rule="evenodd" d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" clip-rule="evenodd" />
      </svg>
    </a>
  </span>
</template>
