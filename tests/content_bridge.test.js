/**
 * @file content_bridge.test.js
 * Unit tests for the content bridge's pure utility functions and article detection logic.
 * Tests timestamp parsing, heading detection, chapter extraction from descriptions.
 * 
 * @jest-environment jsdom
 */

// --- Extract utility functions for isolated testing ---
// We re-implement the pure functions here since the module is an IIFE.
// In production, these would be extracted into a shared utils module.

function timestampToSeconds(ts) {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function isHeading(el) {
  if (!el) return false;
  if (['H1', 'H2', 'H3'].includes(el.tagName)) return true;
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

// --- Tests ---
describe('Content Bridge Utilities', () => {
  describe('timestampToSeconds', () => {
    test('parses MM:SS format', () => {
      expect(timestampToSeconds('2:30')).toBe(150);
    });

    test('parses H:MM:SS format', () => {
      expect(timestampToSeconds('1:23:45')).toBe(5025);
    });

    test('parses 0:00', () => {
      expect(timestampToSeconds('0:00')).toBe(0);
    });

    test('parses single number', () => {
      expect(timestampToSeconds('45')).toBe(45);
    });

    test('handles edge case 10:05', () => {
      expect(timestampToSeconds('10:05')).toBe(605);
    });
  });

  describe('isHeading', () => {
    test('returns true for H1', () => {
      const h1 = document.createElement('h1');
      expect(isHeading(h1)).toBe(true);
    });

    test('returns true for H2', () => {
      const h2 = document.createElement('h2');
      expect(isHeading(h2)).toBe(true);
    });

    test('returns true for H3', () => {
      const h3 = document.createElement('h3');
      expect(isHeading(h3)).toBe(true);
    });

    test('returns false for P', () => {
      const p = document.createElement('p');
      expect(isHeading(p)).toBe(false);
    });

    test('returns true for Wikipedia mw-heading', () => {
      const div = document.createElement('div');
      div.classList.add('mw-heading');
      expect(isHeading(div)).toBe(true);
    });

    test('returns false for null', () => {
      expect(isHeading(null)).toBe(false);
    });
  });

  describe('findDeep', () => {
    test('finds top-level key', () => {
      const obj = { target: 'found' };
      expect(findDeep(obj, 'target')).toEqual(['found']);
    });

    test('finds deeply nested keys', () => {
      const obj = { a: { b: { target: 'deep' } } };
      expect(findDeep(obj, 'target')).toEqual(['deep']);
    });

    test('finds multiple occurrences', () => {
      const obj = { target: 'one', a: { target: 'two' } };
      expect(findDeep(obj, 'target')).toEqual(['one', 'two']);
    });

    test('returns empty for missing key', () => {
      expect(findDeep({ a: 1 }, 'missing')).toEqual([]);
    });

    test('handles null input', () => {
      expect(findDeep(null, 'key')).toEqual([]);
    });
  });
});

describe('Article Detection (DOM-based)', () => {
  test('detects headings from a structured article', () => {
    document.body.innerHTML = `
      <h1>Main Title</h1>
      <h2>Introduction</h2>
      <p>Some intro text.</p>
      <h2>Methods</h2>
      <p>Methods description.</p>
      <h2>Results</h2>
      <p>Results discussion.</p>
    `;

    const headings = Array.from(document.querySelectorAll('h2'));
    expect(headings.length).toBe(3);
    expect(headings.map(h => h.textContent.trim())).toEqual(['Introduction', 'Methods', 'Results']);
  });

  test('skips headings inside nav/footer', () => {
    document.body.innerHTML = `
      <nav><h2>Navigation Header</h2></nav>
      <h2>Real Content</h2>
      <p>Actual article content.</p>
      <footer><h3>Footer Link</h3></footer>
    `;

    const allH = Array.from(document.querySelectorAll('h2, h3'));
    const filtered = allH.filter(h => !h.closest('nav, footer, aside'));
    expect(filtered.length).toBe(1);
    expect(filtered[0].textContent.trim()).toBe('Real Content');
  });
});

describe('YouTube Description Chapter Parsing', () => {
  function extractChaptersFromText(text) {
    const chapters = [];
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

  test('parses standard chapter list', () => {
    const desc = `
      0:00:00 Introduction
      0:02:30 Setup
      0:05:15 Main Topic
      0:10:00 Conclusion
    `;
    const chapters = extractChaptersFromText(desc);
    expect(chapters.length).toBe(4);
    expect(chapters[0].title).toBe('Introduction');
    expect(chapters[1].seconds).toBe(150);
  });

  test('returns empty for no timestamps', () => {
    const desc = 'This is a video about cooking. No chapters here!';
    expect(extractChaptersFromText(desc).length).toBe(0);
  });
});
