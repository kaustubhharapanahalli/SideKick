// study.js - Core UI Logic and State Management

// Local testing fallback
if (typeof chrome === 'undefined' || !chrome.storage) {
  window.chrome = {
    storage: {
      sync: { get: (keys, cb) => setTimeout(() => cb({ geminiApiKey: 'mock-key' }), 100) },
      local: { get: (keys, cb) => setTimeout(() => cb({}), 100) }
    }
  };
}

// -------------------------------------------------------------------
// STATE
// -------------------------------------------------------------------
let state = {
  currentIndex: 0,
  sections: [],       // [{title, summary, rawTextChunk (article HTML) or startTimestamp (youtube)}]
  sessionData: null,   // raw payload from extractor
  apiKey: null,
  failedAttempts: 0
};

// -------------------------------------------------------------------
// DOM REFS
// -------------------------------------------------------------------
const els = {
  resourceTitle:   document.getElementById('resourceTitle'),
  resourceContent: document.getElementById('resourceContent'),
  progressText:    document.getElementById('progressText'),
  progressBar:     document.getElementById('progressBar'),
  sectionSummary:  document.getElementById('sectionSummary'),
  markReviewedBtn: document.getElementById('markReviewedBtn'),
  questionArea:    document.getElementById('questionArea'),
  questionText:    document.getElementById('questionText'),
  answerInput:     document.getElementById('answerInput'),
  submitAnswerBtn: document.getElementById('submitAnswerBtn'),
  revealAnswerBtn: document.getElementById('revealAnswerBtn'),
  validationHint:  document.getElementById('validationHint'),
  tutorLoader:     document.getElementById('tutorLoader')
};

// -------------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['geminiApiKey'], (res) => {
    if (!res.geminiApiKey) {
      showError("API Key is missing. Please configure it in the extension Options page.");
      return;
    }
    state.apiKey = res.geminiApiKey;
    loadSessionPayload();
  });
});

function loadSessionPayload() {
  chrome.storage.local.get(['currentStudySession', 'currentStudySessionError'], (res) => {
    if (res.currentStudySessionError) {
      showError("Extraction Error: " + res.currentStudySessionError);
      return;
    }
    if (!res.currentStudySession) {
      showError("No study session data found. Try extracting a page again.");
      return;
    }

    state.sessionData = res.currentStudySession;
    els.resourceTitle.textContent = state.sessionData.title;

    if (state.sessionData.type === 'youtube') {
      renderYouTubeViewer();
    }

    startSectionerPipeline();
  });
}

// -------------------------------------------------------------------
// YOUTUBE VIEWER
// -------------------------------------------------------------------
function renderYouTubeViewer() {
  if (!state.sessionData.videoId) {
    showError("Video ID could not be extracted.");
    return;
  }

  // Embed iframe with enablejsapi and origin for postMessage control
  const extensionOrigin = chrome.runtime.getURL('').slice(0, -1); // Remove trailing slash
  els.resourceContent.innerHTML = `
    <div class="video-container">
      <iframe id="yt-iframe"
              src="https://www.youtube.com/embed/${state.sessionData.videoId}?enablejsapi=1&origin=${encodeURIComponent(extensionOrigin)}&playsinline=1&rel=0"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen>
      </iframe>
    </div>`;

  // Set up the gating listener
  const iframe = document.getElementById('yt-iframe');
  iframe.onload = () => {
    // Tell YouTube we are listening
    iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), 'https://www.youtube.com');
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== 'https://www.youtube.com') return;
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data.event === 'infoDelivery' && data.info && data.info.currentTime != null) {
        handleYouTubeTimeUpdate(data.info.currentTime);
      }
    } catch (e) { /* Ignore non-JSON messages */ }
  });
}

