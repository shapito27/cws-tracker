<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useSettings } from '../composables/useSettings';
import {
  DEFAULT_AUDIT_SYSTEM_PROMPT,
  DEFAULT_AUDIT_USER_PROMPT_TEMPLATE,
  AUDIT_PLACEHOLDERS,
} from '@/shared/utils/keyword-audit';

const {
  settings,
  loading,
  saving,
  error,
  successMessage,
  testingOpenAI,
  openAITestResult,
  loadSettings,
  saveSetting,
  saveMultipleSettings,
  testOpenAIConnection,
} = useSettings();

// Local form state for inputs that need debouncing / explicit save
const localOpenAIKey = ref('');
const localLemonSqueezyLicense = ref('');
const localQueueDelay = ref(60);
const localQueueJitter = ref(10);
const localDailyScanTime = ref('03:00');
const localDailyScanEnabled = ref(false);
const localDataRetention = ref(365);
const localProxyUrl = ref('');
const localProxyApiKey = ref('');
const localTranslationLocales = ref('');
const localAuditSystemPrompt = ref('');
const localAuditUserPromptTemplate = ref('');
const showPlaceholderHelp = ref(false);

// Available locale options for the translation locale selector
const AVAILABLE_LOCALES: Array<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt_BR', name: 'Portuguese (Brazil)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh_CN', name: 'Chinese (Simplified)' },
  { code: 'ko', name: 'Korean' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
];

onMounted(async () => {
  await loadSettings();
  syncLocalState();
});

function syncLocalState(): void {
  localOpenAIKey.value = settings.openaiApiKey ?? '';
  localLemonSqueezyLicense.value = settings.lemonSqueezyLicense ?? '';
  localQueueDelay.value = Math.round(settings.queueDelayMs / 1000);
  localQueueJitter.value = Math.round(settings.queueJitterMs / 1000);
  localDailyScanTime.value = settings.dailyScanTime;
  localDailyScanEnabled.value = settings.dailyScanEnabled;
  localDataRetention.value = settings.dataRetentionDays;
  localProxyUrl.value = settings.proxyUrl;
  localProxyApiKey.value = settings.proxyApiKey ?? '';
  localTranslationLocales.value = settings.translationLocales.join(', ');
  localAuditSystemPrompt.value = settings.auditSystemPrompt;
  localAuditUserPromptTemplate.value = settings.auditUserPromptTemplate;
}

// Computed
const extensionVersion = computed(() => {
  try {
    return chrome?.runtime?.getManifest?.()?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
});

const queueDelayDisplay = computed(() => {
  const secs = localQueueDelay.value;
  if (secs >= 60) {
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }
  return `${secs}s`;
});

// Save handlers
async function saveScanSettings(): Promise<void> {
  await saveMultipleSettings({
    queueDelayMs: localQueueDelay.value * 1000,
    queueJitterMs: localQueueJitter.value * 1000,
    dailyScanTime: localDailyScanTime.value,
    dailyScanEnabled: localDailyScanEnabled.value,
  });
}

async function saveOpenAIKey(): Promise<void> {
  const key = localOpenAIKey.value.trim() || null;
  await saveSetting('openaiApiKey', key);
}

async function saveLicenseKey(): Promise<void> {
  const key = localLemonSqueezyLicense.value.trim() || null;
  await saveSetting('lemonSqueezyLicense', key);
}

async function saveDataRetention(): Promise<void> {
  await saveSetting('dataRetentionDays', localDataRetention.value);
}

async function saveProxySettings(): Promise<void> {
  await saveMultipleSettings({
    proxyUrl: localProxyUrl.value.trim(),
    proxyApiKey: localProxyApiKey.value.trim() || null,
  });
}

async function saveTranslationLocales(): Promise<void> {
  const locales = localTranslationLocales.value
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  await saveSetting('translationLocales', locales);
}

async function saveAuditPrompts(): Promise<void> {
  await saveMultipleSettings({
    auditSystemPrompt: localAuditSystemPrompt.value,
    auditUserPromptTemplate: localAuditUserPromptTemplate.value,
  });
}

async function resetAuditPrompts(): Promise<void> {
  localAuditSystemPrompt.value = '';
  localAuditUserPromptTemplate.value = '';
  await saveAuditPrompts();
}

function toggleLocale(code: string): void {
  const current = localTranslationLocales.value
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const idx = current.indexOf(code);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.push(code);
  }
  localTranslationLocales.value = current.join(', ');
}

