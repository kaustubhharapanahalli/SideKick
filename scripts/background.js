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
    // Future improvement: Show a nice error badge or notification here
    return;
  }

  // Determine which extractor to inject
  let scriptToInject = 'scripts/article_extractor.js';
  if (tab.url.includes('youtube.com/watch')) {
    scriptToInject = 'scripts/youtube_extractor.js';
  }

  try {
    console.log(`Injecting ${scriptToInject} into tab ${tab.id}...`);
    
    // Inject and execute the script
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [scriptToInject]
    });

    // Verify the script returned a payload successfully
    if (injectionResults && injectionResults[0] && injectionResults[0].result) {
      console.log("Extraction successful. Opening Study Session Tab...");
      
      // Open the Study Session UI in a new tab
      chrome.tabs.create({ url: chrome.runtime.getURL('src/study.html') });
    } else {
      console.error("Extraction returned no result. The page might not have extractable content.");
    }

  } catch (error) {
    console.error("Failed to execute extraction script:", error);
  }
});
