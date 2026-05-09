// study.js - Core UI Logic and State Management

// Local testing fallback for browser_subagent testing
if (typeof chrome === 'undefined' || !chrome.storage) {
  window.chrome = {
    storage: {
      sync: { get: (keys, cb) => setTimeout(() => cb({ geminiApiKey: 'mock-key' }), 100) },
      local: { get: (keys, cb) => setTimeout(() => cb({ currentStudySession: { type: 'article', title: 'Local Test', content: 'This is a local test content.' } }), 100) }
    }
  };
}

let state = {
  currentIndex: 0,
  sections: [],
  sessionData: null,
  apiKey: null,
  ytPlayer: null
};

// UI Elements
const els = {
  resourceTitle: document.getElementById('resourceTitle'),
  resourceContent: document.getElementById('resourceContent'),
  progressText: document.getElementById('progressText'),
  progressBar: document.getElementById('progressBar'),
  sectionSummary: document.getElementById('sectionSummary'),
  markReviewedBtn: document.getElementById('markReviewedBtn'),
  questionArea: document.getElementById('questionArea'),
  questionText: document.getElementById('questionText'),
  answerInput: document.getElementById('answerInput'),
  submitAnswerBtn: document.getElementById('submitAnswerBtn'),
  validationHint: document.getElementById('validationHint'),
  tutorLoader: document.getElementById('tutorLoader')
};

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  // Load API Key
  chrome.storage.sync.get(['geminiApiKey'], (res) => {
    if (!res.geminiApiKey) {
      showError("API Key is missing. Please configure it in the extension settings.");
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
    
    renderResourceViewer();
    startSectionerPipeline();
  });
}

function renderResourceViewer() {
  if (state.sessionData.type === 'youtube') {
    els.resourceContent.innerHTML = `<div class="video-container"><div id="yt-player-target"></div></div>`;
    
    // Load YouTube IFrame API
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    
    window.onYouTubeIframeAPIReady = () => {
      state.ytPlayer = new YT.Player('yt-player-target', {
        videoId: state.sessionData.videoId,
        playerVars: { 'playsinline': 1, 'autoplay': 0 },
        events: { 'onReady': () => console.log("YT Player ready") }
      });
    };
  } else {
    // Standard Article
    els.resourceContent.innerHTML = `<p>${state.sessionData.content.replace(/\\n/g, '<br>')}</p>`;
  }
}

function updateUI() {
  if (state.sections.length === 0) return;
  
  const current = state.sections[state.currentIndex];
  els.progressText.textContent = `Section ${state.currentIndex + 1} of ${state.sections.length}`;
  els.progressBar.style.width = `${((state.currentIndex + 1) / state.sections.length) * 100}%`;
  
  els.sectionSummary.innerHTML = `<strong>${current.title}</strong><br><br>${current.summary}`;
  
  // Reset tutor area
  els.questionArea.classList.remove('active');
  els.markReviewedBtn.style.display = 'flex';
  els.answerInput.value = '';
  els.validationHint.style.display = 'none';
  
  // Sync YouTube if applicable
  if (state.ytPlayer && current.startTimestamp) {
    state.ytPlayer.seekTo(current.startTimestamp);
  }
}

function showError(msg) {
  els.resourceTitle.textContent = "Error";
  els.resourceContent.innerHTML = `<div style="color:#ef4444; padding:20px;">${msg}</div>`;
  els.sectionSummary.textContent = "Cannot proceed.";
  els.tutorLoader.classList.remove('active');
}

function showLoader(text) {
  els.tutorLoader.querySelector('div:last-child').textContent = text;
  els.tutorLoader.classList.add('active');
}
function hideLoader() { els.tutorLoader.classList.remove('active'); }

function showValidationHint(msg, isSuccess) {
  els.validationHint.textContent = msg;
  els.validationHint.className = 'validation-hint ' + (isSuccess ? 'success' : 'error');
  
  // Trigger reflow to restart animation
  void els.validationHint.offsetWidth;
}

// ------------------------------------------------------------------
// MOCK AI PIPELINE (To be replaced in Workflows A, B, C, D)
// ------------------------------------------------------------------

