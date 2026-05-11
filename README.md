# 📖 Guided Learning Sandbox

A Chrome extension that transforms any YouTube video or web article into an interactive, AI-guided study session — right from your browser's side panel.

## ✨ Features

- **Side Panel Interface** — Opens alongside the page you're studying, not in a separate tab
- **YouTube Support** — Detects video chapters automatically, or uses Gemini AI to create timed sections from the transcript
- **Article Support** — Reads the heading structure of any webpage (Wikipedia, blogs, news) and builds sections
- **AI-Generated Questions** — After reviewing each section, get a thoughtful comprehension question powered by Gemini
- **Answer Validation** — Submit your answer and receive encouraging, accurate feedback
- **Follow-up Chat** — Ask any follow-up questions within a conversational chat scoped to the current section
- **Page Navigation** — Click a section in the side panel to scroll the article or seek the video to that point
- **Zero Footprint** — When the panel is closed, the extension releases all memory and event listeners

## 🏗️ Architecture

```
┌──────────────────────┐     ┌──────────────────────┐
│   Original Page      │     │   Chrome Side Panel   │
│  (YouTube / Article) │◄───►│  (Guided Learning UI) │
│                      │     │                       │
│  content_bridge.js   │     │  sidepanel.html/css/js │
│  - Detects chapters  │     │  - Section navigation  │
│  - Reads headings    │     │  - Question/answer     │
│  - Seeks video       │     │  - Follow-up chat      │
│  - Scrolls page      │     │  - Progress tracking   │
└──────────────────────┘     └───────────┬───────────┘
                                         │
                              ┌──────────▼──────────┐
                              │   Gemini API         │
                              │  (gemini_api.js)     │
                              │  - Section summaries  │
                              │  - Question generation│
                              │  - Answer validation   │
                              │  - Chat responses      │
                              └─────────────────────┘
```

### File Structure

```
chrome/
├── manifest.json                 # Extension config (Manifest V3)
├── scripts/
│   ├── background.js             # Service worker: opens side panel, proxies CORS
│   ├── content_bridge.js         # Content script: page detection & navigation
│   ├── gemini_api.js             # Gemini API client with retry & Gemma support
│   ├── sidepanel.js              # Side panel UI logic, state, Gemini integration
│   └── options.js                # Options page: API key management
├── src/
│   ├── sidepanel.html            # Side panel markup
│   ├── sidepanel.css             # Sepia-themed UI styles
│   ├── options.html              # API key settings page
│   └── options.css               # Options page styles
├── tests/
│   ├── gemini_api.test.js        # GeminiClient unit tests
│   ├── content_bridge.test.js    # Utility & DOM detection tests
│   └── manifest.test.js          # Manifest validation tests
└── .github/workflows/ci.yml     # CI/CD pipeline
```

## 🚀 Getting Started

### Prerequisites

- Google Chrome (version 114+)
- A [Google Gemini API key](https://aistudio.google.com/apikey)

### Installation (Development)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/guided-learning-sandbox.git
   cd guided-learning-sandbox/chrome
   ```

2. **Install dev dependencies** (for testing only — not needed for the extension itself):
   ```bash
   npm install
   ```

3. **Load the extension in Chrome:**
   - Navigate to `chrome://extensions`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked** and select the `chrome/` directory

4. **Configure your API key:**
   - Click the extension icon → "Options"
   - Enter your Gemini API key (starts with `AIza...`)
   - Click Save

### Usage

1. Navigate to any YouTube video or web article
2. Click the extension icon in your toolbar
3. The side panel opens with detected sections
4. Read/watch the content on the original page
5. Click **"Mark as Reviewed"** when you finish each section
6. Answer the AI-generated question
7. Ask follow-up questions in the chat area
8. Click **"Next Section →"** to continue

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Watch mode during development
npm run test:watch
```

### Test Coverage

| File | What's Tested |
|------|--------------|
| `gemini_api.test.js` | Client initialization, schema conversion, JSON parsing, retry logic, error handling |
| `content_bridge.test.js` | Timestamp parsing, heading detection, deep object search, DOM-based article detection |
| `manifest.test.js` | MV3 compliance, CWS naming limits, permission safety, file existence |

## 🔧 Configuration

### Supported Models

The extension uses `gemini-2.5-flash` by default. The `GeminiClient` also supports Gemma models (with automatic prompt reformatting).

### Content Detection

| Source | Detection Method |
|--------|-----------------|
| YouTube (with chapters) | Reads chapter markers from the DOM or video description |
| YouTube (no chapters) | Extracts transcript → Gemini segments it into 3-7 timed sections |
| Articles (Wikipedia, blogs) | Scans `h1/h2/h3` headings, filters out nav/footer/sidebar |
| Unstructured pages | Falls back to a single section from the main content area |

## 📦 Building for Chrome Web Store

```bash
# Create a distribution-ready ZIP
zip -r guided-learning-sandbox.zip \
  manifest.json scripts/ src/ assets/ \
  -x "*.DS_Store" -x "node_modules/*" -x "tests/*" -x ".git/*"
```

Then upload to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## 🛡️ Privacy & Performance

- **No persistent storage**: All session data lives in ephemeral side panel memory
- **No tracking**: The extension never sends analytics or telemetry
- **Minimal permissions**: Only `activeTab`, `storage`, `scripting`, `tabs`, `sidePanel`
- **Zero background cost**: The service worker auto-suspends after 30s of inactivity
- **Clean teardown**: Closing the panel sends a `CLEANUP` signal to unregister all injected listeners

## 📄 License

MIT
