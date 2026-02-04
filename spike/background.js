// CWS Response Format Investigation - Service Worker
// This spike extension tests how Chrome Web Store responds to fetch requests

// Known extension IDs for testing
const UBLOCK_ORIGIN_ID = 'cjpalhdlnbpafiamejdnhcphjbkeiagm';
const NON_EXISTENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';

// CWS URLs - note there are two domains
const CWS_DETAIL_URL_OLD = (id) => `https://chrome.google.com/webstore/detail/${id}`;
const CWS_DETAIL_URL_NEW = (id) => `https://chromewebstore.google.com/detail/${id}`;
const CWS_SEARCH_URL_OLD = (query) => `https://chrome.google.com/webstore/search/${encodeURIComponent(query)}`;
const CWS_SEARCH_URL_NEW = (query) => `https://chromewebstore.google.com/search/${encodeURIComponent(query)}`;

// Storage for results
const results = {
  tests: [],
  startTime: null,
  endTime: null
};

// Utility to save results
async function saveResults() {
  await chrome.storage.local.set({ spikeResults: results });
  console.log('Results saved to chrome.storage.local');
}

// Utility to log and store test results
function logTest(testName, data) {
  const testResult = {
    name: testName,
    timestamp: new Date().toISOString(),
    ...data
  };
  results.tests.push(testResult);
  console.log(`\n=== ${testName} ===`);
  console.log(testResult);
  return testResult;
}

