// youtube_extractor_main.js
// Runs in the page's MAIN WORLD via chrome.scripting.executeScript({ world: 'MAIN' }).
// Has access to window objects and YouTube's session cookies.

(async function() {
  try {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return { error: 'No video ID found in the URL.' };

    // ---------------------------------------------------------------
    // STEP 1: Get playerResponse (try multiple sources)
    // ---------------------------------------------------------------
    let pr = window.ytInitialPlayerResponse;

    if (!pr) {
      for (const s of document.querySelectorAll('script')) {
        const text = s.textContent || '';
        const m = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|let|const|<\/script)/s);
        if (m) { try { pr = JSON.parse(m[1]); break; } catch(e) {} }
      }
    }

    // ---------------------------------------------------------------
    // STEP 2: Find caption tracks
    // ---------------------------------------------------------------
    let tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    // If no tracks from initial response, try InnerTube player API for fresh data
    if (!tracks || tracks.length === 0) {
      console.log("GLS: No tracks from initial response, trying InnerTube player API...");
      try {
        const innerResp = await fetch('https://www.youtube.com/youtubei/v1/player', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { hl: 'en', clientName: 'WEB', clientVersion: '2.20250101.00.00' } },
            videoId: videoId
          })
        });
        const innerData = await innerResp.json();
        tracks = innerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (innerData?.videoDetails?.title) {
          pr = innerData; // Use the fresh player response
        }
      } catch (e) {
        console.warn("GLS: InnerTube player API failed:", e.message);
      }
    }

    if (!tracks || tracks.length === 0) {
      return { error: 'No captions available for this video. The video needs subtitles/CC.' };
    }

    const title = pr?.videoDetails?.title || document.title;
    let track = tracks.find(t => 
      t.languageCode === 'en' || t.languageCode === 'en-US' || t.languageCode === 'en-GB'
    );
    if (!track) track = tracks[0];

    // ---------------------------------------------------------------
    // STEP 3: Fetch transcript (multiple strategies)
    // ---------------------------------------------------------------
    let segments = [];

    // Strategy A: Direct baseUrl fetch (XML format)
    if (segments.length === 0 && track.baseUrl) {
      try {
        const resp = await fetch(track.baseUrl);
        if (resp.ok) {
          const xmlText = await resp.text();
          if (xmlText && xmlText.trim().length > 0) {
            segments = parseTranscriptXml(xmlText);
            console.log(`GLS: Direct baseUrl got ${segments.length} segments`);
          }
        }
      } catch (e) {
        console.warn("GLS: Direct fetch failed:", e.message);
      }
    }

    // Strategy B: Fresh InnerTube player API → get fresh caption URL
    if (segments.length === 0) {
      console.log("GLS: Trying InnerTube player API for fresh caption URL...");
      try {
        const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { hl: 'en', clientName: 'WEB', clientVersion: '2.20250101.00.00' } },
            videoId: videoId
          })
        });
        const data = await resp.json();
        const freshTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (freshTracks && freshTracks.length > 0) {
          let freshTrack = freshTracks.find(t => 
            t.languageCode === 'en' || t.languageCode === 'en-US' || t.languageCode === 'en-GB'
          );
          if (!freshTrack) freshTrack = freshTracks[0];
          
          const captResp = await fetch(freshTrack.baseUrl);
          if (captResp.ok) {
            const xmlText = await captResp.text();
            if (xmlText && xmlText.trim().length > 0) {
              segments = parseTranscriptXml(xmlText);
              console.log(`GLS: Fresh InnerTube URL got ${segments.length} segments`);
            }
          }
        }
      } catch (e) {
        console.warn("GLS: InnerTube fresh URL failed:", e.message);
      }
    }

    // Strategy C: InnerTube get_transcript API (YouTube's native transcript endpoint)
    if (segments.length === 0) {
      console.log("GLS: Trying InnerTube get_transcript API...");
      try {
        // Build the protobuf params for get_transcript
        // This encodes the video ID in YouTube's expected format
        const params = btoa(`\n\x0b${videoId}`);
        
        const resp = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { hl: 'en', clientName: 'WEB', clientVersion: '2.20250101.00.00' } },
            params: params
          })
        });
        
        if (resp.ok) {
          const data = await resp.json();
          // Navigate the response structure
          const body = data?.actions?.[0]?.updateEngagementPanelAction?.content
            ?.transcriptRenderer?.body?.transcriptBodyRenderer;
          
          if (body?.cueGroups) {
            for (const group of body.cueGroups) {
              const cues = group?.transcriptCueGroupRenderer?.cues;
              if (cues) {
                for (const cue of cues) {
                  const cr = cue?.transcriptCueRenderer;
                  if (cr) {
                    const text = (cr.cue?.simpleText || '').trim();
                    const startMs = parseInt(cr.startOffsetMs || '0');
                    const durMs = parseInt(cr.durationMs || '0');
                    if (text) {
                      segments.push({
                        text: text,
                        startTimestamp: startMs / 1000,
                        endTimestamp: (startMs + durMs) / 1000
                      });
                    }
                  }
                }
              }
            }
            console.log(`GLS: get_transcript API got ${segments.length} segments`);
          }
        }
      } catch (e) {
        console.warn("GLS: get_transcript API failed:", e.message);
      }
    }

    // Strategy D: Scrape from the transcript panel DOM (last resort)
    if (segments.length === 0) {
      console.log("GLS: Trying DOM transcript panel scrape...");
      try {
        // Click the "Show transcript" button if available
        const menuBtn = document.querySelector('ytd-video-description-transcript-section-renderer button');
        if (menuBtn) {
          menuBtn.click();
          await new Promise(r => setTimeout(r, 2000));
        }

        // Try to find transcript segments in the DOM
        const transcriptItems = document.querySelectorAll(
          'ytd-transcript-segment-renderer, yt-formatted-string.segment-text'
        );
        
        if (transcriptItems.length > 0) {
          transcriptItems.forEach((item, i) => {
            const timestampEl = item.querySelector('.segment-timestamp, .segment-start-offset');
            const textEl = item.querySelector('.segment-text, yt-formatted-string');
            
            if (textEl) {
              const text = textEl.textContent.trim();
              let startTime = i * 5; // Approximate if no timestamp
              
              if (timestampEl) {
                const parts = timestampEl.textContent.trim().split(':').map(Number);
                if (parts.length === 2) startTime = parts[0] * 60 + parts[1];
                else if (parts.length === 3) startTime = parts[0] * 3600 + parts[1] * 60 + parts[2];
              }
              
              if (text) {
                segments.push({ text, startTimestamp: startTime, endTimestamp: startTime + 5 });
              }
            }
          });
          console.log(`GLS: DOM scrape got ${segments.length} segments`);
        }
      } catch (e) {
        console.warn("GLS: DOM scrape failed:", e.message);
      }
    }

    if (segments.length === 0) {
      return { error: 'Could not fetch transcript via any method. The video may have restricted captions or no captions at all.' };
    }

    return { title, videoId, segments };

  } catch (e) {
    return { error: e.message };
  }

  // Helper: Parse timedtext XML into segments
  function parseTranscriptXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const nodes = doc.getElementsByTagName('text');
    const result = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const start = parseFloat(node.getAttribute('start'));
      const dur = parseFloat(node.getAttribute('dur') || '0');
      const tmp = document.createElement('textarea');
      tmp.innerHTML = node.textContent || '';
      const text = tmp.value.trim();
      if (text) {
        result.push({ text, startTimestamp: start, endTimestamp: start + dur });
      }
    }
    return result;
  }
})();
