// @vitest-environment jsdom

/**
 * Render tests for TranslationsTab — the empty state, the populated report
 * (summary cards, breakdown, locale table) and the run-audit controls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { db } from '@/shared/db/database';
import { SettingsManager } from '@/shared/utils/settings';
import { useProxyStatus } from '@/dashboard/composables/useProxyStatus';
import { emptyManipulationFlags } from '@/shared/utils/translation-checks';
import '../../mocks/chrome';
import { resetChromeMock } from '../../mocks/chrome';
import type { Project, Extension, TranslationSnapshot, ManipulationFlags } from '@/shared/types';

const { state } = vi.hoisted(() => ({
  state: { scanStatus: null as any, requestTranslationAudit: null as any },
}));

vi.mock('@/dashboard/composables/useServiceWorker', async () => {
  const { ref } = await import('vue');
  state.scanStatus = ref({
    isRunning: false,
    completed: 0,
    total: 0,
    currentJob: '',
    nextProcessingAt: null,
    phase: 'running' as const,
    lastScanDate: null,
    lastJobsCompleted: 0,
    lastJobsFailed: 0,
    lastError: null,
  });
  state.requestTranslationAudit = vi.fn().mockResolvedValue(4);
  return {
    useServiceWorker: () => ({
      scanStatus: state.scanStatus,
      requestTranslationAudit: state.requestTranslationAudit,
    }),
  };
});

const { default: TranslationsTab } = await import('@/dashboard/components/project/TranslationsTab.vue');

const OWN = 'extaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const COMP = 'extbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1';

/** Drain the onMounted loads plus the watcher-triggered reloads. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await flushPromises();
}

function makeProject(): Project {
  return {
    id: 1, name: 'P', ownExtensionId: OWN, competitorIds: [COMP], keywordIds: [],
    createdAt: new Date(), updatedAt: new Date(),
  };
}
function makeExtension(id: string, name: string): Extension {
  return { id, name, iconUrl: null, addedAt: new Date(), lastScannedAt: null, status: 'active', projectRefs: [1] };
}
function makeSnapshot(over: Partial<TranslationSnapshot>): TranslationSnapshot {
  return {
    extensionId: OWN, locale: 'en', date: '2026-09-02', title: 'My Ext', shortDescription: 'Short',
    fullDescription: 'Full text', descriptionLength: 9, detectedLanguage: 'en',
    manipulationFlags: emptyManipulationFlags(), scannedAt: new Date('2026-09-02T10:00:00Z'), ...over,
  };
}
function flagged(): ManipulationFlags {
  const f = emptyManipulationFlags();
  f.keywordsAtEnd = { detected: true, excerpt: 'kw1\nkw2\nkw3\nkw4\nkw5' };
  return f;
}

describe('TranslationsTab', () => {
  beforeEach(async () => {
    resetChromeMock();
    state.requestTranslationAudit.mockClear();
    await db.projects.clear();
    await db.extensions.clear();
    await db.translation_snapshots.clear();
    await db.projects.put(makeProject());
    await db.extensions.bulkPut([makeExtension(OWN, 'My Ext'), makeExtension(COMP, 'Rival Ext')]);
  });

  it('renders the empty state and preselects every extension and the default locales', async () => {
    const wrapper = mount(TranslationsTab, { props: { project: makeProject() } });
    await settle();

    expect(wrapper.find('[data-testid="audit-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="audit-report"]').exists()).toBe(false);

    const ownToggle = wrapper.find(`[data-testid="ext-toggle-${OWN}"]`).element as HTMLInputElement;
    const compToggle = wrapper.find(`[data-testid="ext-toggle-${COMP}"]`).element as HTMLInputElement;
    expect(ownToggle.checked).toBe(true);
    expect(compToggle.checked).toBe(true);

    // 2 extensions x 15 default locales.
    expect(wrapper.find('[data-testid="audit-estimate"]').text()).toContain('30 requests');
  });

  it('disables the run button while no proxy is configured', async () => {
    const wrapper = mount(TranslationsTab, { props: { project: makeProject() } });
    await settle();
    const button = wrapper.find('[data-testid="run-audit"]');
    expect((button.element as HTMLButtonElement).disabled).toBe(true);
    expect(button.attributes('title')).toContain('proxy');
  });

  it('starts an audit for the selected extensions and locales when a proxy is set', async () => {
    await new SettingsManager().set('proxyUrl', 'https://proxy.test');
    // Proxy status is module-level shared state; re-read it after the write.
    await useProxyStatus().refreshProxyStatus();
    const wrapper = mount(TranslationsTab, { props: { project: makeProject() } });
    await settle();

    // Deselect the competitor and narrow the locales to two.
    await wrapper.find(`[data-testid="ext-toggle-${COMP}"]`).trigger('change');
    for (const code of ['fr', 'de', 'pt_BR', 'zh_CN', 'ko', 'ru', 'ar', 'hi', 'it', 'nl', 'pl', 'tr']) {
      await wrapper.find(`button[data-testid="locale-toggle-${code}"]`).trigger('click');
    }
    expect(wrapper.find('[data-testid="audit-estimate"]').text()).toContain('3 requests');

    const button = wrapper.find('[data-testid="run-audit"]');
    expect((button.element as HTMLButtonElement).disabled).toBe(false);
    await button.trigger('click');
    await settle();

    expect(state.requestTranslationAudit).toHaveBeenCalledTimes(1);
    const [ids, locales] = state.requestTranslationAudit.mock.calls[0] as [string[], string[]];
    expect(ids).toEqual([OWN]);
    expect([...locales].sort()).toEqual(['en', 'es', 'ja']);
    expect(wrapper.find('[data-testid="start-note"]').text()).toContain('4 locale pages');
  });

  it('renders summaries, the report and the locale table from stored snapshots', async () => {
    await db.translation_snapshots.bulkAdd([
      makeSnapshot({ locale: 'en' }),
      makeSnapshot({ locale: 'es', title: 'Mi Ext', shortDescription: 'Corto' }),
      makeSnapshot({ locale: 'ja', title: '広告ブロッカー', manipulationFlags: flagged() }),
    ]);

    const wrapper = mount(TranslationsTab, { props: { project: makeProject() } });
    await settle();

    expect(wrapper.find('[data-testid="audit-empty"]').exists()).toBe(false);
    const own = wrapper.find(`[data-testid="summary-${OWN}"]`);
    expect(own.text()).toContain('My Ext');
    expect(own.text()).toContain('20'); // keywordsAtEnd weight
    expect(own.text()).toContain('1 flagged');
    expect(wrapper.find(`[data-testid="summary-${COMP}"]`).text()).toContain('not audited');

    const report = wrapper.find('[data-testid="audit-report"]');
    expect(report.exists()).toBe(true);
    expect(report.find('[data-testid="audit-score"]').text()).toBe('20');
    expect(report.find('[data-testid="trick-keywordsAtEnd"]').text()).toContain('1 of 3 locales');
    expect(report.find('[data-testid="trick-differentName"]').text()).toContain('not detected');

    // Expanding the detected trick reveals the excerpt.
    await report.find('[data-testid="trick-keywordsAtEnd"] button').trigger('click');
    expect(report.find('[data-testid="trick-keywordsAtEnd"]').text()).toContain('kw1');

    const table = wrapper.find('[data-testid="locale-table"]');
    expect(table.findAll('[data-testid^="locale-row-"]')).toHaveLength(3);
    expect(table.find('[data-testid="locale-row-en"]').text()).toContain('baseline');
    expect(table.find('[data-testid="locale-row-ja"]').text()).toContain('Keyword list at end');
    expect(table.find('[data-testid="locale-detail-es"]').exists()).toBe(false);
    await table.find('[data-testid="locale-row-es"]').trigger('click');
    expect(table.find('[data-testid="locale-detail-es"]').text()).toContain('Corto');
  });

  it('switches the report when another audited extension is selected', async () => {
    await db.translation_snapshots.bulkAdd([
      makeSnapshot({ locale: 'en' }),
      makeSnapshot({ extensionId: COMP, locale: 'en', title: 'Rival Ext', manipulationFlags: flagged() }),
    ]);
    const wrapper = mount(TranslationsTab, { props: { project: makeProject() } });
    await settle();

    expect(wrapper.find('[data-testid="audit-score"]').text()).toBe('0');
    await wrapper.find(`[data-testid="summary-${COMP}"]`).trigger('click');
    await settle();
    expect(wrapper.find('[data-testid="audit-score"]').text()).toBe('20');
  });

  it('shows the progress note while the queue is running', async () => {
    const wrapper = mount(TranslationsTab, { props: { project: makeProject() } });
    await settle();
    state.scanStatus.value = { ...state.scanStatus.value, isRunning: true, completed: 2, total: 6, currentJob: 'Translation [es]: My Ext' };
    await settle();
    expect(wrapper.find('[data-testid="audit-progress"]').text()).toContain('2 of 6');
  });
});
