<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { Project, Extension, Review } from '@/shared/types';
import { useExtensions } from '../../composables/useExtensions';
import { useServiceWorker } from '../../composables/useServiceWorker';
import {
  loadReviewSummary,
  loadReviewList,
  loadReviewKeywords,
  type ReviewSummary,
  type ReviewKeyword,
} from '../../composables/useReviews';

const props = defineProps<{ project: Project }>();

const { getExtensionsByProject } = useExtensions();
const { requestRefresh } = useServiceWorker();

const extensions = ref<Extension[]>([]);
const selectedExtId = ref<string>('');
const summary = ref<ReviewSummary | null>(null);
const reviews = ref<Review[]>([]);
const keywords = ref<ReviewKeyword[]>([]);
const loading = ref(true);
const refreshNote = ref<string | null>(null);

type RatingFilter = 'all' | 'positive' | 'negative';
type SortBy = 'date' | 'rating' | 'helpful';
const ratingFilter = ref<RatingFilter>('all');
const sortBy = ref<SortBy>('date');

const selectedExtension = computed(() =>
  extensions.value.find((e) => e.id === selectedExtId.value) ?? null,
);

const ratingBand = computed<{ minRating?: number; maxRating?: number }>(() => {
  if (ratingFilter.value === 'positive') return { minRating: 4 };
  if (ratingFilter.value === 'negative') return { maxRating: 2 };
  return {};
});

