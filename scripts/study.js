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
    
    // Set up YouTube listener for gating
    if (state.sessionData.type === 'youtube') {
      setupYouTubeGating();
    }
    
    renderResourceViewer();
    startSectionerPipeline();
  });
}

function setupYouTubeGating() {
  window.addEventListener('message', (event) => {
    if (event.origin !== 'https://www.youtube.com') return;
    try {
      const data = JSON.parse(event.data);
      if (data.event === 'infoDelivery' && data.info && data.info.currentTime) {
        const currentTime = data.info.currentTime;
        
        // If not the last section, check if we hit the boundary
        if (state.sections.length > 0 && state.currentIndex < state.sections.length - 1) {
          const nextTimestamp = state.sections[state.currentIndex + 1].startTimestamp;
          
          if (currentTime >= nextTimestamp - 0.5) {
            // Hit the boundary! Pause the video.
            const iframe = document.getElementById('yt-iframe');
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo' }), 'https://www.youtube.com');
            }
            
            // Optionally bounce the "Mark as Reviewed" button to draw attention
            els.markReviewedBtn.style.transform = 'scale(1.05)';
            setTimeout(() => els.markReviewedBtn.style.transform = '', 300);
          }
        }
      }
    } catch (e) {
      // Ignore parse errors from other postMessages
    }
  });
}

function renderResourceViewer() {
  if (state.sessionData.type === 'youtube') {
    if (!state.sessionData.videoId) {
      showError("Video ID could not be extracted. Please try extracting the video again.");
      return;
    }
    
    // In Manifest V3, we cannot load external scripts (like the YT IFrame API). 
    // Instead, we embed the iframe with enablejsapi=1 and use postMessage directly.
    els.resourceContent.innerHTML = `
      <div class="video-container">
        <iframe id="yt-iframe" 
                src="https://www.youtube.com/embed/${state.sessionData.videoId}?enablejsapi=1&playsinline=1" 
                frameborder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen>
        </iframe>
      </div>`;
      
    // Tell the iframe we are listening to its events once it loads
    const iframe = document.getElementById('yt-iframe');
    iframe.onload = () => {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), 'https://www.youtube.com');
    };
  } else {
    // For articles, we don't render the text yet until sections are ready!
    els.resourceContent.innerHTML = `<div style="text-align:center; padding:40px; color:#94A3B8;">Waiting for Gemini to segment the text...</div>`;
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
  if (state.sessionData.type === 'youtube' && current.startTimestamp !== undefined) {
    const iframe = document.getElementById('yt-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: 'seekTo',
        args: [current.startTimestamp, true]
      }), 'https://www.youtube.com');
    }
  } else if (state.sessionData.type === 'article' && current.rawTextChunk) {
    // Article Gating: Only render the current chunk!
    els.resourceContent.innerHTML = `<p>${current.rawTextChunk.replace(/\\n/g, '<br>')}</p>`;
    // Scroll back to top
    els.resourceContent.scrollTop = 0;
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
If the material has timestamps (like a YouTube transcript), extract the accurate starting timestamp for that section. If it's a standard article, set startTimestamp to 0.
Crucially, you must also provide the 'rawTextChunk'. This MUST be the exact, verbatim block of original text that corresponds to this section. Do not summarize the rawTextChunk, output the actual source text.`;

    const prompt = `Please segment the following content into a learning curriculum.\\n\\nContent:\\n${contentContext}`;

    const responseSchema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Short, descriptive title of the section." },
          summary: { type: "STRING", description: "A robust 2-3 sentence summary of what this section teaches." },
          startTimestamp: { type: "NUMBER", description: "The starting timestamp in seconds. Use 0 if it is an article." },
          rawTextChunk: { type: "STRING", description: "The verbatim original text belonging to this section." }
        },
        required: ["title", "summary", "startTimestamp", "rawTextChunk"]
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
  if (!ans) {
    showValidationHint("Please enter an answer before submitting.", false);
    return;
  }
  
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
