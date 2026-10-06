import { AppConfig } from './configStore';
import { AudioRecordResult } from './audioRecorder';
import { termLog } from './logger';

export interface TranscribeResult {
  text: string;
  engine: 'gemini' | 'groq';
}

/**
 * Transcribes audio using either Google Gemini 2.0 Flash or Groq Whisper.
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

    termLog(`[STT] Mempersiapkan payload audio ke Google Gemini (${config.geminiModel || 'gemini-3.5-transcribe'})...`, 'info');

    if (config.geminiModel === 'gemini-3.5-transcribe') {
      try {
        termLog('[STT] Mengirim audio ke Gemini 3.5 Transcribe API...', 'info');
        const text = await transcribeWithGemini35(audioResult.blob, audioResult.base64, config);
        termLog(`[STT] Sukses Gemini 3.5: "${text}"`, 'info');
        return { text, engine: 'gemini' };
      } catch (err) {
        termLog(`Gemini 3.5 error (${err}), mencoba fallback ke gemini-2.0-flash...`, 'warn');
        const text = await transcribeWithGemini(audioResult.base64, {
          ...config,
          geminiModel: 'gemini-2.0-flash',
        });
        termLog(`[STT] Sukses Fallback Gemini 2.0: "${text}"`, 'info');
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
 * Dedicated transcription using Gemini 3.5 Transcribe.
 */
export async function transcribeWithGemini35(
  audioBlob: Blob,
  audioBase64: string,
  config: AppConfig
): Promise<string> {
  const apiKey = config.geminiApiKey.trim();

  // Method 1: Try Interactions API with direct audio payload
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    if (res.ok) {
      const data = await res.json();
      const text = data?.result?.text || data?.text || data?.transcript;
      if (text) return cleanTranscribedText(text);
    }
  } catch (e) {
    console.warn('Interactions inline attempt:', e);
  }

  // Method 2: Files API upload then interactions call
  try {
    const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Header-Content-Length': `${audioBlob.size}`,
        'X-Goog-Upload-Header-Content-Type': 'audio/wav',
        'Content-Type': 'audio/wav',
      },
      body: audioBlob,
    });

    if (uploadRes.ok) {
      const uploadData = await uploadRes.json();
      const uri = uploadData?.file?.uri || uploadData?.uri;
      if (uri) {
        const interactUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}`;
        const interactRes = await fetch(interactUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gemini-3.5-transcribe',
            input: [{ type: 'audio', uri }],
          }),
        });

        if (interactRes.ok) {
          const interactData = await interactRes.json();
          const text = interactData?.result?.text || interactData?.text || interactData?.transcript;
          if (text) return cleanTranscribedText(text);
        }
      }
    }
  } catch (e) {
    console.warn('Files API upload failed:', e);
  }

  // Method 3: generateContent with gemini-3.5-transcribe
  return transcribeWithGemini(audioBase64, {
    ...config,
    geminiModel: 'gemini-3.5-transcribe',
  });
}

/**
 * Calls Gemini 2.0 Flash with raw audio data and custom system prompt.
 */
export async function transcribeWithGemini(
  audioBase64: string,
  config: AppConfig
): Promise<string> {
  const model = config.geminiModel || 'gemini-2.0-flash';
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
            inlineData: {
              mimeType: 'audio/wav',
              data: audioBase64,
            },
          },
          {
            text: promptText,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
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
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
