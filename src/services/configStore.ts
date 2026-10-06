/**
 * Configuration & History store for LioSpeak.
 * Uses localStorage with fallback or Tauri Store.
 */

export interface DictationHistoryItem {
  id: string;
  text: string;
  timestamp: number;
  engine: 'gemini' | 'groq';
  durationMs: number;
}

export interface AppConfig {
  engine: 'gemini' | 'groq';
  geminiApiKey: string;
  geminiModel: string;
  groqApiKey: string;
  groqModel: string;
  shortcut: string;
  mode: 'toggle' | 'push-to-talk';
  language: 'auto' | 'id' | 'en';
  systemPrompt: string;
  history: DictationHistoryItem[];
}

const DEFAULT_SYSTEM_PROMPT = `You are a professional, high-accuracy dictation assistant.
Your task is to transcribe speech into clean, well-punctuated text.
The speech may be in Indonesian, English, or a natural mix of both (code-switching / slang).

Rules:
1. Output ONLY the transcribed words. No intro, no conversational response, no explanations.
2. Automatically format with proper capitalization and punctuation (periods, commas, question marks).
3. Remove hesitation filler words like "um", "uh", "eh", "anu", "nganu", "ya" (when used as filler).
4. Preserve technical terminology, programming keywords, abbreviations, and product names (e.g., GitHub, React, API, bug, PR, commit).
5. Do not invent words or summarize; accurately capture what was spoken.`;

const DEFAULT_CONFIG: AppConfig = {
  engine: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  groqApiKey: '',
  groqModel: 'whisper-large-v3',
  shortcut: 'CommandOrControl+Shift+Space',
  mode: 'toggle',
  language: 'auto',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  history: [],
};

const STORAGE_KEY = 'liospeak_config';

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
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
  // Keep last 50 items
  const history = [newItem, ...(current.history || [])].slice(0, 50);
  saveConfig({ ...current, history });
}

export function clearHistory(): void {
  const current = loadConfig();
  saveConfig({ ...current, history: [] });
}
