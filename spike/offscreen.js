// Offscreen document - has full DOM access, different execution context
// Tests whether fetch/XHR from an offscreen document can bypass CORS on CWS domains

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_FETCH') {
    handleFetch(message.url, message.options || {})
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }

  if (message.type === 'OFFSCREEN_XHR') {
    handleXHR(message.url, message.headers || {})
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'OFFSCREEN_IFRAME') {
    handleIframe(message.url)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Approach C1: fetch() from offscreen document
async function handleFetch(url, options) {
  const startTime = Date.now();
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    return {
      success: true,
      approach: 'offscreen-fetch',
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      responseTime: Date.now() - startTime,
      bodyLength: text.length,
      bodyPreview: text.substring(0, 3000),
      fullBody: text,
      redirected: response.redirected,
      type: response.type
    };
  } catch (error) {
    return {
      success: false,
      approach: 'offscreen-fetch',
      url,
      error: error.message,
      responseTime: Date.now() - startTime
    };
  }
}

// Approach C2: XMLHttpRequest from offscreen document
function handleXHR(url, headers) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);

      // Set custom headers
      for (const [key, value] of Object.entries(headers)) {
        try {
          xhr.setRequestHeader(key, value);
        } catch (e) {
          // Some headers can't be set
        }
      }

      xhr.onload = function() {
        resolve({
          success: true,
          approach: 'offscreen-xhr',
          url: xhr.responseURL,
          status: xhr.status,
          statusText: xhr.statusText,
          headers: xhr.getAllResponseHeaders(),
          responseTime: Date.now() - startTime,
          bodyLength: xhr.responseText.length,
          bodyPreview: xhr.responseText.substring(0, 3000),
          fullBody: xhr.responseText,
          responseType: xhr.responseType
        });
      };

      xhr.onerror = function() {
        resolve({
          success: false,
          approach: 'offscreen-xhr',
          url,
          error: 'XHR network error',
          status: xhr.status,
          responseTime: Date.now() - startTime
        });
      };

      xhr.ontimeout = function() {
        resolve({
          success: false,
          approach: 'offscreen-xhr',
          url,
          error: 'XHR timeout',
          responseTime: Date.now() - startTime
        });
      };

      xhr.timeout = 15000;
      xhr.send();
    } catch (error) {
      resolve({
        success: false,
        approach: 'offscreen-xhr',
        url,
        error: error.message,
        responseTime: Date.now() - startTime
      });
    }
  });
}

// Approach C3: Load in iframe and try to read content
function handleIframe(url) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';

      let resolved = false;
      const cleanup = () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      };

      iframe.onload = function() {
        if (resolved) return;
        resolved = true;
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          resolve({
            success: true,
            approach: 'offscreen-iframe',
            url,
            title: doc.title,
            bodyLength: doc.documentElement.outerHTML.length,
            bodyPreview: doc.documentElement.outerHTML.substring(0, 3000),
            fullBody: doc.documentElement.outerHTML,
            responseTime: Date.now() - startTime
          });
        } catch (error) {
          resolve({
            success: false,
            approach: 'offscreen-iframe',
            url,
            error: `Cross-origin frame access blocked: ${error.message}`,
            responseTime: Date.now() - startTime
          });
        }
        cleanup();
      };

      iframe.onerror = function() {
        if (resolved) return;
        resolved = true;
        resolve({
          success: false,
          approach: 'offscreen-iframe',
          url,
          error: 'iframe load error',
          responseTime: Date.now() - startTime
        });
        cleanup();
      };

      // Timeout
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        resolve({
          success: false,
          approach: 'offscreen-iframe',
          url,
          error: 'iframe load timeout (10s)',
          responseTime: Date.now() - startTime
        });
        cleanup();
      }, 10000);

      iframe.src = url;
      document.body.appendChild(iframe);
    } catch (error) {
      resolve({
        success: false,
        approach: 'offscreen-iframe',
        url,
        error: error.message,
        responseTime: Date.now() - startTime
      });
    }
  });
}

console.log('[CWS Spike] Offscreen document loaded.');
