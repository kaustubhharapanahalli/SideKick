// background.js — Guided Learning Sandbox Service Worker (Side Panel Architecture)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[GLS] Guided Learning Sandbox v2.0 installed.');
  // Enable side panel on all URLs
  chrome.sidePanel.setOptions({ enabled: true });
});

// Handle extension icon click → open side panel
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[GLS] Action clicked on tab:', tab.id, tab.url);

  // Prevent on restricted URLs
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
    console.error('[GLS] Cannot run on restricted URL:', tab.url);
    return;
  }

  // Open the side panel
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    console.log('[GLS] Side panel opened.');
  } catch (e) {
    console.error('[GLS] Failed to open side panel:', e);
  }
});

// Proxy fetch requests from content scripts (bypasses CORS)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_URL' && message.url) {
    fetch(message.url)
      .then(async (resp) => {
        const text = await resp.text();
        sendResponse({ ok: resp.ok, status: resp.status, text: text });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async
  }
});