function handleYouTubeTimeUpdate(currentTime) {
  if (state.sections.length === 0) return;
  if (state.currentIndex >= state.sections.length - 1) return;

  const nextSection = state.sections[state.currentIndex + 1];
  if (nextSection && nextSection.startTimestamp && currentTime >= nextSection.startTimestamp - 0.5) {
    // Pause the video at the section boundary
    const iframe = document.getElementById('yt-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'pauseVideo' }),
        'https://www.youtube.com'
      );
    }
    // Draw attention to the "Mark as Reviewed" button
    els.markReviewedBtn.classList.add('bounce');
    setTimeout(() => els.markReviewedBtn.classList.remove('bounce'), 600);
  }
}

function youtubeSeekTo(seconds) {
  const iframe = document.getElementById('yt-iframe');
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
      'https://www.youtube.com'
    );
    // Also play the video
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: 'playVideo' }),
      'https://www.youtube.com'
    );
  }
}

// -------------------------------------------------------------------
// ARTICLE RENDERING
// -------------------------------------------------------------------
function renderArticleSection(section) {
  if (section.rawTextChunk) {
    // rawTextChunk contains HTML from the extractor — render it directly
    els.resourceContent.innerHTML = `<div class="article-section-content">${section.rawTextChunk}</div>`;
  } else {
    els.resourceContent.innerHTML = `<div class="article-section-content"><p>${section.summary || 'No content available.'}</p></div>`;
  }
  els.resourceContent.scrollTop = 0;
}

// -------------------------------------------------------------------
// UI HELPERS
// -------------------------------------------------------------------
function updateUI() {
  if (state.sections.length === 0) return;

  const current = state.sections[state.currentIndex];

  // Progress
  els.progressText.textContent = `Section ${state.currentIndex + 1} of ${state.sections.length}`;
  els.progressBar.style.width = `${((state.currentIndex + 1) / state.sections.length) * 100}%`;

  // Summary
  els.sectionSummary.innerHTML = `<strong>${current.title}</strong><br><br>${current.summary}`;

  // Reset tutor area
  els.questionArea.classList.remove('active');
  els.markReviewedBtn.style.display = 'flex';
  els.answerInput.value = '';
  els.validationHint.className = 'validation-hint';
  els.validationHint.style.display = '';
  els.revealAnswerBtn.style.display = 'none';
  state.failedAttempts = 0;

  // Render content
  if (state.sessionData.type === 'youtube') {
    if (current.startTimestamp != null) {
      youtubeSeekTo(current.startTimestamp);
    }
  } else {
    renderArticleSection(current);
  }
}

function showError(msg) {
  els.resourceTitle.textContent = "Error";
  els.resourceContent.innerHTML = `<div style="color:#ef4444; padding:20px;">${msg}</div>`;
  els.sectionSummary.textContent = "Cannot proceed.";
  els.tutorLoader.classList.remove('active');
}

function showLoader(text) {
  const label = els.tutorLoader.querySelector('div:last-child');
  if (label) label.textContent = text;
  els.tutorLoader.classList.add('active');
}

function hideLoader() {
  els.tutorLoader.classList.remove('active');
}

function showValidationHint(msg, isSuccess) {
  els.validationHint.textContent = msg;
  els.validationHint.className = 'validation-hint ' + (isSuccess ? 'success' : 'error');
  els.validationHint.style.display = 'block';
  void els.validationHint.offsetWidth; // reflow to restart animation
}

