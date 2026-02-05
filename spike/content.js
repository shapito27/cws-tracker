// Content script - runs in context of CWS pages
// Extracts page data and sends it back to the service worker

(function() {
  // Listen for messages from the service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXTRACT_PAGE_DATA') {
      const data = extractPageData();
      sendResponse(data);
    } else if (message.type === 'GET_PAGE_HTML') {
      sendResponse({
        url: window.location.href,
        html: document.documentElement.outerHTML,
        title: document.title,
        readyState: document.readyState
      });
    }
    return true; // Keep channel open for async response
  });

  // Extract structured data from CWS page
  function extractPageData() {
    const url = window.location.href;
    const isDetailPage = url.includes('/detail/');
    const isSearchPage = url.includes('/search/');

    const data = {
      url,
      pageType: isDetailPage ? 'detail' : isSearchPage ? 'search' : 'other',
      title: document.title,
      html: document.documentElement.outerHTML,
      htmlLength: document.documentElement.outerHTML.length,
      scripts: [],
      metaTags: [],
      structuredData: [],
      extractedFields: {}
    };

    // Extract all script tag contents (looking for embedded JSON data)
    document.querySelectorAll('script').forEach((script, i) => {
      if (script.textContent && script.textContent.length > 0) {
        data.scripts.push({
          index: i,
          type: script.type || 'text/javascript',
          src: script.src || null,
          contentLength: script.textContent.length,
          contentPreview: script.textContent.substring(0, 500),
          hasAFInitData: script.textContent.includes('AF_initDataCallback'),
          hasJsonData: script.textContent.includes('"key"') || script.textContent.includes('data:')
        });
      }
    });

    // Extract meta tags
    document.querySelectorAll('meta').forEach(meta => {
      data.metaTags.push({
        name: meta.getAttribute('name') || meta.getAttribute('property') || '',
        content: meta.getAttribute('content') || ''
      });
    });

    // Extract structured data (JSON-LD)
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        data.structuredData.push(JSON.parse(script.textContent));
      } catch (e) {
        data.structuredData.push({ error: 'Failed to parse', raw: script.textContent.substring(0, 200) });
      }
    });

    // If detail page, try to extract specific fields from DOM
    if (isDetailPage) {
      data.extractedFields = extractDetailFields();
    }

    // If search page, try to extract search results
    if (isSearchPage) {
      data.extractedFields = extractSearchFields();
    }

    return data;
  }

  // Extract fields from a detail page
  function extractDetailFields() {
    const fields = {};

    // Try common selectors for CWS detail pages
    // Extension name - try multiple selectors
    const nameSelectors = ['h1', '[class*="title"]', '[class*="name"]', '[data-item-id]'];
    for (const sel of nameSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        fields.title = fields.title || el.textContent.trim();
      }
    }

    // Rating
    const ratingEl = document.querySelector('[class*="rating"]') ||
                     document.querySelector('[aria-label*="rating"]') ||
                     document.querySelector('[class*="star"]');
    if (ratingEl) {
      fields.ratingElement = ratingEl.textContent.trim();
      fields.ratingAriaLabel = ratingEl.getAttribute('aria-label') || '';
    }

    // User count
    const userEls = document.querySelectorAll('[class*="user"]');
    userEls.forEach(el => {
      if (el.textContent.includes('users')) {
        fields.userCount = el.textContent.trim();
      }
    });

    // Description
    const descEl = document.querySelector('[class*="description"]') ||
                   document.querySelector('[class*="overview"]');
    if (descEl) {
      fields.description = descEl.textContent.trim().substring(0, 500);
    }

    // Version
    const allText = document.body.innerText;
    const versionMatch = allText.match(/Version[:\s]*(\d+\.\d+[\.\d]*)/i);
    if (versionMatch) {
      fields.version = versionMatch[1];
    }

    // Updated date
    const updatedMatch = allText.match(/Updated[:\s]*([A-Z][a-z]+ \d+, \d{4})/i);
    if (updatedMatch) {
      fields.lastUpdated = updatedMatch[1];
    }

    // Category
    const categoryMatch = allText.match(/Category[:\s]*([^\n]+)/i);
    if (categoryMatch) {
      fields.category = categoryMatch[1].trim();
    }

    // Developer
    const devSelectors = ['[class*="developer"]', '[class*="author"]', 'a[href*="collection/by"]'];
    for (const sel of devSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        fields.developer = fields.developer || el.textContent.trim();
      }
    }

    // Count all images that might be screenshots
    const images = document.querySelectorAll('img');
    let screenshotCount = 0;
    images.forEach(img => {
      const src = img.src || '';
      if (src.includes('screenshot') || (img.width > 200 && img.height > 100)) {
        screenshotCount++;
      }
    });
    fields.possibleScreenshots = screenshotCount;

    // Look for AF_initDataCallback data
    const scripts = document.querySelectorAll('script');
    fields.afInitDataScripts = 0;
    scripts.forEach(script => {
      if (script.textContent.includes('AF_initDataCallback')) {
        fields.afInitDataScripts++;
      }
    });

    return fields;
  }

  // Extract fields from a search page
  function extractSearchFields() {
    const fields = {
      results: [],
      totalResults: 0
    };

    // Try to find search result items
    // CWS search results typically have extension links
    const links = document.querySelectorAll('a[href*="/detail/"]');
    const seenIds = new Set();

    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      // Extract extension ID from URL - it's the last path segment
      const idMatch = href.match(/\/detail\/[^/]*\/([a-z]{32})/i) ||
                      href.match(/\/detail\/([a-z]{32})/i);
      if (idMatch && !seenIds.has(idMatch[1])) {
        seenIds.add(idMatch[1]);
        fields.results.push({
          extensionId: idMatch[1],
          text: link.textContent.trim().substring(0, 100),
          href
        });
      }
    });

    fields.totalResults = fields.results.length;

    return fields;
  }

  // Auto-send page data on load (for tab-based approach)
  function autoReport() {
    const data = extractPageData();
    chrome.runtime.sendMessage({
      type: 'PAGE_DATA_READY',
      data
    }).catch(() => {
      // Service worker might not be listening - that's OK
    });
  }

  // Report after page is fully loaded
  if (document.readyState === 'complete') {
    autoReport();
  } else {
    window.addEventListener('load', autoReport);
  }

  console.log('[CWS Spike] Content script loaded on:', window.location.href);
})();
