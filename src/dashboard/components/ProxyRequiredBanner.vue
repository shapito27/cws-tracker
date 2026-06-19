<script setup lang="ts">
/**
 * Setup banner shown when no proxy is configured. Scans cannot run without a
 * proxy (CWS blocks direct extension-origin requests), so this steers the user
 * to deploy one in one click or point to a self-hosted server.
 */
import { useProxyStatus } from '../composables/useProxyStatus';

const PROXY_REPO_URL = 'https://github.com/shapito27/cws-tracker-proxy';
const DEPLOY_TO_CLOUDFLARE_URL = `https://deploy.workers.cloudflare.com/?url=${PROXY_REPO_URL}`;

const { scanBlocked } = useProxyStatus();
</script>

<template>
  <div
    v-if="scanBlocked"
    data-testid="proxy-required-banner"
    class="rounded-lg border border-amber-200 bg-amber-50 p-4"
  >
    <div class="flex items-start gap-3">
      <svg
        class="h-5 w-5 flex-shrink-0 text-amber-500 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
      <div class="flex-1">
        <h3 class="text-sm font-semibold text-amber-900">A proxy is required to scan</h3>
        <p class="mt-1 text-sm text-amber-800">
          The Chrome Web Store blocks direct requests from the extension, so scans must route
          through a proxy. Deploy your own free proxy in one click, or point to a server you host.
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <a
            :href="DEPLOY_TO_CLOUDFLARE_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            Deploy to Cloudflare (free)
          </a>
          <router-link
            :to="{ name: 'settings' }"
            class="inline-flex items-center rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
          >
            Open Settings
          </router-link>
        </div>
        <p class="mt-2 text-xs text-amber-700">
          Self-hosting? Add your proxy URL in Settings — see the
          <a
            :href="PROXY_REPO_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:text-amber-900"
          >setup guide</a>.
        </p>
      </div>
    </div>
  </div>
</template>
