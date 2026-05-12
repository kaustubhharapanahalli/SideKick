// sidepanel.js — Side Panel UI Logic, State, Gemini Integration

'use strict';

// ================================================================
// STATE
// ================================================================
/**
 * Sidekick - AI-Powered Study Companion
 * © 2026 Kaustubh Harapanahalli. All rights reserved.
 * 
 * sidepanel.js — Main UI Logic
 */
const state = {
  pageData: null,      // Raw data from content_bridge
  sections: [],        // [{title, summary, textPreview, startSeconds?, elementIndex?}]
  currentIndex: 0,
  apiKey: null,
  tabId: null,
  failedAttempts: 0,
  chatHistory: [],     // [{role: 'user'|'tutor', text}]
  sectionCompleted: new Set(), // Indices of sections that have been fully completed (Q&A done)
  currentQuestion: null,
  currentAnswer: null,
  questionCache: new Map() // index → Promise<{hasEnoughContent, question, idealAnswer}>
};

// ================================================================
// DOM REFS
// ================================================================
const els = {
  headerStatus:     document.getElementById('headerStatus'),
  pageTypeBadge:    document.getElementById('pageTypeBadge'),
  pageTitle:        document.getElementById('pageTitle'),
  progressTrack:    document.getElementById('progressTrack'),
  progressFill:     document.getElementById('progressFill'),
  panelBody:        document.getElementById('panelBody'),
  // States
  stateLoading:     document.getElementById('stateLoading'),
  stateError:       document.getElementById('stateError'),
  stateSections:    document.getElementById('stateSections'),
  stateComplete:    document.getElementById('stateComplete'),
  loaderText:       document.getElementById('loaderText'),
  errorText:        document.getElementById('errorText'),
  retryBtn:         document.getElementById('retryBtn'),
  // Sections
  sectionListToggle: document.getElementById('sectionListToggle'),
  sectionList:      document.getElementById('sectionList'),
  sectionCount:     document.getElementById('sectionCount'),
  sectionLabel:     document.getElementById('sectionLabel'),
  sectionTitle:     document.getElementById('sectionTitle'),
  sectionSummary:   document.getElementById('sectionSummary'),
  timestampHint:    document.getElementById('timestampHint'),
  timestampText:    document.getElementById('timestampText'),
  markReviewedBtn:  document.getElementById('markReviewedBtn'),
  // Question
  questionArea:     document.getElementById('questionArea'),
  questionText:     document.getElementById('questionText'),
  answerInput:      document.getElementById('answerInput'),
  submitAnswerBtn:  document.getElementById('submitAnswerBtn'),
  revealAnswerBtn:  document.getElementById('revealAnswerBtn'),
  validationHint:   document.getElementById('validationHint'),
  // Chat
  chatArea:         document.getElementById('chatArea'),
  chatMessages:     document.getElementById('chatMessages'),
  chatInput:        document.getElementById('chatInput'),
  chatSendBtn:      document.getElementById('chatSendBtn'),
  // Next / Complete
  nextSectionBtn:   document.getElementById('nextSectionBtn'),
  restartBtn:       document.getElementById('restartBtn')
};

// ================================================================
// INITIALIZATION
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Get API key
  chrome.storage.sync.get(['geminiApiKey'], (res) => {
    state.apiKey = res.geminiApiKey;
    if (!state.apiKey) {
      showError('API Key is missing. Please configure it in the extension Options page.');
      return;
    }
    // Start detection
    startDetection();
  });
});

window.addEventListener('unload', () => {
  // Notify the content script to unregister its listeners when panel closes
  if (state.tabId) {
    chrome.tabs.sendMessage(state.tabId, { type: 'CLEANUP' }).catch(() => {});
  }
  state.questionCache.clear();
});