// -------------------------------------------------------------------
// AI PIPELINE: Sectioner
// -------------------------------------------------------------------
async function startSectionerPipeline() {
  showLoader("Analyzing content structure...");

  try {
    const client = new GeminiClient(state.apiKey);
    const isYouTube = state.sessionData.type === 'youtube';

    if (isYouTube) {
      // YouTube: Use Gemini for intelligent topic-based segmentation
      const transcript = state.sessionData.content
        .map(c => `[${Math.floor(c.startTimestamp)}s] ${c.text}`)
        .join('\n');

      const systemInstruction = `You are an expert tutor. Analyze the provided YouTube transcript and break it down into 3 to 5 logical topic-based sections. For each section provide:
- title: A concise, descriptive section title
- summary: A 2-3 sentence summary of what this section covers
- startTimestamp: The timestamp (in seconds) where this section begins`;

      const prompt = `Segment this transcript into a learning curriculum:\n\n${transcript}`;

      const responseSchema = {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            summary: { type: "STRING" },
            startTimestamp: { type: "NUMBER" }
          },
          required: ["title", "summary", "startTimestamp"]
        }
      };

      state.sections = await client.generateContent(prompt, systemInstruction, responseSchema);

    } else {
      // Article: Sections are already split by the extractor!
      const sections = state.sessionData.sections;

      if (!sections || sections.length === 0) {
        throw new Error("No article sections were extracted. The page may not have structured content.");
      }

      // If we only got 1 section (nuclear fallback), skip the Gemini metadata call
      if (sections.length === 1) {
        state.sections = [{
          rawTextChunk: sections[0].html,
          title: sections[0].heading || state.sessionData.title,
          summary: "Read through this section and click Mark as Reviewed when ready.",
          startTimestamp: 0
        }];
      } else {
        // Use Gemini to generate summaries for each section
        // Send only the first 800 chars of each section's text for efficiency
        const sectionPreviews = sections.map((s, i) => {
          const tmp = document.createElement('div');
          tmp.innerHTML = s.html;
          const text = tmp.textContent.trim().substring(0, 800);
          return `[Section ${i + 1}: "${s.heading}"]\n${text}`;
        }).join('\n\n---\n\n');

        const systemInstruction = `You are an expert tutor. For each of the ${sections.length} article sections below, generate:
- title: A descriptive learning-oriented title
- summary: A 2-3 sentence summary of the key concepts in that section

Return exactly ${sections.length} items in the array, one per section.`;

        const prompt = `Generate titles and summaries for these article sections:\n\n${sectionPreviews}`;

        const responseSchema = {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "A descriptive title for this section" },
              summary: { type: "STRING", description: "A 2-3 sentence summary of the section" }
            },
            required: ["title", "summary"]
          }
        };

        let metadata = [];
        try {
          metadata = await client.generateContent(prompt, systemInstruction, responseSchema);
          if (!Array.isArray(metadata)) metadata = [];
        } catch (metaError) {
          console.warn("Gemini metadata generation failed, using headings as fallback:", metaError);
        }

        // Merge: extractor provides the HTML, Gemini provides the metadata
        state.sections = sections.map((section, i) => ({
          rawTextChunk: section.html,
          title: (metadata[i] && metadata[i].title) || section.heading || `Section ${i + 1}`,
          summary: (metadata[i] && metadata[i].summary) || "Review this section to proceed.",
          startTimestamp: 0
        }));
      }
    }

    hideLoader();

    // Show loading placeholder for articles until sections are ready
    if (!isYouTube) {
      els.resourceContent.innerHTML = '';
    }

    updateUI();

  } catch (error) {
    console.error("Sectioning failed:", error);
    showError("Failed to segment content: " + error.message);
  }
}

// -------------------------------------------------------------------
// AI PIPELINE: Questioner
// -------------------------------------------------------------------
els.markReviewedBtn.addEventListener('click', async () => {
  els.markReviewedBtn.style.display = 'none';
  showLoader("Generating question...");

  try {
    const client = new GeminiClient(state.apiKey);
    const current = state.sections[state.currentIndex];

    // Provide the actual content for better questions (not just the summary)
    let contentContext = current.summary;
    if (current.rawTextChunk) {
      const tmp = document.createElement('div');
      tmp.innerHTML = current.rawTextChunk;
      contentContext = tmp.textContent.trim().substring(0, 2000);
    }

    const systemInstruction = `You are a strict but encouraging tutor. Based on the provided section content, generate a single thought-provoking active recall question that tests deep understanding. Prefer "Why" or "How" questions over simple factual recall.`;

    const prompt = `Section: "${current.title}"\n\nContent:\n${contentContext}\n\nGenerate one question.`;

    const responseSchema = {
      type: "OBJECT",
      properties: {
        question: { type: "STRING", description: "The active recall question." }
      },
      required: ["question"]
    };

    const response = await client.generateContent(prompt, systemInstruction, responseSchema);

    els.questionText.textContent = response.question;
    hideLoader();
    els.questionArea.classList.add('active');

  } catch (error) {
    console.error("Failed to generate question:", error);
    showError("Failed to generate question: " + error.message);
  }
});

