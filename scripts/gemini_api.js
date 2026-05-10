// gemini_api.js - Core Wrapper for Gemini API

class GeminiClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent";
  }

  async generateContent(prompt, systemInstruction = null, responseSchema = null, retries = 2) {
    if (!this.apiKey) throw new Error("Gemini API Key is missing.");

    const isGemma = this.baseUrl.toLowerCase().includes('gemma');
    let finalPrompt = prompt;

    if (isGemma) {
      if (systemInstruction) {
        finalPrompt = `[System Instructions]: ${systemInstruction}\\n\\n[User Request]: ${prompt}`;
      }
      if (responseSchema) {
        finalPrompt += `\\n\\nIMPORTANT: You MUST respond ONLY with valid JSON. Do not include any introductory text, explanations, or markdown code blocks. Output ONLY the raw JSON string that strictly matches this schema:\\n${JSON.stringify(responseSchema)}`;
      }
    }

    const payload = {
      contents: [{ role: "user", parts: [{ text: finalPrompt }] }]
    };

    if (systemInstruction && !isGemma) {
      payload.systemInstruction = {
        role: "system",
        parts: [{ text: systemInstruction }]
      };
    }

    if (responseSchema && !isGemma) {
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
            
            // Robustly find the start and end of the JSON blob based on expected type
            let start = -1;
            let end = -1;

            if (responseSchema.type === "ARRAY") {
              start = cleanText.indexOf('[');
              end = cleanText.lastIndexOf(']');
            } else {
              start = cleanText.indexOf('{');
              end = cleanText.lastIndexOf('}');
            }

            if (start !== -1 && end !== -1 && end > start) {
              cleanText = cleanText.substring(start, end + 1);
            }

            return JSON.parse(cleanText);

            return JSON.parse(cleanText);
          } catch (parseError) {
            throw new Error(`Failed to parse Gemini JSON output: ${parseError.message}. Check console for raw output.`);
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