async function startDetection() {
  showState('loading');
  els.loaderText.textContent = 'Detecting page content...';

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      showError('No active tab found.');
      return;
    }

    state.tabId = tab.id;

    // Prevent running on restricted URLs
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      showError('Cannot analyze this page. Navigate to a YouTube video or article.');
      return;
    }

    // Inject the content bridge
    await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      files: ['scripts/content_bridge.js']
    });

    // Small delay for script to initialize
    await sleep(500);

    // Request page detection
    const pageData = await sendToTab('DETECT_PAGE');

    if (!pageData || pageData.error) {
      showError(pageData?.error || 'Could not detect page content.');
      return;
    }

    state.pageData = pageData;
    els.pageTitle.textContent = pageData.title;

    if (pageData.type === 'youtube') {
      els.pageTypeBadge.textContent = 'YOUTUBE';
      els.pageTypeBadge.classList.add('youtube');
    } else {
      els.pageTypeBadge.textContent = 'ARTICLE';
    }

    // Process sections
    await processSections();

  } catch (err) {
    showError('Failed to analyze page: ' + err.message);
  }
}

// ================================================================
// SECTION PROCESSING
// ================================================================
async function processSections() {
  els.loaderText.textContent = 'Analyzing content structure...';

  const pd = state.pageData;

  if (pd.type === 'youtube') {
    if (pd.hasChapters && pd.chapters.length > 0) {
      // YouTube with chapters — slice transcript per chapter window for Q&A context
      state.sections = pd.chapters.map((ch, i) => {
        const startSec = ch.seconds;
        const endSec = pd.chapters[i + 1]?.seconds || null;

        // Slice transcript entries that fall within this chapter's time window
        const chapterText = (pd.transcript || [])
          .filter(t => t.start >= startSec && (endSec === null || t.start < endSec))
          .map(t => t.text)
          .join(' ');

        return {
          title: ch.title,
          summary: '',
          startSeconds: startSec,
          endSeconds: endSec,
          textPreview: chapterText.substring(0, 3000)
        };
      });
    } else if (pd.transcript && pd.transcript.length > 0) {
      // YouTube without chapters — use Gemini to segment
      els.loaderText.textContent = 'Creating study sections from transcript...';
      await geminiSegmentTranscript(pd.transcript);
    } else {
      showError('No chapters or transcript found for this video. The video may not have captions.');
      return;
    }
  } else {
    // Article — use detected headings
    if (pd.sections && pd.sections.length > 0) {
      state.sections = pd.sections.map(s => ({
        title: s.title,
        summary: '',
        textPreview: s.textPreview,
        elementIndex: s.elementIndex
      }));
    } else {
      showError('No structured content found on this page.');
      return;
    }
  }

  // Generate summaries with Gemini
  els.loaderText.textContent = 'Generating section summaries...';
  await geminiGenerateSummaries();

  // Show the sections UI
  showState('sections');
  updateUI();

  // Kick off prefetch for section 0 immediately in the background.
  // The user is now reading — by the time they click Mark as Reviewed
  // the question will almost certainly be ready.
  prefetchQuestion(0);
}

async function geminiSegmentTranscript(transcript) {
  const client = new GeminiClient(state.apiKey);

  const transcriptText = transcript
    .map(t => `[${formatTime(t.start)}] ${t.text}`)
    .join('\n');

  const systemInstruction = `You are an expert tutor. Analyze the provided YouTube transcript and break it into 3 to 7 logical topic-based sections. For each section, provide:
- title: A concise, descriptive section title
- summary: A 2-3 sentence summary of what is taught in this section
- startSeconds: The timestamp in seconds where this section begins`;

  const prompt = `Segment this transcript into learning sections:\n\n${transcriptText.substring(0, 15000)}`;

  const responseSchema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        summary: { type: "STRING" },
        startSeconds: { type: "NUMBER" }
      },
      required: ["title", "summary", "startSeconds"]
    }
  };

  try {
    const sections = await client.generateContent(prompt, systemInstruction, responseSchema);
    if (Array.isArray(sections) && sections.length > 0) {
      state.sections = sections.map((s, i) => {
        const startSec = s.startSeconds;
        const endSec = sections[i + 1]?.startSeconds || null;

        // Slice transcript entries for this section's time window
        const sectionTranscript = transcript
          .filter(t => t.start >= startSec && (endSec === null || t.start < endSec))
          .map(t => t.text)
          .join(' ');

        return {
          title: s.title,
          summary: s.summary,
          startSeconds: startSec,
          endSeconds: endSec,
          textPreview: sectionTranscript.substring(0, 3000)
        };
      });
    } else {
      throw new Error('Gemini returned no sections.');
    }
  } catch (e) {
    // Fallback: single section for the whole video
    state.sections = [{
      title: state.pageData.title,
      summary: 'Watch the full video and review.',
      startSeconds: 0,
      endSeconds: null,
      textPreview: transcriptText.substring(0, 3000)
    }];
  }
}

