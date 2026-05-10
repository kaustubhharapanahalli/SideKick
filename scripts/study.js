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
  ytPlayer: null,
  failedAttempts: 0
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
  revealAnswerBtn: document.getElementById('revealAnswerBtn'),
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
  els.validationHint.className = 'validation-hint';
  els.validationHint.style.display = '';
  els.revealAnswerBtn.style.display = 'none';
  state.failedAttempts = 0;
  
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
  els.validationHint.style.display = 'block'; // Ensure inline style doesn't block it
  
  // Trigger reflow to restart animation
  void els.validationHint.offsetWidth;
}

function splitArticleIntoChunks(text, targetCount = 5) {
  // Strategy 1: Split by Heading markers (Semantic Sections)
  // Look for [[H2]] markers I just added to the extractor
  const h2Sections = text.split(/\\n\\n(?=\[\[H2\]\])/i).filter(s => s.trim().length > 0);
  
  if (h2Sections.length >= 2) {
    return h2Sections.slice(0, 10).map(s => ({ 
      rawTextChunk: s.replace(/\[\[H[1-6]\]\]/g, '').trim() 
    }));
  }

  // Strategy 2: Fallback to Paragraph-based splitting
  let paragraphs = text.split(/\\n\\n+/).filter(p => p.trim().length > 0);
  
  // If no double newlines found, try single newlines
  if (paragraphs.length <= 1) {
    paragraphs = text.split(/\\n+/).filter(p => p.trim().length > 0);
  }

  if (paragraphs.length === 0) return [{ rawTextChunk: text }];
  
  const count = Math.min(targetCount, paragraphs.length);
  const chunks = [];
  const pPerChunk = Math.ceil(paragraphs.length / count);
  
  for (let i = 0; i < count; i++) {
    const start = i * pPerChunk;
    const end = (i === count - 1) ? paragraphs.length : (i + 1) * pPerChunk;
    const slice = paragraphs.slice(start, end);
    if (slice.length > 0) {
      chunks.push({ 
        rawTextChunk: slice.join('\\n\\n').replace(/\[\[H[1-6]\]\]/g, '').trim() 
      });
    }
  }
  
  return chunks;
}

// ------------------------------------------------------------------
// AI PIPELINE
// ------------------------------------------------------------------

async function startSectionerPipeline() {
  showLoader("Gemini is analyzing and segmenting the content...");
  
  try {
    const client = new GeminiClient(state.apiKey);
    const isYouTube = state.sessionData.type === 'youtube';
    
    if (isYouTube) {
      // YouTube still needs intelligent topic-based segmentation
      const contentContext = state.sessionData.content.map(c => `[${c.startTimestamp}s]: ${c.text}`).join('\\n');
      
      const systemInstruction = `You are an expert tutor. Analyze the provided YouTube transcript and break it down into 3 to 5 logical sections.
For each section, provide a concise but descriptive title, a 2-3 sentence summary, and the accurate starting timestamp.`;

      const prompt = `Please segment the following transcript into a learning curriculum:\\n\\n${contentContext}`;

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
      // Articles use JS-based splitting for 100% verbatim accuracy
      const chunks = splitArticleIntoChunks(state.sessionData.content, 5);
      
      // We pass only the first 1000 chars of each chunk to Gemini to get metadata.
      // This prevents massive token bloat and timeouts for long articles.
      const contentContext = chunks.map((c, i) => `[SECTION ${i+1}]: ${c.rawTextChunk.substring(0, 1000)}...`).join('\\n\\n');
      
      const systemInstruction = `You are an expert tutor. I have split an article into ${chunks.length} sections for a student.
Your task is to generate a descriptive title and a 2-3 sentence summary for each section based on the provided text snippets.`;

      const prompt = `Please provide titles and summaries for these ${chunks.length} sections:\\n\\n${contentContext}`;

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

      const metadata = await client.generateContent(prompt, systemInstruction, responseSchema);
      
      // Merge JS chunks with Gemini metadata
      state.sections = chunks.map((chunk, i) => ({
        ...chunk,
        title: metadata[i] ? metadata[i].title : `Section ${i+1}`,
        summary: metadata[i] ? metadata[i].summary : "Review this section to proceed.",
        startTimestamp: 0
      }));
    }
    
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
      state.failedAttempts++;
      showValidationHint("Hint: " + response.feedback, false);
      if (state.failedAttempts >= 1) {
        els.revealAnswerBtn.style.display = 'block';
      }
    }

  } catch (error) {
    console.error("Failed to validate answer:", error);
    hideLoader();
    showValidationHint("Failed to validate: " + error.message, false);
  }
});

els.revealAnswerBtn.addEventListener('click', async () => {
  showLoader("Generating model answer...");
  try {
    const client = new GeminiClient(state.apiKey);
    const currentSection = state.sections[state.currentIndex];
    const questionAsked = els.questionText.textContent;
    
    const prompt = `Section Summary: ${currentSection.summary}\\nQuestion Asked: ${questionAsked}\\n\\nPlease provide a concise, model correct answer.`;
    const systemInstruction = "You are an expert tutor providing the correct answer key to a struggling student. Keep it clear, educational, and under 3 sentences.";
    
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
    
    showValidationHint("Model Answer: " + response.modelAnswer + " Moving to the next section...", true);
    setTimeout(() => {
      if (state.currentIndex < state.sections.length - 1) {
        state.currentIndex++;
        updateUI();
      } else {
        els.sectionSummary.innerHTML = "<strong>Module Complete!</strong><br>You have successfully mastered this material.";
        els.questionArea.classList.remove('active');
        els.validationHint.style.display = 'none';
        
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.remove(['currentStudySession', 'currentStudySessionError']);
        }
      }
    }, 5000);

  } catch (error) {
    console.error("Failed to reveal answer:", error);
    hideLoader();
    showValidationHint("Failed to reveal answer: " + error.message, false);
  }
});
