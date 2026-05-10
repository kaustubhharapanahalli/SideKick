// youtube_extractor.js - Extracts transcripts from YouTube videos

(async function() {
  console.log("Guided Learning Sandbox: YouTube Extractor injected.");

  try {
    // Strategy 1: Parse ytInitialPlayerResponse from the page's HTML source
    // This is the most reliable method — we read the raw HTML of the current page
    // and regex-match the player response JSON out of it.
    let playerResponse = null;
    
    // Try DOM script tags first (works on fresh page loads)
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/ytInitialPlayerResponse\s*=\s*({.+?});\s*(?:var|let|const|<\/script)/s);
      if (match && match[1]) {
        try {
          playerResponse = JSON.parse(match[1]);
          console.log("Guided Learning Sandbox: Found playerResponse via DOM script parsing.");
          break;
        } catch (e) {
          // Try next script
        }
      }
    }

    // Strategy 2: Inject into main world to read the live window object
    if (!playerResponse) {
      playerResponse = await new Promise((resolve) => {
        const injectedScript = document.createElement('script');
        injectedScript.textContent = `
          (function() {
            try {
              let pr = window.ytInitialPlayerResponse;
              if (!pr && window.ytplayer && window.ytplayer.config) {
                pr = window.ytplayer.config.args && window.ytplayer.config.args.raw_player_response
                  ? JSON.parse(window.ytplayer.config.args.raw_player_response)
                  : null;
              }
              window.dispatchEvent(new CustomEvent('GLS_PlayerResponse', { detail: pr ? JSON.stringify(pr) : null }));
            } catch(e) {
              window.dispatchEvent(new CustomEvent('GLS_PlayerResponse', { detail: null }));
            }
          })();
        `;

        const listener = (event) => {
          window.removeEventListener('GLS_PlayerResponse', listener);
          injectedScript.remove();
          resolve(event.detail ? JSON.parse(event.detail) : null);
        };

        window.addEventListener('GLS_PlayerResponse', listener);
        (document.head || document.documentElement).appendChild(injectedScript);

        setTimeout(() => {
          window.removeEventListener('GLS_PlayerResponse', listener);
          if (injectedScript.parentNode) injectedScript.remove();
          resolve(null);
        }, 2000);
      });

      if (playerResponse) {
        console.log("Guided Learning Sandbox: Found playerResponse via main-world injection.");
      }
    }

    // Strategy 3: Fetch the video page HTML as a last resort
    if (!playerResponse) {
      console.log("Guided Learning Sandbox: Falling back to HTML fetch...");
      const videoId = new URLSearchParams(window.location.search).get('v');
      if (!videoId) throw new Error("No video ID found in URL.");

      const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: { 'Accept-Language': 'en' }
      });
      const htmlText = await resp.text();
      // Use a greedy match with dotAll to capture the full JSON object
      const match = htmlText.match(/ytInitialPlayerResponse\s*=\s*({.+?});\s*(?:var|let|const)/s);
      if (match && match[1]) {
        playerResponse = JSON.parse(match[1]);
        console.log("Guided Learning Sandbox: Found playerResponse via HTML fetch.");
      } else {
        throw new Error("Could not extract video data. The video may be restricted or private.");
      }
    }

    // 2. Find caption tracks
    const captions = playerResponse.captions;
    if (!captions || !captions.playerCaptionsTracklistRenderer || !captions.playerCaptionsTracklistRenderer.captionTracks) {
      throw new Error("No captions/transcripts available for this video. Make sure the video has subtitles enabled.");
    }

    const captionTracks = captions.playerCaptionsTracklistRenderer.captionTracks;

    // Prefer English, fall back to first available
    let selectedTrack = captionTracks.find(t =>
      t.languageCode === 'en' || t.languageCode === 'en-US' || t.languageCode === 'en-GB'
    );
    if (!selectedTrack) {
      selectedTrack = captionTracks[0];
    }

    console.log("Guided Learning Sandbox: Fetching transcript from", selectedTrack.baseUrl);

    // 3. Fetch and parse the transcript XML
    const xmlResponse = await fetch(selectedTrack.baseUrl);
    if (!xmlResponse.ok) {
      throw new Error("Failed to fetch transcript XML.");
    }
    const xmlText = await xmlResponse.text();

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const textNodes = xmlDoc.getElementsByTagName("text");

    const transcriptData = [];
    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i];
      const start = parseFloat(node.getAttribute('start'));
      const duration = parseFloat(node.getAttribute('dur') || '0');
      const text = node.textContent
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();

      if (text !== '') {
        transcriptData.push({
          text: text,
          startTimestamp: start,
          endTimestamp: start + duration
        });
      }
    }

    // 4. Group short segments into ~30-second paragraphs for better LLM processing
    const combinedData = [];
    let currentSegment = null;

    for (const item of transcriptData) {
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
    if (currentSegment) {
      combinedData.push(currentSegment);
    }

    // 5. Build and save the payload
    const videoId = new URLSearchParams(window.location.search).get('v') || playerResponse.videoDetails.videoId;

    const payload = {
      type: 'youtube',
      title: playerResponse.videoDetails.title,
      videoId: videoId,
      content: combinedData
    };

    console.log(`Guided Learning Sandbox: Extraction complete. ${combinedData.length} transcript segments.`);

    chrome.storage.local.remove('currentStudySessionError');
    chrome.storage.local.set({ currentStudySession: payload });

    return payload;

  } catch (error) {
    console.error("Guided Learning Sandbox Extractor Error:", error.message);
    chrome.storage.local.set({ currentStudySessionError: error.message });
  }
})();
