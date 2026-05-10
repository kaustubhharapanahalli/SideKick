// youtube_extractor.js - Extracts transcripts from YouTube videos

(async function() {
  console.log("Guided Learning Sandbox: YouTube Extractor injected.");

  try {
    let playerResponse = await new Promise((resolve) => {
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          try {
            let pr = window.ytInitialPlayerResponse;
            if (!pr && window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.raw_player_response) {
              pr = JSON.parse(window.ytplayer.config.args.raw_player_response);
            }
            window.dispatchEvent(new CustomEvent('GLS_PlayerResponse', { detail: pr ? JSON.stringify(pr) : null }));
          } catch(e) {
            window.dispatchEvent(new CustomEvent('GLS_PlayerResponse', { detail: null }));
          }
        })();
      `;
      
      const listener = (event) => {
        window.removeEventListener('GLS_PlayerResponse', listener);
        script.remove();
        resolve(event.detail ? JSON.parse(event.detail) : null);
      };
      
      window.addEventListener('GLS_PlayerResponse', listener);
      (document.head || document.documentElement).appendChild(script);
      
      setTimeout(() => {
        window.removeEventListener('GLS_PlayerResponse', listener);
        if (script.parentNode) script.remove();
        resolve(null);
      }, 1000); // Shorter timeout for the injection attempt
    });

    if (!playerResponse) {
      console.log("Guided Learning Sandbox: Script injection failed, falling back to HTML fetch...");
      const videoId = new URLSearchParams(window.location.search).get('v');
      if (!videoId) throw new Error("No video ID found in URL.");
      
      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
      const htmlText = await response.text();
      const match = htmlText.match(/ytInitialPlayerResponse\s*=\s*({.*?});/);
      
      if (match && match[1]) {
        playerResponse = JSON.parse(match[1]);
      } else {
        throw new Error("Could not find ytInitialPlayerResponse. This video might be restricted or private.");
      }
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
    });
    // Explicitly clear error
    chrome.storage.local.remove('currentStudySessionError');

    return combinedData;

  } catch (error) {
    console.error("Guided Learning Sandbox Extractor Error:", error.message);
    chrome.storage.local.set({ 
      currentStudySessionError: error.message
    });
  }
})();
