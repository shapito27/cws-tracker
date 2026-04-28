<script setup lang="ts">
import { computed } from 'vue';
import type { Extension, ListingSnapshot } from '@/shared/types';

const props = defineProps<{
  extension: Extension | null | undefined;
  snapshot: ListingSnapshot | undefined;
  extensionId: string;
  /** Pill label shown next to the title. Omit for no pill. */
  badge?: 'competitor' | null;
}>();

const cwsUrl = computed(() => `https://chromewebstore.google.com/detail/-/${props.extensionId}`);

const displayName = computed(() =>
  props.snapshot?.title || props.extension?.name || props.extensionId
);

const formattedLastUpdated = computed(() => {
  const raw = props.snapshot?.lastUpdated;
  if (!raw) return '';
  // Stored as YYYY-MM-DD; force local-tz parse to avoid UTC-shift off-by-one.
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
});
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-5 mb-6">
    <div class="flex items-start gap-4">
      <img
        v-if="extension?.iconUrl"
        :src="extension.iconUrl"
        :alt="displayName"
        class="h-14 w-14 rounded-lg flex-shrink-0"
      />
      <div
        v-else
        class="flex h-14 w-14 items-center justify-center rounded-lg bg-blue-100 text-lg font-bold text-blue-600 flex-shrink-0"
        role="img"
        :aria-label="displayName"
      >
        {{ displayName.charAt(0).toUpperCase() }}
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-3">
          <h3 class="text-lg font-semibold text-gray-900 truncate">
            {{ displayName }}
          </h3>
          <span
            v-if="badge === 'competitor'"
            class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 shrink-0"
          >Competitor</span>
          <a
            :href="cwsUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 flex-shrink-0"
            aria-label="Open in Chrome Web Store (opens in new tab)"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" clip-rule="evenodd" />
              <path fill-rule="evenodd" d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" clip-rule="evenodd" />
            </svg>
            Chrome Web Store
          </a>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-2">
          <span v-if="snapshot?.rating != null" class="inline-flex items-center gap-1 text-sm text-gray-600">
            <svg class="h-4 w-4 text-yellow-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clip-rule="evenodd" />
            </svg>
            {{ snapshot.rating.toFixed(1) }}
            <span v-if="snapshot.ratingCount" class="text-gray-400">({{ snapshot.ratingCount.toLocaleString() }})</span>
          </span>

          <span v-if="snapshot?.rating != null && snapshot?.version" class="text-gray-300" aria-hidden="true">|</span>

          <span v-if="snapshot?.version" class="text-sm text-gray-500">
            v{{ snapshot.version }}
          </span>

          <span v-if="snapshot?.version && snapshot?.developerName" class="text-gray-300" aria-hidden="true">|</span>

          <span v-if="snapshot?.developerName" class="text-sm text-gray-500">
            by {{ snapshot.developerName }}
          </span>

          <span v-if="snapshot?.developerName && snapshot?.lastUpdated" class="text-gray-300" aria-hidden="true">|</span>

          <span v-if="snapshot?.lastUpdated" class="text-sm text-gray-500">
            Updated {{ formattedLastUpdated }}
          </span>

          <span v-if="snapshot?.lastUpdated && snapshot?.size" class="text-gray-300" aria-hidden="true">|</span>

          <span v-if="snapshot?.size" class="text-sm text-gray-500">
            {{ snapshot.size }}
          </span>

          <span v-if="snapshot?.size && snapshot?.developerEmail" class="text-gray-300" aria-hidden="true">|</span>

          <a
            v-if="snapshot?.developerEmail"
            :href="`mailto:${snapshot.developerEmail}`"
            class="text-sm text-gray-500 hover:text-gray-700 hover:underline"
          >
            {{ snapshot.developerEmail }}
          </a>

          <span
            v-if="snapshot?.badgeFlags?.featured"
            class="inline-flex items-center gap-1 rounded-full bg-yellow-50 border border-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-700"
          >
            <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clip-rule="evenodd" />
            </svg>
            Featured
          </span>

          <span
            v-if="snapshot?.developerVerified"
            class="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700"
          >
            <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M16.403 12.652a3 3 0 0 0 0-5.304 3 3 0 0 0-3.75-3.751 3 3 0 0 0-5.305 0 3 3 0 0 0-3.751 3.75 3 3 0 0 0 0 5.305 3 3 0 0 0 3.75 3.751 3 3 0 0 0 5.305 0 3 3 0 0 0 3.751-3.75Zm-2.546-4.46a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
            </svg>
            Verified Publisher
          </span>

          <span
            v-if="snapshot?.translationCount"
            class="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700"
          >
            <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M7.75 2.75a.75.75 0 0 0-1.5 0v1.258a32.987 32.987 0 0 0-3.599.278.75.75 0 1 0 .198 1.487A31.545 31.545 0 0 1 8.7 5.545 19.381 19.381 0 0 1 7.257 9.22a19.378 19.378 0 0 1-1.307-2.353.75.75 0 0 0-1.397.547c.5 1.27 1.18 2.45 1.997 3.532a20.924 20.924 0 0 1-4.241 3.31.75.75 0 1 0 .78 1.28 22.404 22.404 0 0 0 4.52-3.635 22.403 22.403 0 0 0 4.52 3.635.75.75 0 0 0 .78-1.28 20.932 20.932 0 0 1-4.241-3.31c.816-1.082 1.496-2.263 1.997-3.532a.75.75 0 0 0-1.397-.547 19.38 19.38 0 0 1-1.306 2.353c-.648-.935-1.2-1.942-1.638-3.014A31.52 31.52 0 0 1 14 5.773a.75.75 0 1 0 .198-1.487 32.99 32.99 0 0 0-3.599-.278V2.75Z" />
              <path d="M13 8a.75.75 0 0 1 .671.415l4.25 8.5a.75.75 0 1 1-1.342.67L15.322 15h-4.644l-1.257 2.585a.75.75 0 1 1-1.342-.67l4.25-8.5A.75.75 0 0 1 13 8Zm-1.822 5.5h3.644L13 10.28 11.178 13.5Z" />
            </svg>
            {{ snapshot.translationCount }} languages
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
