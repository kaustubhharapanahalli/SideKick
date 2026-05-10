// article_extractor.js - Extracts structured sections from articles
// Returns sections as an array of {heading, html} objects

(function() {
  console.log("Guided Learning Sandbox: Article Extractor injected.");

  try {
    // 1. Extract the title
    let title = document.title;
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim().length > 0) {
      title = h1.textContent.trim();
    }

    // 2. Clone the body to avoid modifying the actual page
    const documentClone = document.cloneNode(true);
    const bodyClone = documentClone.body;

    // 3. Remove unwanted elements
    const elementsToRemove = [
      'nav', 'footer', 'aside', 'script', 'style', 'noscript', 'iframe',
      'svg', 'form', 'button', 'header', 'figure', 'img', 'video', 'audio',
      '.reference', '.references', '.reflist', '.navbox', '.sidebar',
      '.infobox', '.toc', '#toc', '.mw-editsection', '.noprint',
      '.mw-jump-link', '.mw-indicator', '.mw-authority-control',
      '[role="navigation"]', '.catlinks', '.hatnote', '.ambox'
    ];

    elementsToRemove.forEach(selector => {
      bodyClone.querySelectorAll(selector).forEach(el => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    });

    // Remove ad/comment/sidebar containers
    const blacklistSelectors = [
      '[class*="sidebar"]', '[id*="sidebar"]',
      '[class*="social"]', '[class*="share"]',
      '[class*="popup"]', '[id*="popup"]', '[class*="cookie"]',
      '[class*="banner"]', '[class*="promo"]'
    ];

    blacklistSelectors.forEach(selector => {
      bodyClone.querySelectorAll(`div${selector}, section${selector}`).forEach(el => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    });

    // 4. Find the main content node
    // Strategy: check specific selectors in priority order, then use scoring
    let bestNode = null;

    // Ordered list of selectors to try (most specific → most generic)
    const contentSelectors = [
      // Wikipedia
      '#mw-content-text > .mw-parser-output',
      '#mw-content-text',
      // Common blog/news/docs platforms
      'article[class*="post"]', 'article[class*="article"]', 'article[class*="content"]',
      '[class*="article-body"]', '[class*="article-content"]', '[class*="post-content"]',
      '[class*="entry-content"]', '[class*="story-body"]', '[class*="post-body"]',
      '[class*="article__body"]', '[class*="content__body"]',
      // Generic semantic
      'article', 'main[role="main"]', '[role="main"]', 'main',
      // IDs
      '#article-body', '#article-content', '#post-content', '#entry-content',
      '#main-content', '#content-area', '#primary-content'
    ];

    for (const selector of contentSelectors) {
      const el = bodyClone.querySelector(selector);
      if (el && el.textContent.trim().length > 300) {
        bestNode = el;
        console.log(`GLS: bestNode found via selector "${selector}"`);
        break;
      }
    }

    // Scoring fallback: find the element with most paragraph content
    if (!bestNode) {
      let highestScore = 0;
      bodyClone.querySelectorAll('div, section, article').forEach(node => {
        // Skip tiny or navigation-like nodes
        if (node.textContent.trim().length < 200) return;
        const pCount = node.querySelectorAll('p').length;
        const aCount = node.querySelectorAll('a').length;
        if (pCount === 0) return;

        let score = pCount * 15;
        score += Math.min(Math.floor(node.textContent.trim().length / 80), 60);
        score -= aCount * 3;
        // Boost nodes with class names suggesting content
        const cls = (node.className || '') + (node.id || '');
        if (/content|article|post|story|entry|body/i.test(cls)) score += 30;
        if (/nav|header|footer|sidebar|menu|ad|promo/i.test(cls)) score -= 50;

        if (score > highestScore) {
          highestScore = score;
          bestNode = node;
        }
      });
      if (bestNode) console.log(`GLS: bestNode found via scoring (score=${highestScore})`);
    }

    if (!bestNode || bestNode.textContent.trim().length < 200) {
      bestNode = bodyClone;
    }


    // 5. Split the content into sections
    const sections = [];

    // Log for debugging
    const allH2s = bestNode.querySelectorAll('h2');
    const allH3s = bestNode.querySelectorAll('h3');
    const allPs = bestNode.querySelectorAll('p');
    console.log(`Guided Learning Sandbox: bestNode has ${allH2s.length} h2, ${allH3s.length} h3, ${allPs.length} p elements. Tag: ${bestNode.tagName}, class: ${bestNode.className}`);

    // Strategy A: Split by H2 headings
    if (allH2s.length >= 2) {
      let currentHeading = "Introduction";
      let currentHeadingHtml = ''; // The actual h2 HTML to prepend to each section
      let currentParts = [];

      for (const child of bestNode.childNodes) {
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        
        // Check if this element IS an h2 or CONTAINS an h2 (Wikipedia wraps h2 in div.mw-heading)
        const isH2 = child.tagName === 'H2';
        const containsH2 = !isH2 && child.querySelector && child.querySelector('h2');
        
        if (isH2 || containsH2) {
          // Flush the current section (include the heading HTML at the start)
          if (currentParts.length > 0) {
            const html = currentParts.join('');
            if (html.replace(/<[^>]*>/g, '').trim().length > 30) {
              sections.push({ heading: currentHeading, html: currentHeadingHtml + html });
            }
          }
          // Get the heading text and HTML
          const h2El = isH2 ? child : child.querySelector('h2');
          currentHeading = h2El.textContent.trim();
          // Render the heading cleanly (strip edit links etc)
          currentHeadingHtml = `<h2>${currentHeading}</h2>`;
          currentParts = [];
        } else {
          // Regular content element
          if (child.outerHTML && child.textContent.trim().length > 0) {
            currentParts.push(child.outerHTML);
          }
        }
      }

      // Don't forget the last section
      if (currentParts.length > 0) {
        const html = currentParts.join('');
        if (html.replace(/<[^>]*>/g, '').trim().length > 30) {
          sections.push({ heading: currentHeading, html: currentHeadingHtml + html });
        }
      }

      console.log(`Guided Learning Sandbox: H2 strategy produced ${sections.length} sections.`);
    }

    // Strategy B: Split by H3 headings (also handle wrapped h3s like div.mw-heading)
    if (sections.length < 2) {
      sections.length = 0;
      if (allH3s.length >= 2) {
        let currentHeading = "Introduction";
        let currentHeadingHtml = '';
        let currentParts = [];

        for (const child of bestNode.childNodes) {
          if (child.nodeType !== Node.ELEMENT_NODE) continue;
          const isH3 = child.tagName === 'H3';
          const containsH3 = !isH3 && child.querySelector && child.querySelector('h3');
          if (isH3 || containsH3) {
            if (currentParts.length > 0) {
              sections.push({ heading: currentHeading, html: currentHeadingHtml + currentParts.join('') });
            }
            const h3El = isH3 ? child : child.querySelector('h3');
            currentHeading = h3El.textContent.trim();
            currentHeadingHtml = `<h3>${currentHeading}</h3>`;
            currentParts = [];
          } else if (child.textContent.trim().length > 0) {
            currentParts.push(child.outerHTML || '');
          }
        }
        if (currentParts.length > 0) {
          sections.push({ heading: currentHeading, html: currentHeadingHtml + currentParts.join('') });
        }
        console.log(`Guided Learning Sandbox: H3 strategy produced ${sections.length} sections.`);
      }
    }

    // Strategy C: Split by paragraphs (deep search, not just direct children)
    if (sections.length < 2) {
      sections.length = 0;
      const pArray = Array.from(allPs).filter(p => p.textContent.trim().length > 20);
      
      if (pArray.length > 0) {
        const targetCount = Math.min(5, Math.max(2, pArray.length));
        const perSection = Math.ceil(pArray.length / targetCount);

        for (let i = 0; i < targetCount; i++) {
          const start = i * perSection;
          const end = (i === targetCount - 1) ? pArray.length : (i + 1) * perSection;
          const slice = pArray.slice(start, end);
          if (slice.length > 0) {
            sections.push({
              heading: `Section ${i + 1}`,
              html: slice.map(p => p.outerHTML).join('')
            });
          }
        }
        console.log(`Guided Learning Sandbox: Paragraph strategy produced ${sections.length} sections.`);
      }
    }

    // Strategy D: Nuclear fallback — just dump the entire content as one section
    if (sections.length === 0) {
      const fullHtml = bestNode.innerHTML;
      if (fullHtml && fullHtml.trim().length > 0) {
        // Split by character count into ~5 chunks
        const textContent = bestNode.textContent.trim();
        const chunkSize = Math.ceil(textContent.length / 5);
        
        // Simple approach: use innerHTML split into roughly equal parts
        sections.push({
          heading: "Full Article",
          html: fullHtml
        });
        console.log("Guided Learning Sandbox: Used nuclear fallback (single section).");
      }
    }

    // 6. Build the payload
    const payload = {
      type: 'article',
      title: title,
      url: window.location.href,
      sections: sections
    };

    console.log(`Guided Learning Sandbox: Extraction complete. Found ${sections.length} sections.`, payload.title);

    chrome.storage.local.remove('currentStudySessionError');
    chrome.storage.local.set({ currentStudySession: payload });

    return payload;

  } catch (error) {
    console.error("Guided Learning Sandbox Extractor Error:", error.message);
    chrome.storage.local.set({ currentStudySessionError: error.message });
  }
})();
