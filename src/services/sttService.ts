import { AppConfig } from './configStore';
import { AudioRecordResult } from './audioRecorder';
import { termLog } from './logger';

export interface TranscribeResult {
  text: string;
  engine: 'gemini' | 'groq';
}

/**
 * Transcribes audio using either Google Gemini (Gemini 3.5 Transcribe / 3.8 Flash) or Groq Whisper.
 */
export async function transcribeAudio(
  audioResult: AudioRecordResult,
  config: AppConfig
): Promise<TranscribeResult> {
  if (config.engine === 'gemini') {
    if (!config.geminiApiKey?.trim()) {
      const err = 'Google Gemini API Key belum diisi. Buka Pengaturan LioSpeak untuk memasukkan API Key gratis dari Google AI Studio.';
      termLog(err, 'error');
      throw new Error(err);
    }

    const currentModel = config.geminiModel || 'gemini-3.5-transcribe';
    termLog(`[STT] Mempersiapkan payload audio ke Google Gemini (${currentModel})...`, 'info');

    if (currentModel === 'gemini-3.5-transcribe') {
      try {
        termLog('[STT] Mengirim audio ke Gemini 3.5 Transcribe API...', 'info');
        let text = await transcribeWithGemini35(audioResult.blob, audioResult.base64, config);

        // If Gemini 3.5 returns empty string, fallback to gemini-3.8-flash!
        if (!text || !text.trim()) {
          termLog('[STT] Gemini 3.5 mengembalikan teks kosong, otomatis fallback ke gemini-3.8-flash...', 'warn');
          text = await transcribeWithGemini(audioResult.base64, {
            ...config,
            geminiModel: 'gemini-3.8-flash',
          });
        }

        termLog(`[STT] Sukses Gemini STT: "${text}"`, 'info');
        return { text, engine: 'gemini' };
      } catch (err) {
        termLog(`Gemini 3.5 error (${err}), mencoba fallback ke gemini-3.8-flash...`, 'warn');
        const text = await transcribeWithGemini(audioResult.base64, {
          ...config,
          geminiModel: 'gemini-3.8-flash',
        });
        termLog(`[STT] Sukses Fallback Gemini 3.8: "${text}"`, 'info');
        return { text, engine: 'gemini' };
      }
    }

    const text = await transcribeWithGemini(audioResult.base64, config);
    return { text, engine: 'gemini' };
  } else {
    if (!config.groqApiKey?.trim()) {
      const err = 'Groq API Key belum diisi. Buka Pengaturan LioSpeak untuk memasukkan Groq API Key.';
      termLog(err, 'error');
      throw new Error(err);
    }
    termLog('[STT] Mengirim audio ke Groq Whisper API...', 'info');
    const text = await transcribeWithGroq(audioResult.blob, config);
    termLog(`[STT] Sukses Groq Whisper: "${text}"`, 'info');
    return { text, engine: 'groq' };
  }
}

/**
 * Helper to recursively search for any transcription text in a complex response object.
 */
function findAnyTextInObject(obj: any, maxDepth = 6): string {
  if (!obj || maxDepth <= 0) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj.text === 'string' && obj.text.trim() && !obj.thought) return obj.text.trim();
  if (typeof obj.transcript === 'string' && obj.transcript.trim()) return obj.transcript.trim();
  if (typeof obj.output_text === 'string' && obj.output_text.trim()) return obj.output_text.trim();

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findAnyTextInObject(item, maxDepth - 1);
      if (found) return found;
    }
  } else if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      if (['usage', 'metadata', 'model_invocation_token_counts', 'prompt_tokens_details'].includes(key)) {
        continue;
      }
      const found = findAnyTextInObject(val, maxDepth - 1);
      if (found) return found;
    }
  }
  return '';
}

/**
 * Extracts transcribed text from the Interactions API or general JSON response.
 */
