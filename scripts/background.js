/**
 * Sidekick - AI-Powered Study Companion
 * © 2026 Kaustubh Harapanahalli. All rights reserved.
 * 
 * background.js — Sidekick Service Worker
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ enabled: true });
});

// Handle extension icon click → open side panel
chrome.action.onClicked.addListener(async (tab) => {
  // Prevent on restricted URLs
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
    return;
  }

  // Open the side panel
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    // Side panel failed to open — user may need to retry
  }
});

// Proxy fetch requests from content scripts (bypasses CORS)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_URL' && message.url) {
    handleFetchProxy(message.url, sendResponse);
    return true; // Keep channel open
  }
});

async function handleFetchProxy(url, sendResponse) {
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    sendResponse({ ok: resp.ok, status: resp.status, text: text });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}
