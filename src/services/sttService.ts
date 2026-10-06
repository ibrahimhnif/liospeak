import { AppConfig } from './configStore';
import { AudioRecordResult } from './audioRecorder';

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
      throw new Error(
        'Google Gemini API Key belum diisi. Buka Pengaturan LioSpeak untuk memasukkan API Key gratis dari Google AI Studio.'
      );
    }
    const text = await transcribeWithGemini(audioResult.base64, config);
    return { text, engine: 'gemini' };
  } else {
    if (!config.groqApiKey?.trim()) {
      throw new Error(
        'Groq API Key belum diisi. Buka Pengaturan LioSpeak untuk memasukkan Groq API Key.'
      );
    }
    const text = await transcribeWithGroq(audioResult.blob, config);
    return { text, engine: 'groq' };
  }
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
