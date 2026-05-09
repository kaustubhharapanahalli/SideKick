// article_extractor.js - Extracts clean reading text from articles and blogs

(function() {
  console.log("Guided Learning Sandbox: Article Extractor injected.");

  try {
    // 1. Extract the title
    let title = document.title;
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim().length > 0) {
      title = h1.textContent.trim();
    }

    // 2. Clone the body to avoid destroying the actual page
    const documentClone = document.cloneNode(true);
    const bodyClone = documentClone.body;

    // 3. Remove unwanted elements (navigation, footers, scripts, ads, etc.)
    const elementsToRemove = [
      'nav', 'footer', 'aside', 'script', 'style', 'noscript', 'iframe', 
      'svg', 'form', 'button', 'header'
    ];
    
    elementsToRemove.forEach(tag => {
      const elements = bodyClone.querySelectorAll(tag);
      elements.forEach(el => el.parentNode.removeChild(el));
    });

    // Remove common ad, comment, and sidebar containers by class/id matching
    const blacklistSelectors = [
      '[class*="ad"]', '[id*="ad"]', '[class*="comment"]', '[id*="comment"]',
      '[class*="sidebar"]', '[id*="sidebar"]', '[class*="social"]', '[class*="share"]',
      '[class*="popup"]', '[id*="popup"]', '[class*="cookie"]'
    ];
    
    // Carefully apply blacklist so we don't accidentally delete main content (e.g., if class is "thread")
    // Only remove if it's a div, ul, or aside
    blacklistSelectors.forEach(selector => {
      const elements = bodyClone.querySelectorAll(`div${selector}, ul${selector}, section${selector}`);
      elements.forEach(el => {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });
    });

    // 4. Find the main content node
    // A lightweight scoring system: weigh nodes by the number of <p> tags and text length
    const candidateNodes = bodyClone.querySelectorAll('div, article, section, main');
    let bestNode = null;
    let highestScore = 0;

    if (bodyClone.querySelector('article')) {
      bestNode = bodyClone.querySelector('article');
    } else if (bodyClone.querySelector('main')) {
      bestNode = bodyClone.querySelector('main');
    } else {
      candidateNodes.forEach(node => {
        let score = 0;
        const paragraphs = node.querySelectorAll('p');
        score += paragraphs.length * 10;
        
        // Add points for text length
        const textLength = node.textContent.trim().length;
        score += Math.min(Math.floor(textLength / 100), 50); // Cap text length bonus
        
        // Penalize for having too many links compared to text
        const links = node.querySelectorAll('a');
        if (links.length > 0) {
          score -= links.length * 2;
        }

        if (score > highestScore) {
          highestScore = score;
          bestNode = node;
        }
      });
    }

    // Fallback to body if no good candidate is found
    if (!bestNode || bestNode.textContent.trim().length < 200) {
      bestNode = bodyClone;
    }

    // 5. Clean up the final text content
    // Replace multiple newlines and spaces
    let cleanText = bestNode.textContent
      .replace(/\\n\\s*\\n/g, '\\n\\n') // Normalize multiple newlines
      .replace(/\\t/g, '')             // Remove tabs
      .replace(/ {2,}/g, ' ')          // Remove multiple spaces
      .trim();

    const payload = {
      type: 'article',
      title: title,
      url: window.location.href,
      content: cleanText
    };

    console.log("Guided Learning Sandbox: Extraction complete.", payload.title);
    
    // Save to storage for testing/background orchestrator
    chrome.storage.local.set({ 
      currentStudySession: payload
    }, () => {
      console.log("Guided Learning Sandbox: Payload saved to storage.");
    });

    return payload;

  } catch (error) {
    console.error("Guided Learning Sandbox Extractor Error:", error.message);
    chrome.storage.local.set({ 
      currentStudySessionError: error.message
    });
  }
})();