function extractTextFromInteractionResponse(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (typeof data.text === 'string' && data.text.trim()) return data.text.trim();
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  if (typeof data.transcript === 'string' && data.transcript.trim()) return data.transcript.trim();
  if (typeof data.result?.text === 'string' && data.result.text.trim()) return data.result.text.trim();
  if (typeof data.result?.transcript === 'string' && data.result.transcript.trim()) return data.result.transcript.trim();
  if (typeof data.output?.text === 'string' && data.output.text.trim()) return data.output.text.trim();
  if (typeof data.model_output?.text === 'string' && data.model_output.text.trim()) return data.model_output.text.trim();

  // Interactions API: check `steps` array
  if (Array.isArray(data.steps)) {
    const collected: string[] = [];
    for (const step of data.steps) {
      if (typeof step === 'string') {
        collected.push(step);
      } else if (step) {
        if (typeof step.text === 'string' && step.text.trim()) {
          collected.push(step.text.trim());
        }
        if (typeof step.output === 'string' && step.output.trim()) {
          collected.push(step.output.trim());
        }
        if (typeof step.output_text === 'string' && step.output_text.trim()) {
          collected.push(step.output_text.trim());
        }
        if (step.model_output) {
          if (typeof step.model_output.text === 'string') {
            collected.push(step.model_output.text.trim());
          }
          if (Array.isArray(step.model_output.content)) {
            for (const item of step.model_output.content) {
              if (typeof item === 'string') collected.push(item);
              else if (item?.text && !item.thought) collected.push(item.text);
            }
          }
        }
        if (Array.isArray(step.content)) {
          for (const item of step.content) {
            if (typeof item === 'string') collected.push(item);
            else if (item?.text && !item.thought) collected.push(item.text);
          }
        }
      }
    }
    const joined = collected.filter(Boolean).join(' ').trim();
    if (joined) return joined;
  }

  // Check `candidates` array
  if (Array.isArray(data.candidates)) {
    const collected: string[] = [];
    for (const c of data.candidates) {
      const parts = c?.content?.parts || [];
      for (const p of parts) {
        if (!p.thought && typeof p?.text === 'string') {
          collected.push(p.text);
        }
      }
    }
    const joined = collected.filter(Boolean).join(' ').trim();
    if (joined) return joined;
  }

  // Check `outputs` array (legacy)
  if (Array.isArray(data.outputs)) {
    for (const out of data.outputs) {
      if (typeof out.text === 'string' && out.text.trim()) return out.text.trim();
      if (typeof out.content === 'string' && out.content.trim()) return out.content.trim();
    }
  }

  // Fallback: deep scan object
  return findAnyTextInObject(data);
}

/**
 * Dedicated transcription using Gemini 3.5 Transcribe.
 */
export async function transcribeWithGemini35(
  _audioBlob: Blob,
  audioBase64: string,
  config: AppConfig
): Promise<string> {
  const apiKey = config.geminiApiKey.trim();

  // Method 1: Try Interactions API with direct audio payload
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      keepalive: true,
      body: JSON.stringify({
        model: 'gemini-3.5-transcribe',
        input: [
          {
            type: 'audio',
            data: audioBase64,
            mime_type: 'audio/wav',
          },
        ],
      }),
    });

    termLog(`[Gemini 3.5 Interactions API HTTP Status: ${res.status}]`, 'info');
    if (res.ok) {
      const data = await res.json();
      termLog(`[Gemini 3.5 Interactions Response]: ${JSON.stringify(data).slice(0, 1000)}`, 'info');
      const text = extractTextFromInteractionResponse(data);
      if (text) {
        termLog(`[Gemini 3.5 Parsed Text]: "${text}"`, 'info');
        return cleanTranscribedText(text);
      } else {
        termLog(
          `[Gemini 3.5] Response JSON tidak mengandung field teks yang dikenal. Response keys: ${Object.keys(data).join(', ')}`,
          'warn'
        );
      }
    } else {
      const errBody = await res.text();
      termLog(`[Gemini 3.5 Interactions non-OK body: ${errBody.slice(0, 400)}]`, 'warn');
    }
  } catch (e) {
    termLog(`Interactions inline attempt error: ${e}`, 'warn');
  }

  // Method 2: Try generateContent with gemini-3.5-transcribe
  try {
    termLog('[STT] Mencoba transcribe via gemini-3.5-transcribe:generateContent...', 'info');
    const text = await transcribeWithGemini(audioBase64, {
      ...config,
      geminiModel: 'gemini-3.5-transcribe',
    });
    if (text && text.trim()) {
      return text;
    }
  } catch (e) {
    termLog(`gemini-3.5-transcribe generateContent attempt error: ${e}`, 'warn');
  }

  // Method 3: Fallback to Gemini 3.8 Flash (Google's flagship audio model)
  termLog('[STT] Menggunakan Gemini 3.8 Flash multimodal audio engine...', 'info');
  return transcribeWithGemini(audioBase64, {
    ...config,
    geminiModel: 'gemini-3.8-flash',
  });
}

