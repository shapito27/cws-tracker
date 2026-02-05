// CWS Response Format Investigation - Service Worker (v3)
// Findings so far:
//   v1: Direct fetch() from SW blocked by CORS on all CWS domains
//   v2: Content scripts don't inject on CWS (restricted domain)
//       chrome.scripting.executeScript: "The extensions gallery cannot be scripted"
//   v3: Testing offscreen document approach (fetch + XHR + iframe)

const UBLOCK_ORIGIN_ID = 'cjpalhdlnbpafiamejdnhcphjbkeiagm';
const GOOGLE_TRANSLATE_ID = 'aapbdbdomjkkjkaonfhkkikfgjllcleb';
const NON_EXISTENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';

const CWS_DETAIL = (id) => `https://chromewebstore.google.com/detail/${id}`;
const CWS_SEARCH = (query) => `https://chromewebstore.google.com/search/${encodeURIComponent(query)}`;
const CWS_DETAIL_OLD = (id) => `https://chrome.google.com/webstore/detail/${id}`;

const results = { tests: [], startTime: null, endTime: null };

async function saveResults() {
  await chrome.storage.local.set({ spikeResults: results });
  console.log('Results saved to chrome.storage.local');
}

function logTest(testName, data) {
  // Strip fullBody from logged output to keep console readable
  const logData = { ...data };
  if (logData.fullBody) {
    logData.fullBody = `[${logData.fullBody.length} chars - saved to storage]`;
  }
  // Also strip nested fullBody in sub-results
  const stripBody = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(stripBody); return; }
    if (obj.fullBody && typeof obj.fullBody === 'string' && obj.fullBody.length > 100) {
      obj.fullBody = `[${obj.fullBody.length} chars]`;
    }
    Object.values(obj).forEach(stripBody);
  };
  stripBody(logData);

  const testResult = { name: testName, timestamp: new Date().toISOString(), ...data };
  results.tests.push(testResult);
  console.log(`\n=== ${testName} ===`);
  console.log(logData);
  return testResult;
}

// ============================================================
// OFFSCREEN DOCUMENT MANAGEMENT
// ============================================================

let offscreenCreated = false;

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Fetch CWS pages from offscreen document context'
    });
    offscreenCreated = true;
    // Give it a moment to load
    await new Promise(r => setTimeout(r, 500));
    console.log('[Offscreen] Document created successfully');
  } catch (e) {
    if (e.message.includes('already exists')) {
      offscreenCreated = true;
    } else {
      console.error('[Offscreen] Failed to create:', e.message);
      throw e;
    }
  }
}

// ============================================================
// APPROACH C: Offscreen Document
// ============================================================

async function fetchViaOffscreen(url, method = 'fetch') {
  await ensureOffscreen();

  const messageType = method === 'xhr' ? 'OFFSCREEN_XHR' :
                      method === 'iframe' ? 'OFFSCREEN_IFRAME' :
                      'OFFSCREEN_FETCH';

  try {
    const result = await chrome.runtime.sendMessage({
      type: messageType,
      url,
      options: {},
      headers: {}
    });
    return result;
  } catch (error) {
    return { success: false, approach: `offscreen-${method}`, error: error.message };
  }
}

// ============================================================
// TEST SUITE
// ============================================================

// --- Offscreen fetch tests ---
async function testOffscreenFetch() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID);
  const result = await fetchViaOffscreen(url, 'fetch');
  return logTest('C1: Offscreen Fetch - Detail Page', { requestUrl: url, ...result });
}

async function testOffscreenXHR() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID);
  const result = await fetchViaOffscreen(url, 'xhr');
  return logTest('C2: Offscreen XHR - Detail Page', { requestUrl: url, ...result });
}

async function testOffscreenIframe() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID);
  const result = await fetchViaOffscreen(url, 'iframe');
  return logTest('C3: Offscreen Iframe - Detail Page', { requestUrl: url, ...result });
}

