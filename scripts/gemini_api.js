// gemini_api.js - Core Wrapper for Gemini API

class GeminiClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  }

  async generateContent(prompt, systemInstruction = null, responseSchema = null, retries = 2) {
    if (!this.apiKey) throw new Error("Gemini API Key is missing.");

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    };

    if (systemInstruction) {
      payload.systemInstruction = {
        role: "system",
        parts: [{ text: systemInstruction }]
      };
    }

    if (responseSchema) {
      payload.generationConfig = {
        responseMimeType: "application/json",
        responseSchema: responseSchema
      };
    }

    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          if ((response.status === 429 || response.status >= 500) && i < retries) {
            console.warn(`Gemini API Rate Limit / Server Error (${response.status}). Retrying... (${i+1}/${retries})`);
            await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i))); // Exponential backoff
            continue;
          }
          throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        
        if (!data.candidates || data.candidates.length === 0) {
          throw new Error("No candidates returned from Gemini.");
        }

        const textOutput = data.candidates[0].content.parts[0].text;
        
        if (responseSchema) {
          try {
            let cleanText = textOutput.trim();
            if (cleanText.startsWith('```')) {
              cleanText = cleanText.replace(/^```(?:json)?\\n?/i, '').replace(/\\n?```$/i, '');
            }
            return JSON.parse(cleanText);
          } catch (parseError) {
            throw new Error(`Failed to parse Gemini JSON output: ${parseError.message}. Raw output: ${textOutput}`);
          }
        }
        return textOutput;
        
      } catch (error) {
        if (i === retries) {
          console.error("Gemini API Call Failed permanently:", error);
          throw error;
        }
      }
    }
  }
}

// Expose globally for study.js
window.GeminiClient = GeminiClient;
