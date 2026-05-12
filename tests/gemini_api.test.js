/**
 * @file gemini_api.test.js
 * Unit tests for the GeminiClient class.
 * Tests cover initialization, schema conversion, JSON parsing, retry logic, and error handling.
 */

// --- Mock Setup ---
// Mock global fetch since GeminiClient uses it directly
global.fetch = jest.fn();

// Mock window.GeminiClient exposure
global.window = global.window || {};

// Load the module (it assigns to window.GeminiClient)
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'gemini_api.js'), 'utf8');
eval(code);

const GeminiClient = window.GeminiClient;

// --- Helper ---
function mockFetchResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  });
}

// --- Tests ---
describe('GeminiClient', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  describe('constructor', () => {
    test('sets default model to gemini-3.1-flash-lite', () => {
      const client = new GeminiClient('test-key');
      expect(client.model).toBe('gemini-3.1-flash-lite');
      expect(client.isGemma).toBe(false);
    });

    test('detects Gemma models', () => {
      const client = new GeminiClient('test-key', 'gemma-2-9b-it');
      expect(client.isGemma).toBe(true);
    });

    test('constructs correct base URL', () => {
      const client = new GeminiClient('key', 'gemini-pro');
      expect(client.baseUrl).toContain('gemini-pro');
      expect(client.baseUrl).toContain('generateContent');
    });
  });

  describe('_schemaToExample', () => {
    let client;
    beforeEach(() => { client = new GeminiClient('key'); });

    test('converts STRING schema', () => {
      expect(client._schemaToExample({ type: 'STRING' })).toBe('your text here');
    });

    test('converts STRING with description', () => {
      expect(client._schemaToExample({ type: 'STRING', description: 'A name' })).toBe('A name');
    });

    test('converts NUMBER schema', () => {
      expect(client._schemaToExample({ type: 'NUMBER' })).toBe(0);
    });

    test('converts BOOLEAN schema', () => {
      expect(client._schemaToExample({ type: 'BOOLEAN' })).toBe(true);
    });

    test('converts OBJECT schema with properties', () => {
      const result = client._schemaToExample({
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          count: { type: 'NUMBER' }
        }
      });
      expect(result).toEqual({ title: 'your text here', count: 0 });
    });

    test('converts ARRAY schema with items', () => {
      const result = client._schemaToExample({
        type: 'ARRAY',
        items: { type: 'STRING' }
      });
      expect(result).toEqual(['your text here', 'your text here']);
    });

    test('handles null schema', () => {
      expect(client._schemaToExample(null)).toBeNull();
    });

    test('handles unknown type', () => {
      expect(client._schemaToExample({ type: 'UNKNOWN' })).toBeNull();
    });
  });

  describe('generateContent', () => {
    test('throws if API key is missing', async () => {
      const client = new GeminiClient(null);
      await expect(client.generateContent('test')).rejects.toThrow('API Key is missing');
    });

    test('returns text output for plain prompt', async () => {
      fetch.mockReturnValueOnce(mockFetchResponse({
        candidates: [{ content: { parts: [{ text: 'Hello World' }] } }]
      }));

      const client = new GeminiClient('test-key');
      const result = await client.generateContent('Say hello');
      expect(result).toBe('Hello World');
    });

    test('parses JSON when responseSchema is provided', async () => {
      const jsonResponse = { title: 'Test', count: 42 };
      fetch.mockReturnValueOnce(mockFetchResponse({
        candidates: [{ content: { parts: [{ text: JSON.stringify(jsonResponse) }] } }]
      }));

      const client = new GeminiClient('test-key');
      const result = await client.generateContent('test', null, {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, count: { type: 'NUMBER' } }
      });
      expect(result).toEqual(jsonResponse);
    });

    test('strips markdown fences from JSON response', async () => {
      const jsonResponse = { ok: true };
      fetch.mockReturnValueOnce(mockFetchResponse({
        candidates: [{ content: { parts: [{ text: '```json\n{"ok":true}\n```' }] } }]
      }));

      const client = new GeminiClient('test-key');
      const result = await client.generateContent('test', null, {
        type: 'OBJECT',
        properties: { ok: { type: 'BOOLEAN' } }
      });
      expect(result).toEqual(jsonResponse);
    });

    test('sends systemInstruction in payload for non-Gemma', async () => {
      fetch.mockReturnValueOnce(mockFetchResponse({
        candidates: [{ content: { parts: [{ text: 'response' }] } }]
      }));

      const client = new GeminiClient('test-key');
      await client.generateContent('prompt', 'You are a tutor');

      const payload = JSON.parse(fetch.mock.calls[0][1].body);
      expect(payload.systemInstruction).toBeDefined();
      expect(payload.systemInstruction.parts[0].text).toBe('You are a tutor');
    });

    test('throws on empty candidates', async () => {
      fetch.mockReturnValue(mockFetchResponse({ candidates: [] }));

      const client = new GeminiClient('test-key');
      await expect(client.generateContent('test', null, null, 0))
        .rejects.toThrow('No candidates');
    });

    test('retries on 429 rate limit', async () => {
      // First call: 429, second call: success
      fetch
        .mockReturnValueOnce(Promise.resolve({
          ok: false, status: 429,
          text: () => Promise.resolve('{"error":{"message":"rate limited"}}')
        }))
        .mockReturnValueOnce(mockFetchResponse({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }]
        }));

      const client = new GeminiClient('test-key');
      const result = await client.generateContent('test', null, null, 1);
      expect(result).toBe('ok');
      expect(fetch).toHaveBeenCalledTimes(2);
    }, 15000);
  });
});
