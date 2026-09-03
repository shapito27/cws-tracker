<script setup lang="ts">
import { ref } from 'vue';
import type { LocaleReport } from '../../composables/useTranslationAudit';
import { localeName } from '@/shared/utils/locales';
import { TRICK_LABELS, type TrickKey } from '@/shared/utils/translation-checks';

defineProps<{
  locales: LocaleReport[];
  /** The locale used as the English baseline, highlighted in the table. */
  baselineLocale: string | null;
}>();

const openLocale = ref<string | null>(null);

function toggle(locale: string): void {
  openLocale.value = openLocale.value === locale ? null : locale;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function rowClass(row: LocaleReport): string {
  if (!row.localized) return 'text-gray-500';
  if (row.tricks.length === 0) return '';
  return row.score >= 20 ? 'bg-red-50/60' : 'bg-amber-50/60';
}

/** A run of the full description, marked when it is part of a flagged excerpt. */
interface TextSegment {
  text: string;
  marked: boolean;
}

/**
 * The verbatim strings the keyword detectors flagged in this locale's
 * description: each line of their excerpts (the trailing "…" of a truncated
 * excerpt is dropped so the prefix still matches).
 */
function flaggedFragments(row: LocaleReport): string[] {
  const flags = row.snapshot.manipulationFlags;
  const raw = [flags.keywordsAtEnd.excerpt, flags.keywordsInline.excerpt]
    .filter((e): e is string => typeof e === 'string' && e.length > 0)
    .flatMap((e) => e.replace(/…$/, '').split('\n'))
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  return [...new Set(raw)];
}

/** Split the full description into segments, marking every flagged fragment. */
function descriptionSegments(row: LocaleReport): TextSegment[] {
  const text = row.snapshot.fullDescription;
  const fragments = flaggedFragments(row);
  if (fragments.length === 0 || text.length === 0) return [{ text, marked: false }];

  const ranges: Array<[number, number]> = [];
  for (const fragment of fragments) {
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(fragment, from);
      if (at === -1) break;
      ranges.push([at, at + fragment.length]);
      from = at + fragment.length;
    }
  }
  if (ranges.length === 0) return [{ text, marked: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    const s = Math.max(start, cursor);
    if (s > cursor) segments.push({ text: text.slice(cursor, s), marked: false });
    segments.push({ text: text.slice(s, end), marked: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
  return segments;
}

/** The detectors' explanations for this locale, for the expanded row. */
function findings(row: LocaleReport): Array<{ key: TrickKey; label: string; detail: string | null }> {
  const flags = row.snapshot.manipulationFlags;
  return row.tricks.map((key) => {
    const flag = flags[key];
    const detail = 'details' in flag && typeof flag.details === 'string' ? flag.details : null;
    return { key, label: TRICK_LABELS[key], detail };
  });
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white" data-testid="locale-table">
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
      <h3 class="text-sm font-semibold text-gray-800">Locale comparison</h3>
      <span class="text-xs text-gray-500">Click a row to read the full localized text</span>
    </div>
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Locale</th>
            <th class="px-4 py-2">Title</th>
            <th class="px-4 py-2">Short description</th>
            <th class="px-4 py-2 text-right">Desc. length</th>
            <th class="px-4 py-2">Detected lang.</th>
            <th class="px-4 py-2">Flags</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <template v-for="row in locales" :key="row.locale">
            <tr
              class="cursor-pointer hover:bg-gray-50"
              :class="rowClass(row)"
              :data-testid="`locale-row-${row.locale}`"
              @click="toggle(row.locale)"
            >
              <td class="whitespace-nowrap px-4 py-2">
                <span class="font-mono text-xs text-gray-800">{{ row.locale }}</span>
                <span class="ml-1 text-gray-500">{{ localeName(row.locale) }}</span>
                <span
                  v-if="row.locale === baselineLocale"
                  class="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700"
                >baseline</span>
                <span
                  v-if="!row.localized"
                  class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600"
                  title="The extension does not ship this locale; the store serves its default listing, so it is not audited."
                >default listing</span>
              </td>
              <td class="max-w-[16rem] px-4 py-2 text-gray-900" :title="row.snapshot.title">
                {{ truncate(row.snapshot.title, 60) || '—' }}
              </td>
              <td class="max-w-[22rem] px-4 py-2 text-gray-700" :title="row.snapshot.shortDescription">
                {{ truncate(row.snapshot.shortDescription, 90) || '—' }}
              </td>
              <td class="whitespace-nowrap px-4 py-2 text-right tabular-nums text-gray-700">
                {{ row.snapshot.descriptionLength.toLocaleString() }}
              </td>
              <td class="whitespace-nowrap px-4 py-2 text-gray-600">
                {{ row.snapshot.detectedLanguage ?? '—' }}
              </td>
              <td class="px-4 py-2">
                <span v-if="!row.localized" class="text-xs text-gray-400">not audited</span>
                <span v-else-if="row.tricks.length === 0" class="text-xs text-green-700">none</span>
                <div v-else class="flex flex-wrap gap-1">
                  <span
                    v-for="t in row.tricks"
                    :key="t"
                    class="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800"
                    :title="TRICK_LABELS[t]"
                  >{{ TRICK_LABELS[t] }}</span>
                </div>
              </td>
            </tr>
            <tr v-if="openLocale === row.locale" :data-testid="`locale-detail-${row.locale}`">
              <td colspan="6" class="bg-gray-50 px-4 py-3">
                <div class="grid gap-3 text-sm md:grid-cols-3">
                  <div>
                    <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Title</p>
                    <p class="mt-1 whitespace-pre-line text-gray-900">{{ row.snapshot.title || '—' }}</p>
                  </div>
                  <div>
                    <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Short description</p>
                    <p class="mt-1 whitespace-pre-line text-gray-800">{{ row.snapshot.shortDescription || '—' }}</p>
                  </div>
                  <div v-if="findings(row).length > 0" class="md:col-span-3" data-testid="locale-findings">
                    <p class="text-xs font-medium uppercase tracking-wide text-gray-500">What was flagged</p>
                    <ul class="mt-1 space-y-1">
                      <li v-for="f in findings(row)" :key="f.key" class="flex flex-wrap items-baseline gap-x-2">
                        <span class="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">{{ f.label }}</span>
                        <span v-if="f.detail" class="text-gray-700">{{ f.detail }}</span>
                      </li>
                    </ul>
                    <p v-if="flaggedFragments(row).length > 0" class="mt-1 text-xs text-gray-500">
                      The flagged text is <mark class="rounded bg-red-200 px-0.5 text-red-900">highlighted</mark> in the description below.
                    </p>
                  </div>
                  <div class="md:col-span-3">
                    <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Full description</p>
                    <pre class="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-3 font-sans text-sm text-gray-800"><template v-for="(seg, i) in descriptionSegments(row)" :key="i"><mark v-if="seg.marked" class="rounded bg-red-200 px-0.5 text-red-900" data-testid="flagged-text">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template><template v-if="!row.snapshot.fullDescription">—</template></pre>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
