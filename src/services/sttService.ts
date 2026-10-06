import { AppConfig } from './configStore';
import { AudioRecordResult } from './audioRecorder';
import { termLog } from './logger';
import { calculateAudioCost } from './costCalculator';

export interface TranscribeResult {
  text: string;
  engine: 'gemini' | 'groq';
  model: string;
  costUsd: number;
  costIdr: number;
  formattedCost: string;
}

interface InternalGeminiResult {
  text: string;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    audio_tokens?: number;
  };
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
        let geminiResult = await transcribeWithGemini35(audioResult.blob, audioResult.base64, config);

        // If Gemini 3.5 returns empty text (e.g. quiet or non-transcribed), try gemini-3.8-flash fallback
        if (!geminiResult.text || !geminiResult.text.trim()) {
          termLog('[STT] Gemini 3.5 tidak menghasilkan teks, mencoba fallback ke gemini-3.8-flash...', 'info');
          const fallbackResult = await transcribeWithGemini(audioResult.base64, {
            ...config,
            geminiModel: 'gemini-3.8-flash',
          });
          if (fallbackResult.text && fallbackResult.text.trim()) {
            geminiResult = fallbackResult;
          }
        }

        const finalText = cleanTranscribedText(geminiResult.text);
        const cost = calculateAudioCost(
          'gemini',
          'gemini-3.5-transcribe',
          audioResult.durationMs,
          finalText.length,
          geminiResult.usage
        );

        termLog(
          `[STT Cost] Durasi: ${(audioResult.durationMs / 1000).toFixed(1)}s | Biaya: ${cost.formattedUsd} (${cost.formattedIdr})`,
          'info'
        );

        return {
          text: finalText,
          engine: 'gemini',
          model: 'gemini-3.5-transcribe',
          costUsd: cost.costUsd,
          costIdr: cost.costIdr,
          formattedCost: cost.formattedUsd,
        };
      } catch (err) {
        termLog(`Gemini 3.5 error (${err}), mencoba fallback ke gemini-3.8-flash...`, 'warn');
        const fallbackResult = await transcribeWithGemini(audioResult.base64, {
          ...config,
          geminiModel: 'gemini-3.8-flash',
        });
        const finalText = cleanTranscribedText(fallbackResult.text);
        const cost = calculateAudioCost(
          'gemini',
          'gemini-3.8-flash',
          audioResult.durationMs,
          finalText.length,
          fallbackResult.usage
        );

        termLog(
          `[STT Cost] Durasi: ${(audioResult.durationMs / 1000).toFixed(1)}s | Biaya: ${cost.formattedUsd} (${cost.formattedIdr})`,
          'info'
        );

        return {
          text: finalText,
          engine: 'gemini',
          model: 'gemini-3.8-flash',
          costUsd: cost.costUsd,
          costIdr: cost.costIdr,
          formattedCost: cost.formattedUsd,
        };
      }
    }

    // Direct Gemini 3.8 Flash
    const flashResult = await transcribeWithGemini(audioResult.base64, config);
    const finalText = cleanTranscribedText(flashResult.text);
    const cost = calculateAudioCost(
      'gemini',
      config.geminiModel || 'gemini-3.8-flash',
      audioResult.durationMs,
      finalText.length,
      flashResult.usage
    );

    termLog(
      `[STT Cost] Durasi: ${(audioResult.durationMs / 1000).toFixed(1)}s | Biaya: ${cost.formattedUsd} (${cost.formattedIdr})`,
      'info'
    );

    return {
      text: finalText,
      engine: 'gemini',
      model: config.geminiModel || 'gemini-3.8-flash',
      costUsd: cost.costUsd,
      costIdr: cost.costIdr,
      formattedCost: cost.formattedUsd,
    };
  } else {
    // Groq Whisper
    if (!config.groqApiKey?.trim()) {
      const err = 'Groq API Key belum diisi. Buka Pengaturan LioSpeak untuk memasukkan Groq API Key.';
      termLog(err, 'error');
      throw new Error(err);
    }
    const groqModel = config.groqModel || 'whisper-large-v3';
    termLog(`[STT] Mengirim audio ke Groq Whisper API (${groqModel})...`, 'info');
    const rawText = await transcribeWithGroq(audioResult.blob, config);
    const finalText = cleanTranscribedText(rawText);
    const cost = calculateAudioCost('groq', groqModel, audioResult.durationMs, finalText.length);

    termLog(
      `[STT Cost] Durasi: ${(audioResult.durationMs / 1000).toFixed(1)}s | Biaya: ${cost.formattedUsd} (${cost.formattedIdr})`,
      'info'
    );

    return {
      text: finalText,
      engine: 'groq',
      model: groqModel,
      costUsd: cost.costUsd,
      costIdr: cost.costIdr,
      formattedCost: cost.formattedUsd,
    };
  }
}

