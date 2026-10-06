/**
 * Configuration & History store for LioSpeak.
 * Uses localStorage with fallback or Tauri Store.
 */

export interface DictationHistoryItem {
  id: string;
  text: string;
  timestamp: number;
  engine: 'gemini' | 'groq';
  model?: string;
  durationMs: number;
  costUsd?: number;
  costIdr?: number;
}

export interface AppConfig {
  engine: 'gemini' | 'groq';
  geminiApiKey: string;
  geminiModel: string;
  groqApiKey: string;
  groqModel: string;
  shortcut: string;
  mode: 'toggle' | 'push-to-talk';
  useFnKeyMac: boolean;
  fnMode: 'hold' | 'double-tap';
  stopPaddingMs: number;
  language: 'auto' | 'id' | 'en';
  systemPrompt: string;
  history: DictationHistoryItem[];
  lifetimeCostUsd: number;
  lifetimeDurationMs: number;
  lifetimeCount: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are a high-accuracy, verbatim speech-to-text transcription engine.
Transcribe spoken audio EXACTLY as spoken (word-for-word).
Support Indonesian, English, and natural Indonesian-English code-switching and casual slang.

Rules:
1. Output ONLY the transcribed words. Never add conversational replies, intro, or explanations.
2. Preserve casual Indonesian particles and colloquial slang verbatim (e.g., 'gua', 'lu', 'sih', 'deh', 'dong', 'gitu', 'kan', 'enggak', 'nih', 'ya'). Do NOT remove or substitute them.
3. Automatically apply correct capitalization and punctuation (periods, commas, question marks).
4. Preserve programming terms, technical keywords, and English loanwords (e.g., API, GitHub, React, commit, bug, adjust, shortcut).
5. Never summarize, invent, or substitute words. Reflect the exact spoken utterance.`;

const DEFAULT_CONFIG: AppConfig = {
  engine: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-3.5-transcribe',
  groqApiKey: '',
  groqModel: 'whisper-large-v3',
  shortcut: 'CommandOrControl+Shift+Space',
  mode: 'toggle',
  useFnKeyMac: true,
  fnMode: 'hold',
  stopPaddingMs: 400,
  language: 'auto',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  history: [],
  lifetimeCostUsd: 0,
  lifetimeDurationMs: 0,
  lifetimeCount: 0,
};

const STORAGE_KEY = 'liospeak_config';

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    const config = { ...DEFAULT_CONFIG, ...parsed };
    if (config.geminiModel === 'gemini-2.0-flash' || config.geminiModel === 'gemini-2.5-flash') {
      config.geminiModel = 'gemini-3.8-flash';
    }
    // Auto-migrate legacy filler-removal prompt to verbatim prompt
    if (config.systemPrompt && config.systemPrompt.includes('Remove hesitation filler words')) {
      config.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }
    if (config.stopPaddingMs === undefined || typeof config.stopPaddingMs !== 'number') {
      config.stopPaddingMs = 400;
    }
    if (typeof config.lifetimeCostUsd !== 'number') {
      config.lifetimeCostUsd = 0;
    }
    if (typeof config.lifetimeDurationMs !== 'number') {
      config.lifetimeDurationMs = 0;
    }
    if (typeof config.lifetimeCount !== 'number') {
      config.lifetimeCount = 0;
    }
    return config;
  } catch (err) {
    console.error('Failed to load config from storage:', err);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: AppConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    // Broadcast config update event for other windows/components
    window.dispatchEvent(new CustomEvent('liospeak_config_updated', { detail: config }));
  } catch (err) {
    console.error('Failed to save config to storage:', err);
  }
}

export function addHistoryItem(item: Omit<DictationHistoryItem, 'id'>): void {
  const current = loadConfig();
  const newItem: DictationHistoryItem = {
    ...item,
    id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  };
  // Keep last 100 items
  const history = [newItem, ...(current.history || [])].slice(0, 100);
  const lifetimeCostUsd = (current.lifetimeCostUsd || 0) + (item.costUsd || 0);
  const lifetimeDurationMs = (current.lifetimeDurationMs || 0) + (item.durationMs || 0);
  const lifetimeCount = (current.lifetimeCount || 0) + 1;

  saveConfig({
    ...current,
    history,
    lifetimeCostUsd,
    lifetimeDurationMs,
    lifetimeCount,
  });
}

export function clearHistory(): void {
  const current = loadConfig();
  saveConfig({ ...current, history: [] });
}

export function resetLifetimeStats(): void {
  const current = loadConfig();
  saveConfig({
    ...current,
    lifetimeCostUsd: 0,
    lifetimeDurationMs: 0,
    lifetimeCount: 0,
  });
}
