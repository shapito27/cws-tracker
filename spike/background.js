// CWS Response Format Investigation - Service Worker (v2)
// Approach: Use tabs + content script to bypass CORS restrictions
// Finding from v1: Direct fetch() from service worker is blocked by CORS on CWS domains

const UBLOCK_ORIGIN_ID = 'cjpalhdlnbpafiamejdnhcphjbkeiagm';
const GOOGLE_TRANSLATE_ID = 'aapbdbdomjkkjkaonfhkkikfgjllcleb';
const NON_EXISTENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';

// CWS URLs
const CWS_DETAIL = (id) => `https://chromewebstore.google.com/detail/${id}`;
const CWS_SEARCH = (query) => `https://chromewebstore.google.com/search/${encodeURIComponent(query)}`;
const CWS_DETAIL_OLD = (id) => `https://chrome.google.com/webstore/detail/${id}`;

// Results storage
const results = { tests: [], startTime: null, endTime: null };

async function saveResults() {
  await chrome.storage.local.set({ spikeResults: results });
  console.log('Results saved to chrome.storage.local');
}

function logTest(testName, data) {
  const testResult = { name: testName, timestamp: new Date().toISOString(), ...data };
  results.tests.push(testResult);
  console.log(`\n=== ${testName} ===`);
  console.log(testResult);
  return testResult;
}

// ============================================================
// APPROACH A: Tab + Content Script
// Open a CWS page in a tab, let content script read the DOM
// ============================================================

async function fetchViaTab(url, waitMs = 5000) {
  console.log(`[Tab Approach] Opening: ${url}`);
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });

    // Wait for page to load
    await new Promise((resolve) => {
      const onUpdated = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      // Timeout fallback
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }, 15000);
    });

    // Give page extra time for JS rendering
    await new Promise(r => setTimeout(r, waitMs));

    // Try sending message to content script
    let contentData = null;
    try {
      contentData = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_HTML' });
    } catch (e) {
      console.log('[Tab Approach] Content script message failed:', e.message);
    }

    // Also try chrome.scripting.executeScript as fallback
    let scriptData = null;
    try {
      const scriptResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          url: window.location.href,
          html: document.documentElement.outerHTML,
          title: document.title,
          readyState: document.readyState,
          bodyText: document.body ? document.body.innerText.substring(0, 3000) : '',
          scriptCount: document.querySelectorAll('script').length,
          afInitDataCount: Array.from(document.querySelectorAll('script'))
            .filter(s => s.textContent.includes('AF_initDataCallback')).length,
          linkCount: document.querySelectorAll('a').length,
          imgCount: document.querySelectorAll('img').length
        })
      });
      scriptData = scriptResults[0]?.result;
    } catch (e) {
      console.log('[Tab Approach] executeScript failed:', e.message);
    }

    // Try extracting detailed data via content script
    let extractedData = null;
    try {
      extractedData = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PAGE_DATA' });
    } catch (e) {
      console.log('[Tab Approach] Extract message failed:', e.message);
    }

    return {
      success: true,
      contentScriptData: contentData,
      scriptingData: scriptData,
      extractedData,
      approach: 'tab'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      approach: 'tab'
    };
  } finally {
    if (tab) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
}

// ============================================================
// APPROACH B: Direct Fetch Variations
// Test various fetch options and alternative API endpoints
// ============================================================

async function fetchDirect(url, options = {}) {
  const startTime = Date.now();
  try {
    const response = await fetch(url, options);
    const responseTime = Date.now() - startTime;
    const text = await response.text();
    return {
      success: true,
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      responseTime,
      bodyLength: text.length,
      bodyPreview: text.substring(0, 2000),
      fullBody: text,
      redirected: response.redirected,
      type: response.type
    };
  } catch (error) {
    return {
      success: false,
      url,
      error: error.message,
      responseTime: Date.now() - startTime
    };
  }
}

// ============================================================
// TEST SUITE
// ============================================================

// Test A1: Detail page via Tab approach
async function testDetailViaTab() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID);
  const result = await fetchViaTab(url, 5000);
  return logTest('A1: Detail Page via Tab (uBlock Origin)', { requestUrl: url, ...result });
}

// Test A2: Search page via Tab approach
async function testSearchViaTab() {
  const url = CWS_SEARCH('ad blocker');
  const result = await fetchViaTab(url, 5000);
  return logTest('A2: Search Page via Tab', { requestUrl: url, ...result });
}

// Test A3: Detail page with ?hl=ja via Tab
async function testDetailJaViaTab() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID) + '?hl=ja';
  const result = await fetchViaTab(url, 5000);
  return logTest('A3: Detail Page ?hl=ja via Tab', { requestUrl: url, ...result });
}

// Test A4: Detail page with ?hl=es via Tab
async function testDetailEsViaTab() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID) + '?hl=es';
  const result = await fetchViaTab(url, 5000);
  return logTest('A4: Detail Page ?hl=es via Tab', { requestUrl: url, ...result });
}

// Test A5: Non-existent extension via Tab
async function testNonExistentViaTab() {
  const url = CWS_DETAIL(NON_EXISTENT_ID);
  const result = await fetchViaTab(url, 5000);
  return logTest('A5: Non-Existent Extension via Tab', { requestUrl: url, ...result });
}

// Test A6: Old domain detail page via Tab
async function testOldDomainViaTab() {
  const url = CWS_DETAIL_OLD(UBLOCK_ORIGIN_ID);
  const result = await fetchViaTab(url, 5000);
  return logTest('A6: Old Domain Detail Page via Tab', { requestUrl: url, ...result });
}

