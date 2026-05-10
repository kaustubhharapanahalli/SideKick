// youtube_extractor.js
// Content script that processes the transcript data from the main-world extractor.
// The background.js injects youtube_extractor_main.js in MAIN world first,
// then injects this script in the ISOLATED world to save results to chrome.storage.

(async function() {
  console.log("GLS: YouTube content script running.");

  try {
    // The main-world extractor has already run and its result is passed
    // via chrome.storage.local (set by background.js).
    // We just need to do the grouping step.
    
    // Wait for the data from background.js
    const stored = await chrome.storage.local.get(['_ytExtractorRaw']);
    const raw = stored._ytExtractorRaw;
    
    if (!raw) {
      throw new Error("No transcript data received from main-world extractor.");
    }
    
    if (raw.error) {
      throw new Error(raw.error);
    }

    // Group segments into ~30-second paragraphs for better LLM processing
    const combinedData = [];
    let currentSegment = null;

    for (const item of raw.segments) {
      if (!currentSegment) {
        currentSegment = { ...item };
      } else if (item.startTimestamp - currentSegment.startTimestamp < 30) {
        currentSegment.text += " " + item.text;
        currentSegment.endTimestamp = item.endTimestamp;
      } else {
        combinedData.push(currentSegment);
        currentSegment = { ...item };
      }
    }
    if (currentSegment) combinedData.push(currentSegment);

    if (combinedData.length === 0) {
      throw new Error("Transcript contained no usable text segments.");
    }

    // Build and save the payload
    const payload = {
      type: 'youtube',
      title: raw.title,
      videoId: raw.videoId || new URLSearchParams(window.location.search).get('v'),
      content: combinedData
    };

    console.log(`GLS: Extraction complete. ${combinedData.length} transcript segments.`);
    
    await chrome.storage.local.remove(['currentStudySessionError', '_ytExtractorRaw']);
    await chrome.storage.local.set({ currentStudySession: payload });

    return payload;

  } catch (error) {
    console.error("GLS Extractor Error:", error.message);
    await chrome.storage.local.remove('_ytExtractorRaw');
    await chrome.storage.local.set({ currentStudySessionError: error.message });
  }
})();