// -------------------------------------------------------------------
// AI PIPELINE: Validator
// -------------------------------------------------------------------
els.submitAnswerBtn.addEventListener('click', async () => {
  const ans = els.answerInput.value.trim();
  if (!ans) {
    showValidationHint("Please enter an answer before submitting.", false);
    return;
  }

  showLoader("Validating answer...");

  try {
    const client = new GeminiClient(state.apiKey);
    const current = state.sections[state.currentIndex];
    const questionAsked = els.questionText.textContent;

    const systemInstruction = `You are a fair but rigorous tutor grading a student's answer.
Evaluate whether the student demonstrates solid understanding of the topic.
- If the answer is vague, off-topic, or incorrect: set isCorrect to false and provide a helpful hint.
- If the answer shows genuine understanding: set isCorrect to true and provide brief encouragement.`;

    const prompt = `Section: "${current.title}"\nSummary: ${current.summary}\nQuestion: ${questionAsked}\nStudent's Answer: ${ans}\n\nGrade this answer.`;

    const responseSchema = {
      type: "OBJECT",
      properties: {
        isCorrect: { type: "BOOLEAN" },
        feedback: { type: "STRING" }
      },
      required: ["isCorrect", "feedback"]
    };

    const response = await client.generateContent(prompt, systemInstruction, responseSchema);
    hideLoader();

    if (response.isCorrect) {
      showValidationHint(response.feedback + " Moving to the next section...", true);
      setTimeout(() => advanceToNextSection(), 2500);
    } else {
      state.failedAttempts++;
      showValidationHint("Hint: " + response.feedback, false);
      if (state.failedAttempts >= 2) {
        els.revealAnswerBtn.style.display = 'block';
      }
    }

  } catch (error) {
    console.error("Failed to validate answer:", error);
    hideLoader();
    showValidationHint("Validation failed: " + error.message, false);
  }
});

// -------------------------------------------------------------------
// AI PIPELINE: Reveal Answer
// -------------------------------------------------------------------
els.revealAnswerBtn.addEventListener('click', async () => {
  showLoader("Generating model answer...");
  try {
    const client = new GeminiClient(state.apiKey);
    const current = state.sections[state.currentIndex];
    const questionAsked = els.questionText.textContent;

    const systemInstruction = "You are an expert tutor providing the correct answer. Keep it clear, educational, and under 3 sentences.";
    const prompt = `Section: "${current.title}"\nSummary: ${current.summary}\nQuestion: ${questionAsked}\n\nProvide the correct answer.`;

    const responseSchema = {
      type: "OBJECT",
      properties: {
        modelAnswer: { type: "STRING" }
      },
      required: ["modelAnswer"]
    };

    const response = await client.generateContent(prompt, systemInstruction, responseSchema);
    hideLoader();
    els.revealAnswerBtn.style.display = 'none';

    showValidationHint("Answer: " + response.modelAnswer, true);
    setTimeout(() => advanceToNextSection(), 5000);

  } catch (error) {
    console.error("Failed to reveal answer:", error);
    hideLoader();
    showValidationHint("Failed to reveal answer: " + error.message, false);
  }
});

// -------------------------------------------------------------------
// NAVIGATION
// -------------------------------------------------------------------
function advanceToNextSection() {
  if (state.currentIndex < state.sections.length - 1) {
    state.currentIndex++;
    updateUI();
  } else {
    // Module complete!
    els.sectionSummary.innerHTML = "<strong>🎉 Module Complete!</strong><br><br>You have successfully mastered this material.";
    els.questionArea.classList.remove('active');
    els.markReviewedBtn.style.display = 'none';
    els.validationHint.style.display = 'none';

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(['currentStudySession', 'currentStudySessionError']);
    }
  }
}