// Fetch with detailed response info
async function fetchWithDetails(url, options = {}) {
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

// Test 1: Fetch extension detail page (old domain)
async function testDetailPageOld() {
  const url = CWS_DETAIL_URL_OLD(UBLOCK_ORIGIN_ID);
  const result = await fetchWithDetails(url);
  return logTest('Detail Page (chrome.google.com)', {
    requestUrl: url,
    ...result,
    analysis: analyzeResponse(result)
  });
}

// Test 2: Fetch extension detail page (new domain)
async function testDetailPageNew() {
  const url = CWS_DETAIL_URL_NEW(UBLOCK_ORIGIN_ID);
  const result = await fetchWithDetails(url);
  return logTest('Detail Page (chromewebstore.google.com)', {
    requestUrl: url,
    ...result,
    analysis: analyzeResponse(result)
  });
}

// Test 3: Fetch search results page (old domain)
async function testSearchPageOld() {
  const url = CWS_SEARCH_URL_OLD('ad blocker');
  const result = await fetchWithDetails(url);
  return logTest('Search Page (chrome.google.com)', {
    requestUrl: url,
    ...result,
    analysis: analyzeResponse(result)
  });
}

// Test 4: Fetch search results page (new domain)
async function testSearchPageNew() {
  const url = CWS_SEARCH_URL_NEW('ad blocker');
  const result = await fetchWithDetails(url);
  return logTest('Search Page (chromewebstore.google.com)', {
    requestUrl: url,
    ...result,
    analysis: analyzeResponse(result)
  });
}

// Test 5: Accept-Language header variations
async function testAcceptLanguage() {
  const url = CWS_DETAIL_URL_NEW(UBLOCK_ORIGIN_ID);
  const languages = ['en-US', 'ja', 'es', 'de', 'zh-CN'];
  const results = [];

  for (const lang of languages) {
    const result = await fetchWithDetails(url, {
      headers: { 'Accept-Language': lang }
    });
    results.push({
      language: lang,
      ...result,
      analysis: analyzeResponse(result)
    });
    // Small delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }

  return logTest('Accept-Language Header Tests', { languages: results });
}

// Test 6: ?hl= parameter for localization
async function testHlParameter() {
  const baseUrl = CWS_DETAIL_URL_NEW(UBLOCK_ORIGIN_ID);
  const locales = ['en', 'ja', 'es', 'de', 'zh-CN'];
  const results = [];

  for (const locale of locales) {
    const url = `${baseUrl}?hl=${locale}`;
    const result = await fetchWithDetails(url);
    results.push({
      locale,
      url,
      ...result,
      analysis: analyzeResponse(result)
    });
    await new Promise(r => setTimeout(r, 1000));
  }

  return logTest('HL Parameter Tests', { locales: results });
}

// Test 7: Non-existent extension
async function testNonExistent() {
  const url = CWS_DETAIL_URL_NEW(NON_EXISTENT_ID);
  const result = await fetchWithDetails(url);
  return logTest('Non-Existent Extension', {
    requestUrl: url,
    ...result,
    analysis: analyzeResponse(result)
  });
}

// Test 8: Rate limit test (5 requests, 10s apart)
async function testRateLimit() {
  const url = CWS_DETAIL_URL_NEW(UBLOCK_ORIGIN_ID);
  const results = [];

  for (let i = 0; i < 5; i++) {
    console.log(`Rate limit test request ${i + 1}/5...`);
    const result = await fetchWithDetails(url);
    results.push({
      requestNumber: i + 1,
      timestamp: new Date().toISOString(),
      status: result.status,
      responseTime: result.responseTime,
      is429: result.status === 429
    });

    if (i < 4) {
      console.log('Waiting 10 seconds...');
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  return logTest('Rate Limit Test (5 requests, 10s apart)', { requests: results });
}

// Test 9: Rapid fire test (5 requests with no delay)
async function testRapidFire() {
  const url = CWS_DETAIL_URL_NEW(UBLOCK_ORIGIN_ID);
  const requests = [];

  console.log('Sending 5 rapid requests...');
  const startTime = Date.now();

  for (let i = 0; i < 5; i++) {
    const result = await fetchWithDetails(url);
    requests.push({
      requestNumber: i + 1,
      status: result.status,
      responseTime: result.responseTime,
      is429: result.status === 429
    });
  }

  return logTest('Rapid Fire Test (5 requests, no delay)', {
    totalTime: Date.now() - startTime,
    requests
  });
}

// Analyze response to determine format
function analyzeResponse(result) {
  if (!result.success || !result.fullBody) {
    return { format: 'error', details: result.error || 'No body' };
  }

  const body = result.fullBody;
  const analysis = {
    format: 'unknown',
    hasDoctype: body.toLowerCase().includes('<!doctype'),
    hasHtmlTag: body.toLowerCase().includes('<html'),
    hasScriptTags: body.includes('<script'),
    hasJsonInScript: false,
    isEmptyShell: false,
    hasServerRenderedContent: false,
    detectedPatterns: []
  };

  // Check for JSON data in script tags
  const afInitDataMatch = body.match(/AF_initDataCallback\s*\(\s*\{/g);
  if (afInitDataMatch) {
    analysis.hasJsonInScript = true;
    analysis.detectedPatterns.push(`AF_initDataCallback found (${afInitDataMatch.length} occurrences)`);
  }

  // Check for data-json patterns
  if (body.includes('data-json')) {
    analysis.detectedPatterns.push('data-json attributes found');
  }

  // Check for server-rendered extension name (uBlock Origin)
  if (body.includes('uBlock Origin') || body.includes('ublock origin')) {
    analysis.hasServerRenderedContent = true;
    analysis.detectedPatterns.push('Extension name found in HTML');
  }

  // Check for noscript content
  if (body.includes('<noscript')) {
    analysis.detectedPatterns.push('noscript tags present');
  }

  // Check if body is mostly empty (JS required)
  const textContent = body.replace(/<[^>]*>/g, '').trim();
  if (textContent.length < 500) {
    analysis.isEmptyShell = true;
    analysis.detectedPatterns.push('Minimal text content - likely JS-rendered');
  }

  // Determine primary format
  if (analysis.hasJsonInScript) {
    analysis.format = 'html-with-json-data';
  } else if (analysis.hasServerRenderedContent) {
    analysis.format = 'server-rendered-html';
  } else if (analysis.isEmptyShell) {
    analysis.format = 'js-rendered-shell';
  } else if (analysis.hasHtmlTag) {
    analysis.format = 'html';
  }

  return analysis;
}

// Run all tests
async function runAllTests() {
  console.log('Starting CWS Response Format Investigation...');
  console.log('This will take several minutes due to rate limit testing.\n');

  results.startTime = new Date().toISOString();
  results.tests = [];

  try {
    // Basic fetch tests
    await testDetailPageOld();
    await new Promise(r => setTimeout(r, 2000));

    await testDetailPageNew();
    await new Promise(r => setTimeout(r, 2000));

    await testSearchPageOld();
    await new Promise(r => setTimeout(r, 2000));

    await testSearchPageNew();
    await new Promise(r => setTimeout(r, 2000));

    // Localization tests
    await testAcceptLanguage();
    await new Promise(r => setTimeout(r, 2000));

    await testHlParameter();
    await new Promise(r => setTimeout(r, 2000));

    // Error handling test
    await testNonExistent();
    await new Promise(r => setTimeout(r, 2000));

    // Rate limit tests
    await testRapidFire();
    await new Promise(r => setTimeout(r, 5000));

    await testRateLimit();

  } catch (error) {
    console.error('Test suite error:', error);
    results.error = error.message;
  }

  results.endTime = new Date().toISOString();
  await saveResults();

  console.log('\n=== ALL TESTS COMPLETE ===');
  console.log('Results saved to chrome.storage.local');
  console.log('To view results, run in console: chrome.storage.local.get("spikeResults", r => console.log(r))');

  return results;
}

// Run a single quick test (for development)
async function runQuickTest() {
  console.log('Running quick test...');
  results.startTime = new Date().toISOString();
  results.tests = [];

  await testDetailPageNew();

  results.endTime = new Date().toISOString();
  await saveResults();

  console.log('\nQuick test complete. Results saved.');
  return results;
}

// Extension action click handler
chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked - starting tests...');
  await runAllTests();
});

// Log on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('CWS Spike extension installed.');
  console.log('Click the extension icon to run all tests.');
  console.log('Or use: runQuickTest() for a single test.');
});

// Expose functions to console for manual testing
globalThis.runAllTests = runAllTests;
globalThis.runQuickTest = runQuickTest;
globalThis.testDetailPageOld = testDetailPageOld;
globalThis.testDetailPageNew = testDetailPageNew;
globalThis.testSearchPageOld = testSearchPageOld;
globalThis.testSearchPageNew = testSearchPageNew;
globalThis.testAcceptLanguage = testAcceptLanguage;
globalThis.testHlParameter = testHlParameter;
globalThis.testNonExistent = testNonExistent;
globalThis.testRateLimit = testRateLimit;
globalThis.testRapidFire = testRapidFire;
globalThis.getResults = () => chrome.storage.local.get('spikeResults');

console.log('CWS Spike service worker loaded.');
console.log('Available commands: runAllTests(), runQuickTest(), testDetailPageNew(), etc.');
