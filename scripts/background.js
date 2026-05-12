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
  if (message.type === 'GET_YOUTUBE_TRANSCRIPT' && message.videoId) {
    getYouTubeTranscript(message.videoId, sendResponse);
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

/**
 * Fetches a YouTube transcript via two strategies:
 *
 * 1. InnerTube /youtubei/v1/player API — YouTube's own internal JSON endpoint.
 *    Returns a fresh player response (including signed caption URLs) as clean JSON.
 *    No HTML parsing required. Works regardless of consent/login interstitials.
 *
 * 2. Watch-page HTML fallback — bracket-balanced extraction of captionTracks from
 *    the embedded ytInitialPlayerResponse, with a real browser User-Agent to avoid
 *    bot-check pages.
 */
async function getYouTubeTranscript(videoId, sendResponse) {
  // ── Strategy 1: InnerTube player API ──────────────────────────────────────
  try {
    const playerResp = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20250430.01.00',
            hl: 'en',
            gl: 'US'
          }
        }
      })
    });

    if (playerResp.ok) {
      const playerJson = await playerResp.json();
      const tracks = playerJson?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
        const captionUrl = buildCaptionUrl(track?.baseUrl);
        if (captionUrl) {
          const captionResp = await fetch(captionUrl);
          if (captionResp.ok) {
            sendResponse({ ok: true, text: await captionResp.text() });
            return;
          }
        }
      }
    }
  } catch (_) {}

  // ── Strategy 2: Watch-page HTML parsing ───────────────────────────────────
  try {
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        // A real browser UA avoids consent/bot-check interstitials
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    if (pageResp.ok) {
      const captionUrl = extractCaptionUrlFromHtml(await pageResp.text());
      if (captionUrl) {
        const captionResp = await fetch(captionUrl);
        if (captionResp.ok) {
          sendResponse({ ok: true, text: await captionResp.text() });
          return;
        }
      }
    }
  } catch (_) {}

  sendResponse({ ok: false });
}

function buildCaptionUrl(baseUrl) {
  if (!baseUrl) return null;
  return baseUrl.includes('fmt=') ? baseUrl : baseUrl + '&fmt=json3';
}

function extractCaptionUrlFromHtml(html) {
  const keyIdx = html.indexOf('"captionTracks":');
  if (keyIdx === -1) return null;

  const arrStart = html.indexOf('[', keyIdx);
  if (arrStart === -1) return null;

  // Bracket-balanced walk to find the end of the captionTracks array
  let depth = 0, inStr = false, esc = false, arrEnd = -1;
  for (let i = arrStart; i < arrStart + 200000 && i < html.length; i++) {
    const c = html[i];
    if (esc)               { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"')           { inStr = !inStr; continue; }
    if (inStr)               continue;
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) { arrEnd = i; break; }
    }
  }
  if (arrEnd === -1) return null;

  try {
    // YouTube encodes & as \u0026 in script-embedded JSON literals
    const tracksJson = html.slice(arrStart, arrEnd + 1).replace(/\\u0026/g, '&');
    const tracks = JSON.parse(tracksJson);
    const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
    return buildCaptionUrl(track?.baseUrl);
  } catch (_) {
    return null;
  }
}
