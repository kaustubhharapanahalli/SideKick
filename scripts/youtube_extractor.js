// youtube_extractor.js - Extracts transcripts from YouTube videos

(async function() {
  console.log("Guided Learning Sandbox: YouTube Extractor injected.");

  try {
    // 1. Extract ytInitialPlayerResponse from the page source
    // YouTube dynamically loads content, but the initial response is usually in a script tag.
    let playerResponse = null;
    
    // Sometimes it's available globally if we are in the main world, but content scripts run in isolated worlds.
    // So we need to parse the DOM's script tags.
    const scripts = document.getElementsByTagName('script');
    for (let script of scripts) {
      if (script.textContent && script.textContent.includes('var ytInitialPlayerResponse = ')) {
        const match = script.textContent.match(/var ytInitialPlayerResponse = ({.*?});/);
        if (match && match[1]) {
          playerResponse = JSON.parse(match[1]);
          break;
        }
      }
    }

    if (!playerResponse) {
      // Fallback: Check if we can fetch it via the internal API if we have the video ID
      const videoId = new URLSearchParams(window.location.search).get('v');
      if (!videoId) {
        throw new Error("No video ID found in URL.");
      }
      // If we can't find it in the script, we might have to fail gracefully for now.
      throw new Error("ytInitialPlayerResponse not found in page source.");
    }

    // 2. Find the caption tracks
    const captions = playerResponse.captions;
    if (!captions || !captions.playerCaptionsTracklistRenderer || !captions.playerCaptionsTracklistRenderer.captionTracks) {
      throw new Error("No captions/transcripts available for this video.");
    }

    const captionTracks = captions.playerCaptionsTracklistRenderer.captionTracks;
    
    // Prefer English if available, otherwise take the first one
    let selectedTrack = captionTracks.find(t => t.languageCode === 'en' || t.languageCode === 'en-US' || t.languageCode === 'en-GB');
    if (!selectedTrack) {
      selectedTrack = captionTracks[0];
    }

    console.log("Guided Learning Sandbox: Fetching transcript from", selectedTrack.baseUrl);

    // 3. Fetch the transcript XML
    const response = await fetch(selectedTrack.baseUrl);
    if (!response.ok) {
      throw new Error("Failed to fetch transcript XML.");
    }
    const xmlText = await response.text();

    // 4. Parse the XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const textNodes = xmlDoc.getElementsByTagName("text");

    const transcriptData = [];
    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i];
      const start = parseFloat(node.getAttribute('start'));
      const duration = parseFloat(node.getAttribute('dur'));
      // Decode HTML entities (e.g., &#39; to ')
      const text = node.textContent.replace(/&amp;/g, '&')
                                   .replace(/&lt;/g, '<')
                                   .replace(/&gt;/g, '>')
                                   .replace(/&#39;/g, "'")
                                   .replace(/&quot;/g, '"');

      if (text.trim() !== '') {
        transcriptData.push({
          text: text.trim(),
          startTimestamp: start,
          endTimestamp: start + (duration || 0)
        });
      }
    }

    // Combine short segments to form better paragraphs (Optional, but good for LLMs)
    const combinedData = [];
    let currentSegment = null;
    
    for (const item of transcriptData) {
      if (!currentSegment) {
        currentSegment = { ...item };
      } else {
        // If the current segment is less than ~30 seconds, keep appending
        if (item.startTimestamp - currentSegment.startTimestamp < 30) {
          currentSegment.text += " " + item.text;
          currentSegment.endTimestamp = item.endTimestamp;
        } else {
          combinedData.push(currentSegment);
          currentSegment = { ...item };
        }
      }
    }
    if (currentSegment) {
      combinedData.push(currentSegment);
    }

    console.log("Guided Learning Sandbox: Extraction complete.", combinedData);
    
    // Return the payload (either via storage or message passing)
    // For testing purposes right now, we just save it to local storage so we can view it
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v') || playerResponse.videoDetails.videoId;

    chrome.storage.local.set({ 
      currentStudySession: {
        type: 'youtube',
        title: playerResponse.videoDetails.title,
        videoId: videoId,
        content: combinedData
      }
    }, () => {
      console.log("Guided Learning Sandbox: Payload saved to storage. Video ID:", videoId);
    });

    return combinedData;

  } catch (error) {
    console.error("Guided Learning Sandbox Extractor Error:", error.message);
    chrome.storage.local.set({ 
      currentStudySessionError: error.message
    });
  }
})();