/**
 * Calls Gemini with raw audio data and custom system prompt.
 */
export async function transcribeWithGemini(
  audioBase64: string,
  config: AppConfig
): Promise<string> {
  // Alias deprecated models to gemini-3.8-flash
  let model = config.geminiModel || 'gemini-3.8-flash';
  if (model === 'gemini-2.0-flash' || model === 'gemini-2.5-flash') {
    model = 'gemini-3.8-flash';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    config.geminiApiKey.trim()
  )}`;

  const promptText = `${config.systemPrompt || 'Transcribe the spoken audio cleanly.'}\nLanguage preference: ${
    config.language === 'id' ? 'Bahasa Indonesia' : config.language === 'en' ? 'English' : 'Indonesian / English auto-detect'
  }`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: promptText,
          },
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: audioBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 1024,
    },
  };

  termLog(`[Gemini API Request] Mengirim ke model "${model}" (${(audioBase64.length / 1024).toFixed(1)} KB base64)...`, 'info');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.geminiApiKey.trim(),
    },
    keepalive: true,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    termLog(`[Gemini API Error] HTTP ${response.status}: ${errorBody.slice(0, 400)}`, 'error');
    let message = `Gemini API error (${response.status})`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // use raw errorBody
    }
    throw new Error(message);
  }

  const data = await response.json();
  termLog(`[Gemini API Response] ${JSON.stringify(data).slice(0, 800)}`, 'info');

  if (data?.promptFeedback?.blockReason) {
    termLog(`[Gemini API Prompt Blocked] Alasan: ${data.promptFeedback.blockReason}`, 'warn');
  }
  if (data?.candidates?.[0]?.finishReason && data?.candidates?.[0]?.finishReason !== 'STOP') {
    termLog(`[Gemini API Finish Reason] ${data.candidates[0].finishReason}`, 'info');
  }

  // Parse all text parts (ignoring thoughts if present)
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let rawText = '';
  for (const part of parts) {
    if (typeof part.text === 'string' && !part.thought) {
      rawText += part.text + ' ';
    }
  }

  if (!rawText.trim() && parts.length > 0) {
    rawText = parts[parts.length - 1]?.text || '';
  }

  if (!rawText.trim()) {
    rawText = extractTextFromInteractionResponse(data);
  }

  return cleanTranscribedText(rawText);
}

/**
 * Calls Groq Whisper audio transcriptions endpoint.
 */
export async function transcribeWithGroq(
  audioBlob: Blob,
  config: AppConfig
): Promise<string> {
  const model = config.groqModel || 'whisper-large-v3';
  const url = 'https://api.groq.com/openai/v1/audio/transcriptions';

  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.wav');
  formData.append('model', model);
  formData.append('response_format', 'json');

  if (config.language && config.language !== 'auto') {
    formData.append('language', config.language);
  }

  formData.append(
    'prompt',
    'Transkripsi percakapan bahasa Indonesia dan bahasa Inggris, code-switching, gunakan tanda baca yang benar.'
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey.trim()}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let message = `Groq API error (${response.status})`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // use raw errorBody
    }
    throw new Error(message);
  }

  const data = await response.json();
  const rawText = data?.text || '';
  return cleanTranscribedText(rawText);
}

/**
 * Cleans quotation marks and excess whitespace from model output.
 */
function cleanTranscribedText(text: string): string {
  let cleaned = text.trim();
  // Strip surrounding quotes if the model enclosed output in quotes
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
    (cleaned.startsWith('“') && cleaned.endsWith('”'))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}
