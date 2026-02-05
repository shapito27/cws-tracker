<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <nav class="border-b border-gray-200 bg-white">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="flex h-14 items-center justify-between">
          <div class="flex items-center">
            <h1 class="text-lg font-bold text-gray-900">CWS Tracker</h1>
          </div>
          <div class="flex items-center gap-4">
            <router-link
              to="/"
              class="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Home
            </router-link>
            <router-link
              to="/settings"
              class="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Settings
            </router-link>
          </div>
        </div>
      </div>
    </nav>

    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <RouterView />
    </main>
  </div>
</template>