async function startSectionerPipeline() {
  showLoader("Gemini is analyzing and segmenting the content...");
  
  try {
    const client = new GeminiClient(state.apiKey);
    
    // Format the payload for the prompt
    let contentContext = "";
    if (state.sessionData.type === 'youtube') {
      // It's an array of transcript objects
      contentContext = state.sessionData.content.map(c => `[${c.startTimestamp}s]: ${c.text}`).join('\\n');
    } else {
      contentContext = state.sessionData.content;
    }

    const systemInstruction = `You are an expert tutor. Your task is to analyze the provided educational material and break it down into 3 to 5 logical sections for a structured learning session.
For each section, provide a concise but descriptive title, and a 2-3 sentence summary of the core concepts covered in that section.
If the material has timestamps (like a YouTube transcript), extract the accurate starting timestamp for that section. If it's a standard article, set startTimestamp to 0.`;

    const prompt = `Please segment the following content into a learning curriculum.\\n\\nContent:\\n${contentContext}`;

    const responseSchema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Short, descriptive title of the section." },
          summary: { type: "STRING", description: "A robust 2-3 sentence summary of what this section teaches." },
          startTimestamp: { type: "NUMBER", description: "The starting timestamp in seconds. Use 0 if it is an article." }
        },
        required: ["title", "summary", "startTimestamp"]
      }
    };

    const sections = await client.generateContent(prompt, systemInstruction, responseSchema);
    
    state.sections = sections;
    hideLoader();
    updateUI();

  } catch (error) {
    console.error("Sectioning failed:", error);
    showError("Failed to segment content: " + error.message);
  }
}

els.markReviewedBtn.addEventListener('click', async () => {
  els.markReviewedBtn.style.display = 'none';
  showLoader("Generating active-recall question...");
  
  try {
    const client = new GeminiClient(state.apiKey);
    const currentSection = state.sections[state.currentIndex];
    
    // We provide the section summary as context. If the summary is too brief, 
    // we could also provide the full contentContext, but the summary is usually enough for a targeted question.
    const systemInstruction = `You are a strict but encouraging tutor. Based on the provided section summary, generate a single, thought-provoking active recall question that tests the user's deep understanding of the core concept. Do not ask simple true/false questions. Ask 'Why' or 'How' questions.`;
    
    const prompt = `Section Title: ${currentSection.title}\\nSection Summary: ${currentSection.summary}\\n\\nPlease generate the question.`;
    
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

els.submitAnswerBtn.addEventListener('click', async () => {
  const ans = els.answerInput.value.trim();
  if (!ans) return;
  
  showLoader("Validating answer...");
  
  try {
    const client = new GeminiClient(state.apiKey);
    const currentSection = state.sections[state.currentIndex];
    const questionAsked = els.questionText.textContent;
    
    const systemInstruction = `You are a fair but rigorous tutor grading a student's answer.
Evaluate the student's answer based on the section summary and the specific question asked.
Determine if the student has demonstrated a solid understanding. If the answer is vague or incorrect, isCorrect should be false, and you must provide a helpful 'feedback' hint to guide them. If the answer is correct, isCorrect should be true, and 'feedback' should be a short encouraging message.`;
    
    const prompt = `Section Summary: ${currentSection.summary}\\nQuestion Asked: ${questionAsked}\\nStudent's Answer: ${ans}\\n\\nPlease grade the answer.`;
    
    const responseSchema = {
      type: "OBJECT",
      properties: {
        isCorrect: { type: "BOOLEAN", description: "True if the student's answer demonstrates sufficient understanding." },
        feedback: { type: "STRING", description: "Hint if incorrect, or praise if correct." }
      },
      required: ["isCorrect", "feedback"]
    };

    const response = await client.generateContent(prompt, systemInstruction, responseSchema);
    
    hideLoader();
    
    if (response.isCorrect) {
      showValidationHint(response.feedback + " Moving to the next section...", true);
      setTimeout(() => {
        if (state.currentIndex < state.sections.length - 1) {
          state.currentIndex++;
          updateUI();
        } else {
          els.sectionSummary.innerHTML = "<strong>Module Complete!</strong><br>You have successfully mastered this material.";
          els.questionArea.classList.remove('active');
          els.validationHint.style.display = 'none';
          
          // Clear current session so they can start a new one next time
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.remove(['currentStudySession', 'currentStudySessionError']);
          }
        }
      }, 2500);
    } else {
      showValidationHint("Hint: " + response.feedback, false);
    }

  } catch (error) {
    console.error("Failed to validate answer:", error);
    hideLoader();
    showValidationHint("Failed to validate: " + error.message, false);
  }
});