/**
 * Validates that extracted string is genuine spoken language text
 * and NOT an API interaction ID, metadata, or internal status keyword.
 */
function isLikelySpeechText(str: unknown): boolean {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  if (!trimmed) return false;

  // Reject Google Interaction IDs: e.g. "v1_ChdSQTdGYXU3QUw1LUtqdU1QZ3MtRzBBMBIXUkE3RmF1N0FMNS1LanVNUGdzLUcwQTA"
  if (/^v\d+_[A-Za-z0-9_-]+$/.test(trimmed)) {
    termLog(`[STT Filter] Menolak string ID API internal: "${trimmed}"`, 'warn');
    return false;
  }

  // Reject internal status keywords or JSON blobs
  const lower = trimmed.toLowerCase();
  if (['completed', 'in_progress', 'failed', 'cancelled', 'null', 'undefined', '{}', '[]'].includes(lower)) {
    return false;
  }

  return true;
}

/**
 * Extracts transcribed text strictly from known text payload fields.
 * NEVER blindly returns top-level object fields like `id` or `status`.
 */
function extractTextFromInteractionResponse(data: any): string {
  if (!data || typeof data !== 'object') return '';

  // 1. Direct text fields
  if (isLikelySpeechText(data.output_text)) return data.output_text.trim();
  if (isLikelySpeechText(data.transcript)) return data.transcript.trim();
  if (isLikelySpeechText(data.result?.text)) return data.result.text.trim();
  if (isLikelySpeechText(data.result?.transcript)) return data.result.transcript.trim();
  if (isLikelySpeechText(data.model_output?.text)) return data.model_output.text.trim();

  // 2. Interactions API: `steps` array
  if (Array.isArray(data.steps)) {
    const collected: string[] = [];
    for (const step of data.steps) {
      if (!step) continue;
      if (isLikelySpeechText(step.text)) {
        collected.push(step.text.trim());
      }
      if (isLikelySpeechText(step.output_text)) {
        collected.push(step.output_text.trim());
      }
      if (step.model_output) {
        if (isLikelySpeechText(step.model_output.text)) {
          collected.push(step.model_output.text.trim());
        }
        if (Array.isArray(step.model_output.content)) {
          for (const item of step.model_output.content) {
            if (isLikelySpeechText(item?.text) && !item.thought) {
              collected.push(item.text.trim());
            }
          }
        }
      }
      if (Array.isArray(step.content)) {
        for (const item of step.content) {
          if (isLikelySpeechText(item?.text) && !item.thought) {
            collected.push(item.text.trim());
          }
        }
      }
    }
    const joined = collected.filter(Boolean).join(' ').trim();
    if (joined && isLikelySpeechText(joined)) return joined;
  }

  // 3. Standard `candidates` array
  if (Array.isArray(data.candidates)) {
    const collected: string[] = [];
    for (const c of data.candidates) {
      const parts = c?.content?.parts || [];
      for (const p of parts) {
        if (!p.thought && isLikelySpeechText(p?.text)) {
          collected.push(p.text.trim());
        }
      }
    }
    const joined = collected.filter(Boolean).join(' ').trim();
    if (joined && isLikelySpeechText(joined)) return joined;
  }

  // 4. Outputs array
  if (Array.isArray(data.outputs)) {
    for (const out of data.outputs) {
      if (isLikelySpeechText(out?.text)) return out.text.trim();
      if (isLikelySpeechText(out?.transcript)) return out.transcript.trim();
    }
  }

  return '';
}

/**
 * Dedicated transcription using Gemini 3.5 Transcribe.
 */
