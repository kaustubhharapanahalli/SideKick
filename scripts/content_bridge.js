// content_bridge.js — Content script injected into the active tab
// Detects page structure (YouTube chapters/transcript, article headings)
// and relays data to the side panel via chrome.runtime messaging.

(async function contentBridge() {
  'use strict';

  // Prevent double-injection
  if (window.__glsBridgeLoaded) return;
  window.__glsBridgeLoaded = true;

  const isYouTube = location.hostname.includes('youtube.com') && location.pathname === '/watch';

  // ================================================================
  // YOUTUBE DETECTION
  // ================================================================
  async function detectYouTube() {
    const videoId = new URLSearchParams(location.search).get('v');
    if (!videoId) return { error: 'No video ID found.' };

    const title = document.title.replace(' - YouTube', '').trim();

    // --- Strategy 1: Native Chapters from DOM ---
    const chapters = extractChaptersFromDOM();
    if (chapters.length > 0) {
      console.log('[GLS Bridge] Found', chapters.length, 'chapters from DOM');
      return {
        type: 'youtube',
        videoId,
        title,
        chapters,
        hasChapters: true
      };
    }

    // --- Strategy 2: Chapters from description timestamps ---
    const descChapters = extractChaptersFromDescription();
    if (descChapters.length >= 2) {
      console.log('[GLS Bridge] Found', descChapters.length, 'chapters from description');
      return {
        type: 'youtube',
        videoId,
        title,
        chapters: descChapters,
        hasChapters: true
      };
    }

    // --- Strategy 3: No chapters → extract transcript for Gemini ---
    console.log('[GLS Bridge] No chapters found, extracting transcript...');
    const transcript = await extractTranscript(videoId);
    return {
      type: 'youtube',
      videoId,
      title,
      chapters: [],
      hasChapters: false,
      transcript
    };
  }

  function extractChaptersFromDOM() {
    const chapters = [];

    // Method 1: Macro markers (chapter list in description)
    const markers = document.querySelectorAll('ytd-macro-markers-list-item-renderer');
    markers.forEach(marker => {
      const titleEl = marker.querySelector('#details h4, #details .macro-markers');
      const timeEl = marker.querySelector('#time');
      if (titleEl && timeEl) {
        chapters.push({
          title: titleEl.textContent.trim(),
          timestamp: timeEl.textContent.trim(),
          seconds: timestampToSeconds(timeEl.textContent.trim())
        });
      }
    });

    if (chapters.length > 0) return chapters;

    // Method 2: Structured chapter data from ytInitialData
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        if (script.textContent.includes('macroMarkersListItemRenderer')) {
          const match = script.textContent.match(/var ytInitialData\s*=\s*(\{.*?\});/s);
          if (match) {
            const data = JSON.parse(match[1]);
            const markers = findDeep(data, 'macroMarkersListItemRenderer');
            markers.forEach(m => {
              const title = m.title?.simpleText || m.title?.runs?.[0]?.text || '';
              const timeText = m.timeDescription?.simpleText || '';
              if (title && timeText) {
                chapters.push({
                  title,
                  timestamp: timeText,
                  seconds: timestampToSeconds(timeText)
                });
              }
            });
          }
          break;
        }
      }
    } catch (e) {
      console.warn('[GLS Bridge] Chapter parse error:', e);
    }

    return chapters;
  }

  function extractChaptersFromDescription() {
    const chapters = [];
    const descEl = document.querySelector('#description-inline-expander, ytd-text-inline-expander, #description');
    if (!descEl) return chapters;

    const text = descEl.textContent || '';
    // Match lines like "0:00 Introduction" or "1:23:45 Advanced Topics"
    const pattern = /^[\s]*(\d{1,2}:?\d{1,2}:\d{2})\s+(.+)$/gm;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      chapters.push({
        title: match[2].trim(),
        timestamp: match[1].trim(),
        seconds: timestampToSeconds(match[1].trim())
      });
    }
    return chapters;
  }

  async function extractTranscript(videoId) {
    try {
      // Try to get captions from ytInitialPlayerResponse
      const playerResponse = findPlayerResponse();
      if (!playerResponse) return null;

      const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!captions || captions.length === 0) return null;

      // Prefer English
      const track = captions.find(c => c.languageCode === 'en') || captions[0];
      const baseUrl = track.baseUrl;

      // Fetch via background (bypass CORS)
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_URL',
        url: baseUrl + '&fmt=json3'
      });

      if (!response || !response.ok) {
        console.warn('[GLS Bridge] Transcript fetch failed:', response?.error);
        return null;
      }

      const data = JSON.parse(response.text);
      if (!data.events) return null;

      return data.events
        .filter(e => e.segs && e.segs.length > 0)
        .map(e => ({
          start: Math.floor((e.tStartMs || 0) / 1000),
          text: e.segs.map(s => s.utf8 || '').join('').trim()
        }))
        .filter(e => e.text.length > 0);

    } catch (e) {
      console.error('[GLS Bridge] Transcript extraction error:', e);
      return null;
    }
  }

  function findPlayerResponse() {
    // Try window variable
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text.includes('ytInitialPlayerResponse')) {
          const match = text.match(/var ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
          if (match) return JSON.parse(match[1]);
        }
      }
    } catch (e) { /* continue */ }
    return null;
  }

  // ================================================================
  // ARTICLE DETECTION
  // ================================================================
  function detectArticle() {
    const title = document.title;

    // Find headings that structure the content
    const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3'));

    // Filter to headings that are likely content headings (not nav, footer, sidebar)
    const contentHeadings = allHeadings.filter(h => {
      // Skip if inside nav, footer, sidebar, header elements
      const parent = h.closest('nav, footer, aside, header, [role="navigation"], [role="banner"]');
      if (parent) return false;

      // Skip very short or empty headings
      if (h.textContent.trim().length < 2) return false;

      // Skip if it's the page's main h1 (we use that as the title)
      if (h.tagName === 'H1' && h.textContent.trim() === title.split(' - ')[0].trim()) return false;

      return true;
    });

    // Group into sections: each heading starts a section
    const sections = [];
    contentHeadings.forEach((heading, i) => {
      // Collect text between this heading and the next
      const nextHeading = contentHeadings[i + 1];
      let textContent = '';
      let el = heading.nextElementSibling;
      while (el && el !== nextHeading && !isHeading(el)) {
        // Skip nav/sidebar containers
        if (!el.closest('nav, footer, aside, [role="navigation"]')) {
          textContent += el.textContent.trim() + '\n';
        }
        el = el.nextElementSibling;
      }

      // Only include sections with meaningful content
      if (textContent.trim().length > 50 || heading.tagName === 'H2') {
        sections.push({
          title: heading.textContent.trim(),
          level: parseInt(heading.tagName[1]),
          textPreview: textContent.trim().substring(0, 1000),
          elementIndex: Array.from(document.querySelectorAll('h1, h2, h3')).indexOf(heading)
        });
      }
    });

    // If no headings found, create a single section from the full page
    if (sections.length === 0) {
      const mainContent = document.querySelector('article, main, [role="main"], .mw-parser-output, #content');
      const text = mainContent ? mainContent.textContent.trim() : document.body.textContent.trim();
      sections.push({
        title: title.split(' - ')[0].trim() || 'Main Content',
        level: 2,
        textPreview: text.substring(0, 2000),
        elementIndex: -1
      });
    }

    return {
      type: 'article',
      title: title.split(' - ')[0].trim() || title,
      sections,
      url: location.href
    };
  }

  // ================================================================
  // MESSAGE HANDLING
  // ================================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DETECT_PAGE') {
      (async () => {
        try {
          let result;
          if (isYouTube) {
            result = await detectYouTube();
          } else {
            result = detectArticle();
          }
          sendResponse(result);
        } catch (e) {
          sendResponse({ error: e.message });
        }
      })();
      return true; // async
    }

    if (message.type === 'SCROLL_TO_HEADING') {
      const allHeadings = document.querySelectorAll('h1, h2, h3');
      const heading = allHeadings[message.elementIndex];
      if (heading) {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Briefly highlight the heading
        heading.style.transition = 'background-color 0.3s ease';
        heading.style.backgroundColor = 'rgba(0, 240, 255, 0.15)';
        setTimeout(() => { heading.style.backgroundColor = ''; }, 2000);
      }
      sendResponse({ ok: true });
    }

    if (message.type === 'SEEK_VIDEO') {
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = message.seconds;
        video.play();
      }
      sendResponse({ ok: true });
    }

    if (message.type === 'GET_VIDEO_TIME') {
      const video = document.querySelector('video');
      sendResponse({ time: video ? video.currentTime : 0 });
    }
  });

  // ================================================================
  // UTILITY
  // ================================================================
  function timestampToSeconds(ts) {
    const parts = ts.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  function isHeading(el) {
    if (!el) return false;
    if (['H1', 'H2', 'H3'].includes(el.tagName)) return true;
    // Wikipedia wraps headings in div.mw-heading
    if (el.classList?.contains('mw-heading')) return true;
    return false;
  }

  function findDeep(obj, key) {
    const results = [];
    function search(o) {
      if (!o || typeof o !== 'object') return;
      if (o[key]) results.push(o[key]);
      for (const v of Object.values(o)) search(v);
    }
    search(obj);
    return results;
  }

  console.log('[GLS Bridge] Content bridge loaded on', isYouTube ? 'YouTube' : 'Article');
})();