/** Percentage (0-100) of captured reviews at a given star level. */
function distPct(starIndex: number): number {
  const s = summary.value;
  if (!s || s.capturedCount === 0) return 0;
  return Math.round((s.ratingDistribution[starIndex] / s.capturedCount) * 100);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function loadData(): Promise<void> {
  if (!selectedExtId.value) return;
  loading.value = true;
  try {
    const [s, list, kw] = await Promise.all([
      loadReviewSummary(selectedExtId.value),
      loadReviewList(selectedExtId.value, { sort: sortBy.value, ...ratingBand.value }),
      loadReviewKeywords(selectedExtId.value, { ...ratingBand.value, limit: 24 }),
    ]);
    summary.value = s;
    reviews.value = list;
    keywords.value = kw;
  } finally {
    loading.value = false;
  }
}

async function onRefresh(): Promise<void> {
  refreshNote.value = 'Review scan queued — new reviews will appear here once the scan runs.';
  await requestRefresh(props.project.id, 'reviews');
  // Reload any already-stored reviews immediately; the scan itself runs async.
  await loadData();
}

onMounted(async () => {
  extensions.value = await getExtensionsByProject(props.project.id!);
  selectedExtId.value = props.project.ownExtensionId || extensions.value[0]?.id || '';
  await loadData();
});

watch([selectedExtId, ratingFilter, sortBy], loadData);

/** Largest keyword count, for sizing the keyword chips. */
const maxKeywordCount = computed(() =>
  keywords.value.reduce((m, k) => Math.max(m, k.count), 1),
);
function chipClass(count: number): string {
  const ratio = count / maxKeywordCount.value;
  if (ratio > 0.66) return 'bg-blue-100 text-blue-800 text-sm font-semibold';
  if (ratio > 0.33) return 'bg-blue-50 text-blue-700 text-sm';
  return 'bg-gray-100 text-gray-600 text-xs';
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header: extension selector + refresh -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <label class="text-sm font-medium text-gray-700">Extension</label>
        <select
          v-model="selectedExtId"
          class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option v-for="ext in extensions" :key="ext.id" :value="ext.id">
            {{ ext.name || ext.id }}{{ ext.id === project.ownExtensionId ? ' (own)' : '' }}
          </option>
        </select>
      </div>
      <button
        class="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        @click="onRefresh"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        Refresh reviews
      </button>
    </div>

    <p v-if="refreshNote" class="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
      {{ refreshNote }}
    </p>

    <!-- Loading -->
    <div v-if="loading" class="py-12 text-center text-sm text-gray-500">Loading reviews…</div>

    <!-- Empty state -->
    <div
      v-else-if="!summary || summary.capturedCount === 0"
      class="rounded-lg border border-dashed border-gray-300 py-12 text-center"
    >
      <p class="text-sm font-medium text-gray-700">No reviews captured yet</p>
      <p class="mt-1 text-sm text-gray-500">
        Click “Refresh reviews” to fetch reviews for {{ selectedExtension?.name || 'this extension' }}.
      </p>
    </div>

    <template v-else>
      <!-- Summary cards -->
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Avg rating</p>
          <div class="mt-1 flex items-baseline gap-1">
            <span class="text-2xl font-bold text-gray-900">
              {{ summary.avgRating !== null ? summary.avgRating.toFixed(2) : '—' }}
            </span>
            <span class="text-amber-500">★</span>
          </div>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Total ratings</p>
          <p class="mt-1 text-2xl font-bold text-gray-900">{{ summary.totalRatings.toLocaleString() }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">With text</p>
          <p class="mt-1 text-2xl font-bold text-green-600">{{ summary.textReviews.toLocaleString() }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Rating-only (empty)</p>
          <p class="mt-1 text-2xl font-bold text-gray-500">{{ summary.emptyReviews.toLocaleString() }}</p>
        </div>
      </div>

      <!-- Rating distribution -->
      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-800">Rating distribution</h3>
          <span class="text-xs text-gray-500">{{ summary.capturedCount }} captured</span>
        </div>
        <div class="space-y-1.5">
          <div v-for="star in [5, 4, 3, 2, 1]" :key="star" class="flex items-center gap-2 text-sm">
            <span class="w-8 shrink-0 text-gray-600">{{ star }}★</span>
            <div class="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div class="h-full rounded-full bg-amber-400" :style="{ width: distPct(star - 1) + '%' }" />
            </div>
            <span class="w-10 shrink-0 text-right text-xs text-gray-500">
              {{ summary.ratingDistribution[star - 1] }}
            </span>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap items-center gap-3">
        <div class="inline-flex rounded-md border border-gray-300 p-0.5 text-sm">
          <button
            v-for="f in (['all', 'positive', 'negative'] as const)"
            :key="f"
            class="rounded px-3 py-1 capitalize"
            :class="ratingFilter === f ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
            @click="ratingFilter = f"
          >
            {{ f === 'positive' ? 'Positive (4–5★)' : f === 'negative' ? 'Negative (1–2★)' : 'All' }}
          </button>
        </div>
        <div class="flex items-center gap-1.5 text-sm">
          <label class="text-gray-500">Sort</label>
          <select
            v-model="sortBy"
            class="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="date">Newest</option>
            <option value="rating">Rating</option>
            <option value="helpful">Most helpful</option>
          </select>
        </div>
      </div>

      <!-- Keyword analysis -->
      <div v-if="keywords.length" class="rounded-lg border border-gray-200 bg-white p-4">
        <h3 class="mb-3 text-sm font-semibold text-gray-800">
          Top keywords <span class="font-normal text-gray-400">in review text</span>
        </h3>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="kw in keywords"
            :key="kw.term"
            class="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
            :class="chipClass(kw.count)"
          >
            {{ kw.term }}
            <span class="text-[10px] opacity-70">{{ kw.count }}</span>
          </span>
        </div>
      </div>

      <!-- Review list -->
      <div class="space-y-3">
        <p v-if="!reviews.length" class="py-6 text-center text-sm text-gray-500">
          No reviews match this filter.
        </p>
        <article
          v-for="r in reviews"
          :key="r.reviewId"
          class="rounded-lg border border-gray-200 bg-white p-4"
        >
          <div class="flex items-start gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
              {{ initials(r.reviewerName) }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span class="font-medium text-gray-900">{{ r.reviewerName || 'Anonymous' }}</span>
                <span class="text-amber-500">{{ '★'.repeat(r.rating) }}<span class="text-gray-300">{{ '★'.repeat(5 - r.rating) }}</span></span>
                <span class="text-xs text-gray-400">{{ formatDate(r.postedDate) }}</span>
                <span v-if="r.helpfulCount > 0" class="text-xs text-gray-400">· {{ r.helpfulCount }} found helpful</span>
                <span v-if="r.versionReviewed" class="text-xs text-gray-400">· v{{ r.versionReviewed }}</span>
              </div>
              <p v-if="r.text" class="mt-1 whitespace-pre-line text-sm text-gray-700">{{ r.text }}</p>
              <p v-else class="mt-1 text-sm italic text-gray-400">(rating only, no text)</p>

              <!-- Developer reply -->
              <div v-if="r.devReplyText" class="mt-3 rounded-md border-l-2 border-blue-300 bg-blue-50/50 px-3 py-2">
                <p class="text-xs font-medium text-blue-800">
                  {{ r.devReplyAuthor || 'Developer' }} replied
                  <span v-if="r.devReplyDate" class="font-normal text-blue-400">· {{ formatDate(r.devReplyDate) }}</span>
                </p>
                <p class="mt-0.5 whitespace-pre-line text-sm text-gray-700">{{ r.devReplyText }}</p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>