async function testOffscreenSearchFetch() {
  const url = CWS_SEARCH('ad blocker');
  const result = await fetchViaOffscreen(url, 'fetch');
  return logTest('C4: Offscreen Fetch - Search Page', { requestUrl: url, ...result });
}

async function testOffscreenSearchXHR() {
  const url = CWS_SEARCH('ad blocker');
  const result = await fetchViaOffscreen(url, 'xhr');
  return logTest('C5: Offscreen XHR - Search Page', { requestUrl: url, ...result });
}

// Localization tests via offscreen
async function testOffscreenLocale(locale) {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID) + `?hl=${locale}`;
  const fetchResult = await fetchViaOffscreen(url, 'fetch');
  const xhrResult = await fetchViaOffscreen(url, 'xhr');
  return logTest(`C6: Offscreen Locale ?hl=${locale}`, {
    requestUrl: url,
    fetchResult,
    xhrResult
  });
}

// Non-existent extension via offscreen
async function testOffscreenNonExistent() {
  const url = CWS_DETAIL(NON_EXISTENT_ID);
  const fetchResult = await fetchViaOffscreen(url, 'fetch');
  const xhrResult = await fetchViaOffscreen(url, 'xhr');
  return logTest('C7: Offscreen Non-Existent Extension', {
    requestUrl: url,
    fetchResult,
    xhrResult
  });
}

// Old domain via offscreen
async function testOffscreenOldDomain() {
  const url = CWS_DETAIL_OLD(UBLOCK_ORIGIN_ID);
  const fetchResult = await fetchViaOffscreen(url, 'fetch');
  return logTest('C8: Offscreen Old Domain', { requestUrl: url, fetchResult });
}

// --- Previous tests (for reference/comparison) ---
async function testDirectFetch() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID);
  const startTime = Date.now();
  try {
    const response = await fetch(url);
    const text = await response.text();
    return logTest('B1: Direct SW Fetch (CORS baseline)', {
      requestUrl: url, success: true, status: response.status,
      bodyLength: text.length, responseTime: Date.now() - startTime
    });
  } catch (error) {
    return logTest('B1: Direct SW Fetch (CORS baseline)', {
      requestUrl: url, success: false, error: error.message,
      responseTime: Date.now() - startTime
    });
  }
}

// ============================================================
// Rate limit test via offscreen
// ============================================================
async function testRateLimit() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID);
  const requests = [];

  console.log('Rate limit test: 5 rapid requests...');
  for (let i = 0; i < 5; i++) {
    const result = await fetchViaOffscreen(url, 'fetch');
    requests.push({
      requestNumber: i + 1,
      success: result.success,
      status: result.status,
      bodyLength: result.bodyLength,
      responseTime: result.responseTime,
      is429: result.status === 429
    });
  }

  console.log('Rate limit test: 5 requests with 3s delay...');
  const delayedRequests = [];
  for (let i = 0; i < 5; i++) {
    const result = await fetchViaOffscreen(url, 'fetch');
    delayedRequests.push({
      requestNumber: i + 1,
      success: result.success,
      status: result.status,
      bodyLength: result.bodyLength,
      responseTime: result.responseTime,
      is429: result.status === 429
    });
    if (i < 4) await new Promise(r => setTimeout(r, 3000));
  }

  return logTest('C9: Rate Limit Test', { rapidRequests: requests, delayedRequests });
}

// ============================================================
// Run all tests
// ============================================================

