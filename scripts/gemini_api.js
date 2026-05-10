// gemini_api.js - Core Wrapper for Gemini API

class GeminiClient {
  constructor(apiKey, model = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    this.isGemma = model.toLowerCase().includes('gemma');
  }

  async generateContent(prompt, systemInstruction = null, responseSchema = null, retries = 2) {
    if (!this.apiKey) throw new Error("Gemini API Key is missing.");

    // Gemma models don't support systemInstruction or responseSchema at the API level.
    // We inject them directly into the prompt instead.
    let finalPrompt = prompt;

    if (this.isGemma) {
      if (systemInstruction) {
        finalPrompt = `<start_of_turn>system\n${systemInstruction}<end_of_turn>\n<start_of_turn>user\n${prompt}`;
      }
      if (responseSchema) {
        // Convert schema to a human-readable example so Gemma doesn't echo types
        const example = this._schemaToExample(responseSchema);
        finalPrompt += `\n\nRespond with ONLY valid JSON. No explanations, no markdown code fences, no text before or after. Your response must be parseable by JSON.parse().\n\nExample format:\n${JSON.stringify(example, null, 2)}`;
        finalPrompt += `<end_of_turn>\n<start_of_turn>model\n`;
      } else if (systemInstruction) {
        finalPrompt += `<end_of_turn>\n<start_of_turn>model\n`;
      }
    }

    const payload = {
      contents: [{ role: "user", parts: [{ text: finalPrompt }] }]
    };

    // Only add native API features for non-Gemma models
    if (!this.isGemma) {
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
            // Parse retry delay from error if available
            let delay = 2000 * Math.pow(2, i);
            try {
              const errJson = JSON.parse(errorText);
              const retryInfo = errJson.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
              if (retryInfo?.retryDelay) {
                delay = parseInt(retryInfo.retryDelay) * 1000 + 1000; // Add 1s buffer
              }
            } catch (e) { /* use default delay */ }
            console.warn(`Gemini API error (${response.status}). Retrying in ${delay/1000}s... (${i+1}/${retries})`);
            await new Promise(r => setTimeout(r, delay));
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
            
            // Strip markdown code fences if present
            if (cleanText.startsWith('```')) {
              cleanText = cleanText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
            }

            // For Gemma: find the JSON blob boundaries (it may include conversational text)
            if (this.isGemma) {
              const expectedType = responseSchema.type;
              const openChar = expectedType === 'ARRAY' ? '[' : '{';
              const closeChar = expectedType === 'ARRAY' ? ']' : '}';
              const start = cleanText.indexOf(openChar);
              const end = cleanText.lastIndexOf(closeChar);
              if (start !== -1 && end !== -1 && end > start) {
                cleanText = cleanText.substring(start, end + 1);
              }
            }

            return JSON.parse(cleanText);
          } catch (parseError) {
            console.error("Raw Gemini output:", textOutput);
            if (i < retries) {
              console.warn(`JSON parse failed, retrying... (${i+1}/${retries})`);
              continue;
            }
            throw new Error(`Failed to parse Gemini JSON: ${parseError.message}`);
          }
        }
        return textOutput;
        
      } catch (error) {
        if (i === retries) {
          console.error("Gemini API call failed permanently:", error);
          throw error;
        }
      }
    }
  }

  /**
   * Convert a Gemini-style JSON schema into an example object with placeholder values.
   * This prevents Gemma from echoing back type names like "STRING" or "BOOLEAN".
   */
  _schemaToExample(schema) {
    if (!schema) return null;
    
    switch (schema.type) {
      case 'STRING':
        return schema.description || "your text here";
      case 'NUMBER':
        return 0;
      case 'BOOLEAN':
        return true;
      case 'OBJECT': {
        const obj = {};
        if (schema.properties) {
          for (const [key, val] of Object.entries(schema.properties)) {
            obj[key] = this._schemaToExample(val);
          }
        }
        return obj;
      }
      case 'ARRAY': {
        if (schema.items) {
          return [this._schemaToExample(schema.items), this._schemaToExample(schema.items)];
        }
        return [];
      }
      default:
        return null;
    }
  }
}

// Expose globally for study.js
window.GeminiClient = GeminiClient;