async function geminiGenerateSummaries() {
  // Skip if all sections already have summaries (from segmentation)
  if (state.sections.every(s => s.summary && s.summary.length > 10)) return;

  const client = new GeminiClient(state.apiKey);

  const sectionPreviews = state.sections.map((s, i) => {
    const preview = s.textPreview ? s.textPreview.substring(0, 500) : `Section titled "${s.title}"`;
    return `[Section ${i + 1}: "${s.title}"]\n${preview}`;
  }).join('\n\n---\n\n');

  const systemInstruction = `You are an expert tutor. For each section below, generate a 2-3 sentence summary of the key concepts. Keep summaries concise and learning-oriented.`;

  const prompt = `Generate summaries for these ${state.sections.length} sections:\n\n${sectionPreviews}`;

  const responseSchema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        summary: { type: "STRING" }
      },
      required: ["title", "summary"]
    }
  };

  try {
    const summaries = await client.generateContent(prompt, systemInstruction, responseSchema);
    if (Array.isArray(summaries)) {
      summaries.forEach((s, i) => {
        if (state.sections[i] && (!state.sections[i].summary || state.sections[i].summary.length < 10)) {
          state.sections[i].summary = s.summary;
          // Optionally update title if Gemini gave a better one
          if (s.title && s.title.length > 3) {
            state.sections[i].title = s.title;
          }
        }
      });
    }
  } catch (e) {
    state.sections.forEach(s => {
      if (!s.summary) s.summary = 'Review this section and mark as reviewed when ready.';
    });
  }
}

// ================================================================
// UI RENDERING
// ================================================================
function updateUI() {
  if (state.sections.length === 0) return;

  const current = state.sections[state.currentIndex];
  const total = state.sections.length;

  // Progress
  els.progressTrack.style.display = 'block';
  els.progressFill.style.width = `${((state.currentIndex + 1) / total) * 100}%`;
  els.headerStatus.textContent = `Section ${state.currentIndex + 1} of ${total}`;

  // Section count
  els.sectionCount.textContent = total;

  // Section list
  renderSectionList();

  // Current section card
  els.sectionLabel.textContent = `SECTION ${state.currentIndex + 1}`;
  els.sectionTitle.textContent = current.title;
  els.sectionSummary.textContent = current.summary || 'Review this section.';

  // Timestamp hint (YouTube)
  if (current.startSeconds != null) {
    els.timestampHint.style.display = 'flex';
    const start = formatTime(current.startSeconds);
    const end = current.endSeconds ? formatTime(current.endSeconds) : 'end';
    els.timestampText.textContent = `Watch from ${start} to ${end}`;
  } else {
    els.timestampHint.style.display = 'none';
  }

  // Reset action area
  if (state.sectionCompleted.has(state.currentIndex)) {
    // Already completed — show chat, hide mark/question
    els.markReviewedBtn.style.display = 'none';
    els.questionArea.style.display = 'none';
    els.chatArea.style.display = 'block';
    els.nextSectionBtn.style.display = state.currentIndex < total - 1 ? 'flex' : 'none';
  } else {
    els.markReviewedBtn.style.display = 'flex';
    els.questionArea.style.display = 'none';
    els.chatArea.style.display = 'none';
    els.nextSectionBtn.style.display = 'none';
  }

  // Reset fields
  els.answerInput.value = '';
  els.validationHint.style.display = 'none';
  els.revealAnswerBtn.style.display = 'none';
  els.submitAnswerBtn.style.display = '';
  els.submitAnswerBtn.disabled = false;
  state.failedAttempts = 0;
  state.chatHistory = [];
  els.chatMessages.innerHTML = '';
}