// Test A7: Empty search via Tab
async function testEmptySearchViaTab() {
  const url = CWS_SEARCH('xyznonexistentkeyword12345');
  const result = await fetchViaTab(url, 5000);
  return logTest('A7: Empty Search Results via Tab', { requestUrl: url, ...result });
}

// Test A8: Second extension (Google Translate) via Tab
async function testSecondExtensionViaTab() {
  const url = CWS_DETAIL(GOOGLE_TRANSLATE_ID);
  const result = await fetchViaTab(url, 5000);
  return logTest('A8: Google Translate Detail via Tab', { requestUrl: url, ...result });
}

// Test B1: Direct fetch (expected CORS failure, but documenting behavior)
async function testDirectFetch() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID);
  const result = await fetchDirect(url);
  return logTest('B1: Direct Fetch (expected CORS fail)', { requestUrl: url, ...result });
}

// Test B2: Direct fetch with no-cors mode
async function testNoCors() {
  const url = CWS_DETAIL(UBLOCK_ORIGIN_ID);
  const result = await fetchDirect(url, { mode: 'no-cors' });
  return logTest('B2: Direct Fetch mode:no-cors', { requestUrl: url, ...result });
}

// Test B3: Try known CWS API-like endpoints
async function testApiEndpoints() {
  const endpoints = [
    `https://chrome.google.com/webstore/ajax/detail?pv=20210820&mce=atf,pii,rtr,rlb,gtc,hcn,svp,wtd,nrp,hap,nma,dpb,ar,utb,hbh&id=${UBLOCK_ORIGIN_ID}&hl=en`,
    `https://chrome.google.com/webstore/ajax/item?pv=20210820&id=${UBLOCK_ORIGIN_ID}&hl=en`,
  ];
  const results = [];
  for (const url of endpoints) {
    const result = await fetchDirect(url);
    results.push({ url, ...result });
    await new Promise(r => setTimeout(r, 1000));
  }
  return logTest('B3: CWS API Endpoints', { endpoints: results });
}

// ============================================================
// Run all tests
// ============================================================

async function runAllTests() {
  console.log('Starting CWS Response Format Investigation v2...');
  console.log('Using Tab + Content Script approach to bypass CORS.\n');

  results.startTime = new Date().toISOString();
  results.tests = [];

  try {
    // Tab-based tests (main approach)
    console.log('\n--- Tab-based tests ---');
    await testDetailViaTab();
    await new Promise(r => setTimeout(r, 2000));

    await testSearchViaTab();
    await new Promise(r => setTimeout(r, 2000));

    await testDetailJaViaTab();
    await new Promise(r => setTimeout(r, 2000));

    await testDetailEsViaTab();
    await new Promise(r => setTimeout(r, 2000));

    await testNonExistentViaTab();
    await new Promise(r => setTimeout(r, 2000));

    await testOldDomainViaTab();
    await new Promise(r => setTimeout(r, 2000));

    await testEmptySearchViaTab();
    await new Promise(r => setTimeout(r, 2000));

    await testSecondExtensionViaTab();
    await new Promise(r => setTimeout(r, 2000));

    // Direct fetch tests (documenting CORS behavior)
    console.log('\n--- Direct fetch tests (CORS documentation) ---');
    await testDirectFetch();
    await new Promise(r => setTimeout(r, 1000));

    await testNoCors();
    await new Promise(r => setTimeout(r, 1000));

    await testApiEndpoints();

  } catch (error) {
    console.error('Test suite error:', error);
    results.error = error.message;
  }

  results.endTime = new Date().toISOString();
  await saveResults();

  console.log('\n=== ALL TESTS COMPLETE ===');
  console.log('Results saved to chrome.storage.local');
  console.log('Run: chrome.storage.local.get("spikeResults", r => console.log(JSON.stringify(r, null, 2)))');

  return results;
}

// Quick test - single detail page via tab
async function runQuickTest() {
  console.log('Running quick test (detail page via tab)...');
  results.startTime = new Date().toISOString();
  results.tests = [];

  await testDetailViaTab();

  results.endTime = new Date().toISOString();
  await saveResults();

  console.log('\nQuick test complete. Results saved.');
  return results;
}

// ============================================================
// Message handling
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_DATA_READY') {
    console.log('[SW] Received page data from content script:', message.data?.url);
    // Store latest auto-reported data
    chrome.storage.local.set({ latestPageData: message.data });
  }
  return true;
});

chrome.action.onClicked.addListener(async () => {
  console.log('Extension icon clicked - starting all tests...');
  await runAllTests();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('CWS Spike v2 installed.');
  console.log('Click the extension icon to run all tests, or use console commands.');
  console.log('FINDING: Direct fetch() blocked by CORS. Using Tab + Content Script approach.');
});

// Expose to console
globalThis.runAllTests = runAllTests;
globalThis.runQuickTest = runQuickTest;
globalThis.testDetailViaTab = testDetailViaTab;
globalThis.testSearchViaTab = testSearchViaTab;
globalThis.testDetailJaViaTab = testDetailJaViaTab;
globalThis.testDetailEsViaTab = testDetailEsViaTab;
globalThis.testNonExistentViaTab = testNonExistentViaTab;
globalThis.testOldDomainViaTab = testOldDomainViaTab;
globalThis.testEmptySearchViaTab = testEmptySearchViaTab;
globalThis.testSecondExtensionViaTab = testSecondExtensionViaTab;
globalThis.testDirectFetch = testDirectFetch;
globalThis.testNoCors = testNoCors;
globalThis.testApiEndpoints = testApiEndpoints;
globalThis.getResults = () => chrome.storage.local.get('spikeResults');
globalThis.getLatestPageData = () => chrome.storage.local.get('latestPageData');

console.log('CWS Spike v2 service worker loaded.');
console.log('Commands: runAllTests(), runQuickTest(), testDetailViaTab(), etc.');