function getSelectedLocales(): string[] {
  return localTranslationLocales.value
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function isLocaleSelected(code: string): boolean {
  return getSelectedLocales().includes(code);
}

function isLastSelectedLocale(code: string): boolean {
  const current = getSelectedLocales();
  return current.length === 1 && current.includes(code);
}

// Clear success messages after a delay, with proper cleanup
let successTimeoutId: ReturnType<typeof setTimeout> | null = null;

watch([error, successMessage], () => {
  if (successTimeoutId) {
    clearTimeout(successTimeoutId);
    successTimeoutId = null;
  }
  if (successMessage.value) {
    successTimeoutId = setTimeout(() => {
      successMessage.value = null;
      successTimeoutId = null;
    }, 3000);
  }
});

onUnmounted(() => {
  if (successTimeoutId) {
    clearTimeout(successTimeoutId);
  }
});
</script>

<template>
  <div>
    <h2 class="text-2xl font-bold text-gray-900 mb-6">Settings</h2>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12">
      <p class="text-sm text-gray-500">Loading settings...</p>
    </div>

    <div v-else class="space-y-8">
      <!-- Status messages -->
      <div v-if="error" class="rounded-md bg-red-50 border border-red-200 p-3">
        <p class="text-sm text-red-700">{{ error }}</p>
      </div>
      <div v-if="successMessage" class="rounded-md bg-green-50 border border-green-200 p-3">
        <p class="text-sm text-green-700">{{ successMessage }}</p>
      </div>

      <!-- Section: Scan Settings -->
      <section class="rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-200 px-6 py-4">
          <h3 class="text-base font-semibold text-gray-900">Scan Settings</h3>
          <p class="text-sm text-gray-500 mt-0.5">Configure how and when CWS data is collected.</p>
        </div>
        <div class="px-6 py-4 space-y-4">
          <!-- Daily scan toggle -->
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-700">Daily Auto-Scan</label>
              <p class="text-xs text-gray-500">Automatically scan all projects once per day.</p>
            </div>
            <button
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
              :class="localDailyScanEnabled ? 'bg-blue-600' : 'bg-gray-200'"
              @click="localDailyScanEnabled = !localDailyScanEnabled"
            >
              <span
                class="inline-block h-4 w-4 rounded-full bg-white transition-transform"
                :class="localDailyScanEnabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>

          <!-- Daily scan time -->
          <div>
            <label for="dailyScanTime" class="block text-sm font-medium text-gray-700">Scan Time (24h)</label>
            <input
              id="dailyScanTime"
              v-model="localDailyScanTime"
              type="time"
              class="mt-1 block w-40 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <!-- Queue delay -->
          <div>
            <label for="queueDelay" class="block text-sm font-medium text-gray-700">
              Request Delay: {{ queueDelayDisplay }}
            </label>
            <p class="text-xs text-gray-500">Minimum 30 seconds between CWS requests.</p>
            <input
              id="queueDelay"
              v-model.number="localQueueDelay"
              type="range"
              min="30"
              max="300"
              step="10"
              class="mt-1 w-full"
            />
            <div class="flex justify-between text-xs text-gray-400 mt-0.5">
              <span>30s</span>
              <span>5m</span>
            </div>
          </div>

          <!-- Queue jitter -->
          <div>
            <label for="queueJitter" class="block text-sm font-medium text-gray-700">
              Jitter: &plusmn;{{ localQueueJitter }}s
            </label>
            <p class="text-xs text-gray-500">Randomized variation to avoid detection.</p>
            <input
              id="queueJitter"
              v-model.number="localQueueJitter"
              type="range"
              min="0"
              max="60"
              step="5"
              class="mt-1 w-full"
            />
          </div>

          <div class="pt-2">
            <button
              class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="saving"
              @click="saveScanSettings"
            >
              Save Scan Settings
            </button>
          </div>
        </div>
      </section>

      <!-- Section: API Keys -->
      <section class="rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-200 px-6 py-4">
          <h3 class="text-base font-semibold text-gray-900">API Keys</h3>
          <p class="text-sm text-gray-500 mt-0.5">Manage your API keys for AI features and licensing.</p>
        </div>
        <div class="px-6 py-4 space-y-4">
          <!-- OpenAI API Key -->
          <div>
            <label for="openaiKey" class="block text-sm font-medium text-gray-700">OpenAI API Key</label>
            <p class="text-xs text-gray-500">Required for AI-powered optimization features (BYOK).</p>
            <div class="mt-1 flex gap-2">
              <input
                id="openaiKey"
                v-model="localOpenAIKey"
                type="password"
                placeholder="sk-..."
                class="block flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                :disabled="saving"
                @click="saveOpenAIKey"
              >
                Save
              </button>
              <button
                class="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                :disabled="testingOpenAI || !localOpenAIKey"
                @click="testOpenAIConnection"
              >
                {{ testingOpenAI ? 'Testing...' : 'Test Connection' }}
              </button>
            </div>
            <div v-if="openAITestResult" class="mt-2">
              <p
                class="text-xs"
                :class="openAITestResult.success ? 'text-green-600' : 'text-red-600'"
              >
                {{ openAITestResult.message }}
              </p>
            </div>
          </div>

          <!-- LemonSqueezy License -->
          <div>
            <label for="licenseKey" class="block text-sm font-medium text-gray-700">License Key</label>
            <p class="text-xs text-gray-500">LemonSqueezy license key for Pro tier features.</p>
            <div class="mt-1 flex gap-2">
              <input
                id="licenseKey"
                v-model="localLemonSqueezyLicense"
                type="text"
                placeholder="Enter license key"
                class="block flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                :disabled="saving"
                @click="saveLicenseKey"
              >
                Save
              </button>
            </div>
            <div class="mt-1.5">
              <span
                class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                :class="{
                  'bg-green-100 text-green-800': settings.subscriptionStatus === 'pro',
                  'bg-gray-100 text-gray-800': settings.subscriptionStatus === 'free',
                  'bg-red-100 text-red-800': settings.subscriptionStatus === 'expired',
                }"
              >
                {{ settings.subscriptionStatus === 'pro' ? 'Pro' : settings.subscriptionStatus === 'expired' ? 'Expired' : 'Free' }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- Section: AI Audit Prompts -->
      <section class="rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-200 px-6 py-4">
          <h3 class="text-base font-semibold text-gray-900">AI Audit Prompts</h3>
          <p class="text-sm text-gray-500 mt-0.5">Customize the prompts used for keyword audit analysis. Leave blank to use defaults.</p>
        </div>
        <div class="px-6 py-4 space-y-4">
          <!-- System Prompt -->
          <div>
            <label for="auditSystemPrompt" class="block text-sm font-medium text-gray-700">System Prompt</label>
            <p class="text-xs text-gray-500 mb-1">Instructions for the AI model. Must include JSON format specification for proper parsing.</p>
            <textarea
              id="auditSystemPrompt"
              v-model="localAuditSystemPrompt"
              rows="6"
              placeholder="Leave blank to use default system prompt"
              class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <!-- User Prompt Template -->
          <div>
            <label for="auditUserPromptTemplate" class="block text-sm font-medium text-gray-700">User Prompt Template</label>
            <p class="text-xs text-gray-500 mb-1">
              Data template sent to the AI. Use <code class="bg-gray-100 px-1 rounded">&#123;&#123;placeholder&#125;&#125;</code> syntax for dynamic values.
            </p>
            <textarea
              id="auditUserPromptTemplate"
              v-model="localAuditUserPromptTemplate"
              rows="10"
              placeholder="Leave blank to use default template. Use {{placeholder}} for dynamic values."
              class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <!-- Placeholder reference (collapsible) -->
          <div>
            <button
              class="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
              @click="showPlaceholderHelp = !showPlaceholderHelp"
            >
              <svg
                class="h-4 w-4 transition-transform"
                :class="showPlaceholderHelp ? 'rotate-90' : ''"
                aria-hidden="true"
                fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              Available Placeholders
            </button>
            <div v-if="showPlaceholderHelp" class="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div
                  v-for="(desc, key) in AUDIT_PLACEHOLDERS"
                  :key="key"
                  class="flex items-start gap-2"
                >
                  <code class="shrink-0 rounded bg-white px-1.5 py-0.5 text-xs font-mono text-blue-800 border border-blue-200" v-text="'{{' + key + '}}'"></code>
                  <span class="text-xs text-gray-600">{{ desc }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3 pt-2">
            <button
              class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="saving"
              @click="saveAuditPrompts"
            >
              Save Prompts
            </button>
            <button
              class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              @click="resetAuditPrompts"
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      </section>

      <!-- Section: Data Management -->
      <section class="rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-200 px-6 py-4">
          <h3 class="text-base font-semibold text-gray-900">Data Management</h3>
          <p class="text-sm text-gray-500 mt-0.5">Control data retention and storage.</p>
        </div>
        <div class="px-6 py-4 space-y-4">
          <!-- Data retention -->
          <div>
            <label for="dataRetention" class="block text-sm font-medium text-gray-700">
              Data Retention: {{ localDataRetention }} days
            </label>
            <p class="text-xs text-gray-500">Snapshots older than this are pruned. Minimum: 7 days.</p>
            <input
              id="dataRetention"
              v-model.number="localDataRetention"
              type="range"
              min="7"
              max="730"
              step="1"
              class="mt-1 w-full"
            />
            <div class="flex justify-between text-xs text-gray-400 mt-0.5">
              <span>7 days</span>
              <span>1 year</span>
              <span>2 years</span>
            </div>
          </div>

          <div class="pt-2">
            <button
              class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="saving"
              @click="saveDataRetention"
            >
              Save Data Retention
            </button>
          </div>
        </div>
      </section>

      <!-- Section: Proxy -->
      <section class="rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-200 px-6 py-4">
          <h3 class="text-base font-semibold text-gray-900">Proxy Settings</h3>
          <p class="text-sm text-gray-500 mt-0.5">Optional proxy server for CWS requests.</p>
        </div>
        <div class="px-6 py-4 space-y-4">
          <div>
            <label for="proxyUrl" class="block text-sm font-medium text-gray-700">Proxy URL</label>
            <input
              id="proxyUrl"
              v-model="localProxyUrl"
              type="url"
              placeholder="https://your-proxy.workers.dev"
              class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label for="proxyApiKey" class="block text-sm font-medium text-gray-700">Proxy API Key</label>
            <input
              id="proxyApiKey"
              v-model="localProxyApiKey"
              type="password"
              placeholder="Optional"
              class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div class="pt-2">
            <button
              class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="saving"
              @click="saveProxySettings"
            >
              Save Proxy Settings
            </button>
          </div>
        </div>
      </section>

      <!-- Section: Translation Audit -->
      <section class="rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-200 px-6 py-4">
          <h3 class="text-base font-semibold text-gray-900">Translation Audit</h3>
          <p class="text-sm text-gray-500 mt-0.5">Select default locales for translation audits.</p>
        </div>
        <div class="px-6 py-4 space-y-4">
          <div class="flex flex-wrap gap-2">
            <button
              v-for="loc in AVAILABLE_LOCALES"
              :key="loc.code"
              class="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              :class="[
                isLocaleSelected(loc.code)
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
                isLastSelectedLocale(loc.code) ? 'opacity-50 cursor-not-allowed' : '',
              ]"
              :disabled="isLastSelectedLocale(loc.code)"
              @click="toggleLocale(loc.code)"
            >
              {{ loc.code }} - {{ loc.name }}
            </button>
          </div>
          <div class="pt-2">
            <button
              class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="saving"
              @click="saveTranslationLocales"
            >
              Save Locales
            </button>
          </div>
        </div>
      </section>

      <!-- Section: About -->
      <section class="rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-200 px-6 py-4">
          <h3 class="text-base font-semibold text-gray-900">About</h3>
        </div>
        <div class="px-6 py-4">
          <dl class="space-y-2 text-sm">
            <div class="flex items-center gap-2">
              <dt class="font-medium text-gray-700">Version:</dt>
              <dd class="text-gray-500">{{ extensionVersion }}</dd>
            </div>
            <div class="flex items-center gap-2">
              <dt class="font-medium text-gray-700">Parser Version:</dt>
              <dd class="text-gray-500">{{ settings.parserVersion }}</dd>
            </div>
            <div class="flex items-center gap-2">
              <dt class="font-medium text-gray-700">Last Daily Scan:</dt>
              <dd class="text-gray-500">{{ settings.lastDailyScanDate ?? 'Never' }}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  </div>
</template>
