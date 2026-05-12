/**
 * Sidekick - AI-Powered Study Companion
 * © 2026 Kaustubh Harapanahalli. All rights reserved.
 * 
 * content_bridge.js — DOM extraction and navigation
 */
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

    // Always fetch the transcript in the background — even if chapters exist,
    // the transcript text is used to populate per-section textPreview so that
    // Gemini can generate specific questions rather than vague ones.
    const transcriptPromise = extractTranscript(videoId);

    // --- Strategy 1: Native Chapters from DOM ---
    const chapters = extractChaptersFromDOM();
    if (chapters.length > 0) {
      const transcript = await transcriptPromise;
      return { type: 'youtube', videoId, title, chapters, hasChapters: true, transcript };
    }

    // --- Strategy 2: Chapters from description timestamps ---
    const descChapters = extractChaptersFromDescription();
    if (descChapters.length >= 2) {
      const transcript = await transcriptPromise;
      return { type: 'youtube', videoId, title, chapters: descChapters, hasChapters: true, transcript };
    }

    // --- Strategy 3: No chapters → segment via Gemini ---
    const transcript = await transcriptPromise;
    return { type: 'youtube', videoId, title, chapters: [], hasChapters: false, transcript };
  }

  function extractChaptersFromDOM() {
    const chapters = [];

    // Method 1: Macro markers rendered in the chapter panel / description
    // NOTE: YouTube renders this element multiple times in different UI contexts
    // (chapter popup, seek bar, sidebar panel). Collect all, deduplicate at the end.
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

    // Method 2: Structured chapter data from ytInitialData (fallback)
    if (chapters.length === 0) {
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
      } catch (e) { /* Chapter data unavailable */ }
    }

    // Deduplicate by seconds — both methods may yield duplicates from
    // repeated UI renders of the same chapter data.
    const seen = new Set();
    return chapters.filter(ch => {
      if (seen.has(ch.seconds)) return false;
      seen.add(ch.seconds);
      return true;
    });
  }

  function extractChaptersFromDescription() {
    const chapters = [];
    const descEl = document.querySelector('#description-inline-expander, ytd-text-inline-expander, #description');
    if (!descEl) return chapters;

    const text = descEl.textContent || '';
    // Match lines like "0:00 Introduction", "2:30 Setup", or "1:23:45 Advanced Topics"
    const pattern = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/gm;
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
      return null;
    }
  }

  function findPlayerResponse() {
    // Strategy 1: Live window object (most reliable — set by YouTube's own JS)
    try {
      if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.captions) {
        return window.ytInitialPlayerResponse;
      }
    } catch (e) { /* continue */ }

    // Strategy 2: Scan inline script tags
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text.includes('ytInitialPlayerResponse')) {
          // Try assignment pattern: ytInitialPlayerResponse = {...}
          const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});\s*(?:var|let|const|window|if|\()/m);
          if (match) {
            try { return JSON.parse(match[1]); } catch (_) {}
          }
          // Try object literal without trailing semicolon
          const match2 = text.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+\})/m);
          if (match2) {
            try { return JSON.parse(match2[1]); } catch (_) {}
          }
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

    // Identify the main content container
    const mainContent = document.querySelector(
      'article, main, [role="main"], .mw-parser-output, #mw-content-text, #content, .post-content, .entry-content, .article-body'
    ) || document.body;

    // Find ALL headings within the main content area only
    const allHeadings = Array.from(mainContent.querySelectorAll('h1, h2, h3'));

    // Filter to content headings (not nav, footer, sidebar, or the page title H1)
    const pageTitle = title.split(' - ')[0].trim();

    // Headings that are structural metadata rather than content sections
    const METADATA_HEADINGS = new Set([
      'authors', 'author', 'affiliations', 'affiliation', 'abstract',
      'keywords', 'references', 'bibliography', 'acknowledgements',
      'acknowledgments', 'funding', 'disclosure', 'conflicts of interest',
      'conflict of interest', 'doi', 'published', 'publication date',
      'citation', 'citations', 'footnotes', 'appendix', 'supplementary',
      'supplemental', 'about the author', 'about the authors', 'contact',
      'correspondence', 'related articles', 'related posts', 'see also',
      'tags', 'categories', 'share', 'comments'
    ]);

    const contentHeadings = allHeadings.filter(h => {
      const parent = h.closest('nav, footer, aside, header, [role="navigation"], [role="banner"]');
      if (parent) return false;
      if (h.textContent.trim().length < 2) return false;
      // Skip the main article H1 (used as the panel title, not a section)
      if (h.tagName === 'H1' && h.textContent.trim() === pageTitle) return false;
      // Skip metadata headings common in academic papers and articles
      if (METADATA_HEADINGS.has(h.textContent.trim().toLowerCase())) return false;
      return true;
    });

    const sections = [];

    // --- Capture introductory text before the first content heading ---
    // Use compareDocumentPosition to find text blocks that precede the first heading
    // in DOM order, regardless of nesting depth.
    if (contentHeadings.length > 0) {
      const firstHeading = contentHeadings[0];
      const candidates = mainContent.querySelectorAll('p, li, blockquote, pre, td');
      let introText = '';
      for (const el of candidates) {
        // Node.DOCUMENT_POSITION_FOLLOWING means firstHeading comes AFTER el
        const pos = firstHeading.compareDocumentPosition(el);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
          // el is BEFORE firstHeading — check it isn't inside a nav/aside
          if (!el.closest('nav, footer, aside, [role="navigation"]')) {
            const t = el.textContent.trim();
            if (t.length > 20) introText += t + '\n';
          }
        }
      }
      if (introText.trim().length > 100) {
        sections.push({
          title: 'Introduction',
          level: 2,
          textPreview: introText.trim().substring(0, 2000),
          elementIndex: -1
        });
      }
    }

    // --- Build one section per content heading ---
    contentHeadings.forEach((heading, i) => {
      const nextHeading = contentHeadings[i + 1] || null;

      // Collect all text-bearing elements between this heading and the next
      const candidates = mainContent.querySelectorAll('p, li, blockquote, pre, td');
      let textContent = '';
      for (const el of candidates) {
        // el must come AFTER the current heading in DOM order
        const afterCurrent = heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
        if (!afterCurrent) continue;

        // el must come BEFORE the next heading (if there is one)
        if (nextHeading) {
          const beforeNext = nextHeading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
          if (!beforeNext) continue; // el is after nextHeading
        }

        if (!el.closest('nav, footer, aside, [role="navigation"]')) {
          const t = el.textContent.trim();
          if (t.length > 0) textContent += t + '\n';
        }
      }

      if (textContent.trim().length > 30 || heading.tagName !== 'H3') {
        sections.push({
          title: heading.textContent.trim(),
          level: parseInt(heading.tagName[1]),
          textPreview: textContent.trim().substring(0, 2000),
          elementIndex: Array.from(mainContent.querySelectorAll('h1, h2, h3')).indexOf(heading)
        });
      }
    });

    // Fallback: no headings found — use the full page text as one section
    if (sections.length === 0) {
      const text = mainContent.textContent.trim();
      sections.push({
        title: pageTitle || 'Main Content',
        level: 2,
        textPreview: text.substring(0, 2000),
        elementIndex: -1
      });
    }

    return {
      type: 'article',
      title: pageTitle || title,
      sections,
      url: location.href
    };
  }

  // ================================================================
  // MESSAGE HANDLING
  // ================================================================
  const messageListener = (message, sender, sendResponse) => {
    if (message.type === 'CLEANUP') {
      chrome.runtime.onMessage.removeListener(messageListener);
      delete window.__glsBridgeLoaded;
      sendResponse({ ok: true });
      return false;
    }

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

    if (message.type === 'PAUSE_VIDEO') {
      const video = document.querySelector('video');
      if (video) video.pause();
      sendResponse({ ok: true });
    }

    if (message.type === 'GET_VIDEO_TIME') {
      const video = document.querySelector('video');
      sendResponse({ time: video ? video.currentTime : 0 });
    }
  };
  
  chrome.runtime.onMessage.addListener(messageListener);

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

})();
