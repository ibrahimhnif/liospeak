/**
 * Speech-to-Text Cost Calculator for Google Gemini and Groq Whisper.
 * Calculates costs based on official provider pricing.
 */

export interface CostCalculationResult {
  costUsd: number;
  costIdr: number;
  formattedUsd: string;
  formattedIdr: string;
  tokens?: {
    input?: number;
    output?: number;
    audio?: number;
  };
}

// 1 USD approx 16,000 IDR
export const USD_TO_IDR = 16000;

/**
 * Calculates cost for an audio transcription based on engine, model, and duration.
 */
export function calculateAudioCost(
  engine: 'gemini' | 'groq',
  _model: string,
  durationMs: number,
  textLength: number,
  usageData?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    audio_tokens?: number;
  }
): CostCalculationResult {
  const durationSec = Math.max(0.1, durationMs / 1000);
  let costUsd = 0;
  let audioTokens = 0;
  let textTokens = Math.ceil(textLength / 4);

  if (engine === 'gemini') {
    // Google Gemini 3.5 Transcribe & Gemini 3.8 Flash
    // Audio input: $0.70 per 1,000,000 tokens (1s audio ~ 32 tokens)
    // Text output: $0.40 per 1,000,000 tokens
    if (usageData?.audio_tokens) {
      audioTokens = usageData.audio_tokens;
    } else if (usageData?.total_input_tokens) {
      audioTokens = usageData.total_input_tokens;
    } else {
      audioTokens = Math.round(durationSec * 32);
    }

    if (usageData?.total_output_tokens) {
      textTokens = usageData.total_output_tokens;
    }

    const audioCost = (audioTokens / 1_000_000) * 0.70;
    const textCost = (textTokens / 1_000_000) * 0.40;
    costUsd = audioCost + textCost;
  } else {
    // Groq Whisper Large v3
    // Official rate: $0.111 per hour of audio
    // $0.111 / 3600 = $0.000030833 per second
    costUsd = durationSec * (0.111 / 3600);
  }

  const costIdr = costUsd * USD_TO_IDR;

  return {
    costUsd,
    costIdr,
    formattedUsd: formatUsd(costUsd),
    formattedIdr: formatIdr(costIdr),
    tokens: {
      input: audioTokens,
      output: textTokens,
      audio: audioTokens,
    },
  };
}

export function formatUsd(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.00001) return '<$0.00001';
  if (cost < 0.001) return `$${cost.toFixed(5)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

export function formatIdr(costIdr: number): string {
  if (costIdr === 0) return 'Rp 0';
  if (costIdr < 0.1) return `< Rp 0.1`;
  if (costIdr < 10) return `Rp ${costIdr.toFixed(1)}`;
  return `Rp ${Math.round(costIdr).toLocaleString('id-ID')}`;
}