async function runAllTests() {
  console.log('CWS Response Format Investigation v3');
  console.log('Primary approach: Offscreen document (fetch + XHR + iframe)\n');

  results.startTime = new Date().toISOString();
  results.tests = [];

  try {
    // Baseline: direct fetch still fails
    console.log('\n--- Baseline ---');
    await testDirectFetch();
    await new Promise(r => setTimeout(r, 1000));

    // Offscreen document tests
    console.log('\n--- Offscreen Document Tests ---');
    await testOffscreenFetch();
    await new Promise(r => setTimeout(r, 1000));

    await testOffscreenXHR();
    await new Promise(r => setTimeout(r, 1000));

    await testOffscreenIframe();
    await new Promise(r => setTimeout(r, 2000));

    // Search tests
    console.log('\n--- Search Tests ---');
    await testOffscreenSearchFetch();
    await new Promise(r => setTimeout(r, 1000));

    await testOffscreenSearchXHR();
    await new Promise(r => setTimeout(r, 1000));

    // Localization tests
    console.log('\n--- Locale Tests ---');
    await testOffscreenLocale('ja');
    await new Promise(r => setTimeout(r, 1000));

    await testOffscreenLocale('es');
    await new Promise(r => setTimeout(r, 1000));

    await testOffscreenLocale('zh-CN');
    await new Promise(r => setTimeout(r, 1000));

    // Error cases
    console.log('\n--- Error Cases ---');
    await testOffscreenNonExistent();
    await new Promise(r => setTimeout(r, 1000));

    await testOffscreenOldDomain();
    await new Promise(r => setTimeout(r, 1000));

    // Rate limit
    console.log('\n--- Rate Limit ---');
    await testRateLimit();

  } catch (error) {
    console.error('Test suite error:', error);
    results.error = error.message;
  }

  results.endTime = new Date().toISOString();
  await saveResults();

  // Print summary
  console.log('\n=== SUMMARY ===');
  for (const test of results.tests) {
    const success = test.success || test.fetchResult?.success || test.xhrResult?.success;
    const hasBody = (test.bodyLength > 0) || (test.fetchResult?.bodyLength > 0) || (test.xhrResult?.bodyLength > 0);
    console.log(`${success && hasBody ? 'OK' : 'FAIL'} | ${test.name}`);
  }

  console.log('\n=== ALL TESTS COMPLETE ===');
  console.log('View full results:');
  console.log('  chrome.storage.local.get("spikeResults", r => console.log(JSON.stringify(r, null, 2)))');

  return results;
}

async function runQuickTest() {
  console.log('Quick test: offscreen fetch + XHR for detail page...');
  results.startTime = new Date().toISOString();
  results.tests = [];

  await testOffscreenFetch();
  await testOffscreenXHR();

  results.endTime = new Date().toISOString();
  await saveResults();
  console.log('Quick test done.');
  return results;
}

// ============================================================
// Event handlers
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_DATA_READY') {
    console.log('[SW] Page data from content script:', message.data?.url);
    chrome.storage.local.set({ latestPageData: message.data });
  }
  return false;
});

chrome.action.onClicked.addListener(async () => {
  console.log('Starting all tests...');
  await runAllTests();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('CWS Spike v3 installed.');
  console.log('Approach: Offscreen document with fetch/XHR/iframe.');
  console.log('Run: runQuickTest() or runAllTests()');
});

// Expose to console
globalThis.runAllTests = runAllTests;
globalThis.runQuickTest = runQuickTest;
globalThis.testOffscreenFetch = testOffscreenFetch;
globalThis.testOffscreenXHR = testOffscreenXHR;
globalThis.testOffscreenIframe = testOffscreenIframe;
globalThis.testOffscreenSearchFetch = testOffscreenSearchFetch;
globalThis.testOffscreenSearchXHR = testOffscreenSearchXHR;
globalThis.testOffscreenNonExistent = testOffscreenNonExistent;
globalThis.testOffscreenOldDomain = testOffscreenOldDomain;
globalThis.testOffscreenLocale = testOffscreenLocale;
globalThis.testDirectFetch = testDirectFetch;
globalThis.testRateLimit = testRateLimit;
globalThis.getResults = () => chrome.storage.local.get('spikeResults');

console.log('CWS Spike v3 loaded. Commands: runQuickTest(), runAllTests()');