function renderSectionList() {
  const isYouTube = state.pageData?.type === 'youtube';

  els.sectionList.innerHTML = state.sections.map((s, i) => {
    const isActive = i === state.currentIndex;
    const isCompleted = state.sectionCompleted.has(i);
    const isLocked = isYouTube && !isCompleted && i > state.currentIndex;

    let cls = 'section-item';
    if (isActive) cls += ' active';
    if (isCompleted) cls += ' completed';
    if (isLocked) cls += ' locked';

    const icon = isCompleted ? '✓' : (i + 1);

    return `<button class="${cls}" data-index="${i}">
      <span class="section-num">${icon}</span>
      <span class="section-item-label">${s.title}</span>
    </button>`;
  }).join('');

  // Click handlers
  els.sectionList.querySelectorAll('.section-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const isLocked = btn.classList.contains('locked');
      if (isLocked) return;

      state.currentIndex = idx;
      updateUI();

      // Navigate on the actual page
      navigateToSection(idx);
    });
  });
}

// ================================================================
// SECTION NAVIGATION (on the actual page)
// ================================================================
function navigateToSection(index) {
  const section = state.sections[index];

  if (state.pageData.type === 'youtube' && section.startSeconds != null) {
    // Seek YouTube video
    sendToTab('SEEK_VIDEO', { seconds: section.startSeconds });
  } else if (section.elementIndex != null && section.elementIndex >= 0) {
    // Scroll to article heading
    sendToTab('SCROLL_TO_HEADING', { elementIndex: section.elementIndex });
  }

  // Prefetch question for this section and the next one in the background
  prefetchQuestion(index);
  if (index + 1 < state.sections.length) {
    prefetchQuestion(index + 1);
  }
}

// ================================================================
// ASYNC QUESTION PRE-FETCHING
// ================================================================

/**
 * Kicks off a Gemini question-generation request for section at `index`.
 * The result is cached in state.questionCache so that markReviewedBtn
 * can await it instantly if the request already completed.
 * Calling this multiple times for the same index is safe — the cached
 * Promise is returned immediately on subsequent calls.
 */
function prefetchQuestion(index) {
  if (state.questionCache.has(index)) return state.questionCache.get(index);

  const section = state.sections[index];
  if (!section || !state.apiKey) return;

  const contentText = section.textPreview
    ? section.textPreview.substring(0, 3000)
    : '';
  const context = [
    contentText,
    section.summary ? `Section Summary: ${section.summary}` : ''
  ].filter(Boolean).join('\n\n');

  // Gate: if there is no meaningful content, skip Q&A entirely.
  // We decide this in code rather than asking Gemini, which tends to be
  // overly conservative when classifying content as "not enough".
  const hasContent = context.trim().length > 150;

  const promise = (async () => {
    if (!hasContent) {
      return { skip: true };
    }

    try {
      const client = new GeminiClient(state.apiKey);

      const systemInstruction = `You are an expert tutor. Given the content of a learning section, generate ONE specific and targeted question that tests the reader's understanding of the key idea, concept, or process described. The question should be directly answerable from the provided content. Also provide the ideal answer.`;

      const prompt = `Section Title: "${section.title}"\n\nSection Content:\n${context}\n\nGenerate a question and ideal answer based on this content.`;

      const responseSchema = {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          idealAnswer: { type: 'STRING' }
        },
        required: ['question', 'idealAnswer']
      };

      const result = await client.generateContent(prompt, systemInstruction, responseSchema);
      return { skip: false, question: result.question, idealAnswer: result.idealAnswer };
    } catch (_) {
      // Graceful fallback — always resolves so markReviewedBtn never hangs
      return {
        skip: false,
        question: `What is the main concept covered in the "${section.title}" section?`,
        idealAnswer: section.summary || 'Review the key concepts from this section.'
      };
    }
  })();

  state.questionCache.set(index, promise);
  return promise;
}

