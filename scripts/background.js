// background.js - Guided Learning Sandbox Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log("Guided Learning Sandbox installed.");
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
    return true;
  }
});

// Handle the extension action (icon click)
chrome.action.onClicked.addListener(async (tab) => {
  console.log("Action clicked on tab:", tab.id, tab.url);

  // Prevent injection on restricted URLs
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
    console.error("Cannot run extension on this URL:", tab.url);
    return;
  }

  // Clear previous session data/errors before starting a new one
  await chrome.storage.local.remove(['currentStudySession', 'currentStudySessionError', '_ytExtractorRaw']);

  const isYouTube = tab.url.includes('youtube.com/watch');

  try {
    if (isYouTube) {
      // ---------------------------------------------------------------
      // YOUTUBE: Two-step extraction
      // Step 1: Run the main-world extractor (has access to cookies + window objects)
      // Step 2: Run the content-script processor (has access to chrome.storage)
      // ---------------------------------------------------------------
      console.log("Injecting YouTube main-world extractor...");

      // Step 1: Execute in MAIN world — reads playerResponse, fetches transcript with cookies
      const mainResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['scripts/youtube_extractor_main.js'],
        world: 'MAIN'
      });

      // Get the return value from the main-world script
      const mainResult = mainResults && mainResults[0] && mainResults[0].result;
      
      if (!mainResult) {
        await chrome.storage.local.set({
          currentStudySessionError: "Main-world extractor returned no data. Try refreshing the YouTube page."
        });
      } else if (mainResult.error) {
        await chrome.storage.local.set({
          currentStudySessionError: mainResult.error
        });
      } else {
        // Save the raw result for the content script to process
        await chrome.storage.local.set({ _ytExtractorRaw: mainResult });

        // Step 2: Run the content script to group segments and save final payload
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['scripts/youtube_extractor.js']
        });
      }

    } else {
      // ---------------------------------------------------------------
      // ARTICLE: Single-step extraction (runs as content script)
      // ---------------------------------------------------------------
      console.log("Injecting article extractor...");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['scripts/article_extractor.js']
      });
    }

    // Wait for storage to be written
    await new Promise(r => setTimeout(r, 2000));

    // Verify and open study tab
    const stored = await chrome.storage.local.get(['currentStudySession', 'currentStudySessionError']);

    if (stored.currentStudySessionError) {
      console.error("Extraction failed:", stored.currentStudySessionError);
      chrome.tabs.create({ url: chrome.runtime.getURL('src/study.html') });
    } else if (stored.currentStudySession) {
      console.log("Extraction successful. Opening Study Session Tab...");
      chrome.tabs.create({ url: chrome.runtime.getURL('src/study.html') });
    } else {
      console.error("Extraction returned no data.");
      await chrome.storage.local.set({
        currentStudySessionError: "No content could be extracted from this page. Try a different article or video."
      });
      chrome.tabs.create({ url: chrome.runtime.getURL('src/study.html') });
    }

  } catch (error) {
    console.error("Failed to execute extraction script:", error);
    await chrome.storage.local.set({
      currentStudySessionError: "Extraction failed: " + error.message
    });
    chrome.tabs.create({ url: chrome.runtime.getURL('src/study.html') });
  }
});
