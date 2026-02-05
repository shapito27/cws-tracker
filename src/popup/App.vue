<script setup lang="ts">
const openDashboard = () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/dashboard/index.html'),
  });
};
</script>

<template>
  <div class="p-4">
    <h1 class="text-lg font-bold text-gray-900 mb-2">CWS Tracker</h1>
    <p class="text-sm text-gray-600 mb-4">Chrome Web Store competitive intelligence</p>

    <div class="space-y-2">
      <div class="rounded-lg bg-gray-50 p-3">
        <p class="text-xs text-gray-500">Scan Status</p>
        <p class="text-sm font-medium text-gray-700">Idle</p>
      </div>

      <button
        class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        @click="openDashboard"
      >
        Open Dashboard
      </button>
    </div>
  </div>
</template>