// ================================================================
// MARK AS REVIEWED → SHOW QUESTION (from pre-fetched cache)
// ================================================================
els.markReviewedBtn.addEventListener('click', async () => {
  els.markReviewedBtn.style.display = 'none';

  els.questionArea.style.display = 'block';
  els.submitAnswerBtn.disabled = true;

  const idx = state.currentIndex;

  // Ensure a prefetch is running (guards against edge cases where it wasn't started yet)
  const questionPromise = prefetchQuestion(idx);

  // If the promise resolved already this will be instant; otherwise show a brief wait message
  const isReady = await Promise.race([
    questionPromise.then(() => true),
    new Promise(r => setTimeout(() => r(false), 50))
  ]);

  if (!isReady) {
    els.questionText.textContent = 'Just a moment...';
  }

  // Await the real result (instant if already resolved)
  const result = await questionPromise;

  if (result.skip) {
    // Thin section with no meaningful content — auto-complete without Q&A
    els.questionArea.style.display = 'none';
    onSectionCompleted();
    return;
  }

  state.currentQuestion = result.question;
  state.currentAnswer = result.idealAnswer;
  els.questionText.textContent = result.question;
  els.submitAnswerBtn.disabled = false;

  // Pre-fetch next section's question now (user is about to start answering this one)
  if (idx + 1 < state.sections.length) {
    prefetchQuestion(idx + 1);
  }
});

// ================================================================
// SUBMIT ANSWER → VALIDATE
// ================================================================
els.submitAnswerBtn.addEventListener('click', async () => {
  const answer = els.answerInput.value.trim();
  if (!answer) return;

  els.submitAnswerBtn.disabled = true;
  els.validationHint.style.display = 'block';
  els.validationHint.className = 'validation-hint info';
  els.validationHint.textContent = 'Evaluating your answer...';

  try {
    const client = new GeminiClient(state.apiKey);

    const systemInstruction = `You are a supportive tutor. Evaluate the student's answer against the ideal answer. Be encouraging but accurate. If the answer is mostly correct, say so. If it's wrong, give a helpful hint without revealing the full answer. Respond with isCorrect (boolean) and feedback (string).`;

    const prompt = `Question: ${state.currentQuestion}\nIdeal Answer: ${state.currentAnswer}\nStudent's Answer: ${answer}`;

    const responseSchema = {
      type: "OBJECT",
      properties: {
        isCorrect: { type: "BOOLEAN" },
        feedback: { type: "STRING" }
      },
      required: ["isCorrect", "feedback"]
    };

    const result = await client.generateContent(prompt, systemInstruction, responseSchema);

    if (result.isCorrect) {
      els.validationHint.className = 'validation-hint success';
      els.validationHint.textContent = result.feedback;
      onSectionCompleted();
    } else {
      state.failedAttempts++;
      els.validationHint.className = 'validation-hint error';
      els.validationHint.textContent = result.feedback;
      els.submitAnswerBtn.disabled = false;

      if (state.failedAttempts >= 2) {
        els.revealAnswerBtn.style.display = 'block';
      }
    }

  } catch (e) {
    els.validationHint.className = 'validation-hint error';
    els.validationHint.textContent = 'Could not validate answer. Please try again.';
    els.submitAnswerBtn.disabled = false;
  }
});

// Reveal answer
els.revealAnswerBtn.addEventListener('click', () => {
  els.validationHint.className = 'validation-hint info';
  els.validationHint.innerHTML = `<strong>Answer:</strong> ${state.currentAnswer}`;
  els.revealAnswerBtn.style.display = 'none';
  els.submitAnswerBtn.style.display = 'none';
  onSectionCompleted();
});

