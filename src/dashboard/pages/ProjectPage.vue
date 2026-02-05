<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <div>
    <h2 class="text-2xl font-bold text-gray-900 mb-4">
      Project {{ route.params.id }}
    </h2>
    <p class="text-sm text-gray-500">Project detail page placeholder.</p>
  </div>
</template>
