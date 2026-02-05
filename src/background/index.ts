// CWS Tracker - Service Worker Entry Point
// This is the background service worker for the Chrome extension.
// Full implementation in Phase 1.7.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('CWS Tracker installed');
  } else if (details.reason === 'update') {
    console.log(`CWS Tracker updated to ${chrome.runtime.getManifest().version}`);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  console.log(`Alarm fired: ${alarm.name}`);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('Message received:', message);
  sendResponse({ ok: true });
  return true;
});