export async function transcribeWithGemini35(
  _audioBlob: Blob,
  audioBase64: string,
  config: AppConfig
): Promise<InternalGeminiResult> {
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

      let usage: InternalGeminiResult['usage'] = undefined;
      if (data.usage) {
        usage = {
          total_input_tokens: data.usage.total_input_tokens,
          total_output_tokens: data.usage.total_output_tokens,
          audio_tokens: data.usage.input_tokens_by_modality?.find((m: any) => m.modality === 'audio')?.tokens,
        };
      }

      if (text) {
        termLog(`[Gemini 3.5 Parsed Text]: "${text}"`, 'info');
        return { text: cleanTranscribedText(text), usage };
      } else {
        termLog(
          `[Gemini 3.5] Audio kosong / tidak mengandung kata terucap.`,
          'info'
        );
        return { text: '', usage };
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
    const result = await transcribeWithGemini(audioBase64, {
      ...config,
      geminiModel: 'gemini-3.5-transcribe',
    });
    if (result.text && result.text.trim()) {
      return result;
    }
  } catch (e) {
    termLog(`gemini-3.5-transcribe generateContent attempt error: ${e}`, 'warn');
  }

  return { text: '' };
}

/**
 * Transcribes audio via standard Gemini generateContent multimodal endpoint.
 */
export async function transcribeWithGemini(
  audioBase64: string,
  config: AppConfig
): Promise<InternalGeminiResult> {
  const model =
    config.geminiModel === 'gemini-2.0-flash' || config.geminiModel === 'gemini-2.5-flash'
      ? 'gemini-3.8-flash'
      : config.geminiModel || 'gemini-3.8-flash';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    config.geminiApiKey.trim()
  )}`;

  let languagePrompt = '';
  if (config.language === 'id') {
    languagePrompt =
      'Bahasa utama adalah Bahasa Indonesia informal / gaul / santai dan code-switching bahasa Inggris teknis. ' +
      'WAJIB: Pertahankan semua partikel gaul dan kata santai secara persis (verbatim): ' +
      'gua, gue, lu, lo, gw, sih, deh, kan, dong, gitu, kayak, udah, belum, nggak, gak, banget, tuh, nih, ya. ' +
      'JANGAN mengubah kata gaul menjadi kata formal (misalnya JANGAN ubah "gue" jadi "saya", jangan ubah "gak/nggak" jadi "tidak").';
  } else if (config.language === 'en') {
    languagePrompt =
      'The speech is in English. Transcribe verbatim word-for-word with accurate punctuation and capitalization.';
  } else {
    languagePrompt =
      'Language is multilingual (Indonesian & English code-switching). ' +
      'Strictly preserve Indonesian conversational slang (gue, lu, sih, deh, kan, dong, gitu, kayak, gak, banget) ' +
      'and English technical developer terms (API, GitHub, deploy, PR, commit, bug, dll) verbatim.';
  }

  const basePrompt =
    config.systemPrompt ||
    `You are a high-accuracy, verbatim speech-to-text transcription engine.
Transcribe spoken audio EXACTLY as spoken (word-for-word).
Output ONLY the transcribed words. Never add conversational remarks, replies, or explanations.`;

  const systemInstructionText = `${basePrompt}\n\n[Acoustic & Vocabulary Rule]\n${languagePrompt}`;

  const payload = {
    systemInstruction: {
      parts: [
        {
          text: systemInstructionText,
        },
      ],
    },
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
            text: 'Transcribe this audio recording verbatim into text. Output ONLY the transcribed words with proper punctuation.',
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.0,
      topP: 0.95,
      maxOutputTokens: 2048,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.geminiApiKey.trim(),
    },
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

  let usage: InternalGeminiResult['usage'] = undefined;
  if (data.usageMetadata) {
    usage = {
      total_input_tokens: data.usageMetadata.promptTokenCount,
      total_output_tokens: data.usageMetadata.candidatesTokenCount,
    };
  }

  // Parse all text parts (ignoring thoughts if present)
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let rawText = '';
  for (const part of parts) {
    if (typeof part.text === 'string' && !part.thought && isLikelySpeechText(part.text)) {
      rawText += part.text + ' ';
    }
  }

  if (!rawText.trim()) {
    rawText = extractTextFromInteractionResponse(data);
  }

  return { text: cleanTranscribedText(rawText), usage };
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

  const promptContext =
    config.language === 'en'
      ? 'Verbatim transcription of English speech with accurate capitalization and punctuation.'
      : 'Transkripsi percakapan bahasa Indonesia informal santai: gue, gua, lu, lo, gw, sih, deh, kan, dong, gitu, kayak, gak, nggak, banget, udah, nih, tuh, ya, project, bug, fix, deploy, code, commit, merge, API, error, test, feature.';

  formData.append('prompt', promptContext);

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
  if (!isLikelySpeechText(text)) return '';
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
