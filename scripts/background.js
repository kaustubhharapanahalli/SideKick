// background.js - Guided Learning Sandbox Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log("Guided Learning Sandbox installed.");
});

// Handle the extension action (icon click)
chrome.action.onClicked.addListener(async (tab) => {
  console.log("Action clicked on tab:", tab.id, tab.url);

  // Prevent injection on restricted URLs
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
    console.error("Cannot run extension on this URL:", tab.url);
    return;
  }

  // Determine which extractor to inject
  let scriptToInject = 'scripts/article_extractor.js';
  if (tab.url.includes('youtube.com/watch')) {
    scriptToInject = 'scripts/youtube_extractor.js';
  }

  // Clear previous session data/errors before starting a new one
  await chrome.storage.local.remove(['currentStudySession', 'currentStudySessionError']);

  try {
    console.log(`Injecting ${scriptToInject} into tab ${tab.id}...`);

    // Inject and execute the script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [scriptToInject]
    });

    // The extractors save to chrome.storage.local asynchronously.
    // Wait briefly for storage to be written, then open the study tab.
    // The study tab itself polls storage on load, so even if timing is tight,
    // it will find the data.
    await new Promise(r => setTimeout(r, 1500));

    // Verify that data was saved
    const stored = await chrome.storage.local.get(['currentStudySession', 'currentStudySessionError']);
    
    if (stored.currentStudySessionError) {
      console.error("Extraction failed:", stored.currentStudySessionError);
      // Still open the study tab so it can display the error nicely
      chrome.tabs.create({ url: chrome.runtime.getURL('src/study.html') });
    } else if (stored.currentStudySession) {
      console.log("Extraction successful. Opening Study Session Tab...");
      chrome.tabs.create({ url: chrome.runtime.getURL('src/study.html') });
    } else {
      console.error("Extraction returned no data. The page might not have extractable content.");
      // Save an error so the study tab can display it
      await chrome.storage.local.set({ 
        currentStudySessionError: "No content could be extracted from this page. Try a different article or video."
      });
      chrome.tabs.create({ url: chrome.runtime.getURL('src/study.html') });
    }

  } catch (error) {
    console.error("Failed to execute extraction script:", error);
  }
});