function onSectionCompleted() {
  state.sectionCompleted.add(state.currentIndex);

  // Show chat area + next button
  els.chatArea.style.display = 'block';
  els.nextSectionBtn.style.display = state.currentIndex < state.sections.length - 1 ? 'flex' : 'none';

  // Add initial tutor message to chat
  addChatMessage('tutor', 'Great work on this section! Feel free to ask any follow-up questions about what you just learned.');

  // If it was the last section, show completion
  if (state.currentIndex === state.sections.length - 1 && state.sectionCompleted.size === state.sections.length) {
    setTimeout(() => showState('complete'), 1000);
  }

  // Update the section list to show completion
  renderSectionList();
}

// ================================================================
// NEXT SECTION
// ================================================================
els.nextSectionBtn.addEventListener('click', () => {
  if (state.currentIndex < state.sections.length - 1) {
    state.currentIndex++;
    updateUI();
    navigateToSection(state.currentIndex);
  }
});

// ================================================================
// CHAT (Follow-up Q&A)
// ================================================================
els.chatSendBtn.addEventListener('click', sendChatMessage);
els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

async function sendChatMessage() {
  const text = els.chatInput.value.trim();
  if (!text) return;

  els.chatInput.value = '';
  addChatMessage('user', text);

  // Show typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-msg tutor typing-dots';
  typingEl.innerHTML = '<span></span><span></span><span></span>';
  els.chatMessages.appendChild(typingEl);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

  try {
    const client = new GeminiClient(state.apiKey);
    const current = state.sections[state.currentIndex];

    // Build conversation context
    const chatContext = state.chatHistory
      .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.text}`)
      .join('\n');

    const systemInstruction = `You are a friendly, expert tutor. The student is learning about "${current.title}". Answer their question clearly and concisely. After answering, optionally ask a short follow-up question to deepen understanding. Keep responses under 150 words.`;

    const sectionContext = current.textPreview
      ? `Section content: ${current.textPreview.substring(0, 1500)}\n\n`
      : '';

    const prompt = `${sectionContext}Previous conversation:\n${chatContext}\n\nStudent asks: ${text}`;

    const response = await client.generateContent(prompt, systemInstruction);

    // Remove typing indicator
    typingEl.remove();

    addChatMessage('tutor', response);

  } catch (e) {
    typingEl.remove();
    addChatMessage('tutor', 'Sorry, I had trouble responding. Please try again.');
  }
}

function addChatMessage(role, text) {
  state.chatHistory.push({ role, text });

  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${role}`;
  msgEl.textContent = text;
  els.chatMessages.appendChild(msgEl);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

// ================================================================
// SECTION LIST TOGGLE
// ================================================================
els.sectionListToggle.addEventListener('click', () => {
  els.sectionListToggle.classList.toggle('collapsed');
  els.sectionList.classList.toggle('collapsed');
});

// ================================================================
// RETRY / RESTART
// ================================================================
els.retryBtn.addEventListener('click', () => {
  startDetection();
});

els.restartBtn.addEventListener('click', () => {
  state.sections = [];
  state.currentIndex = 0;
  state.sectionCompleted.clear();
  state.chatHistory = [];
  startDetection();
});

// ================================================================
// STATE MANAGEMENT
// ================================================================
function showState(name) {
  els.stateLoading.style.display = name === 'loading' ? 'flex' : 'none';
  els.stateError.style.display = name === 'error' ? 'block' : 'none';
  els.stateSections.style.display = name === 'sections' ? 'block' : 'none';
  els.stateComplete.style.display = name === 'complete' ? 'block' : 'none';
}

function showError(text) {
  showState('error');
  els.errorText.textContent = text;
  els.headerStatus.textContent = 'Error';
}

// ================================================================
// MESSAGING HELPERS
// ================================================================
function sendToTab(type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(state.tabId, { type, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
