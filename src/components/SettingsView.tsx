import { useState, useEffect } from 'react';
import {
  Mic,
  Settings,
  Sparkles,
  Keyboard,
  Clock,
  ExternalLink,
  Check,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  Radio,
  Minimize2,
  RotateCw,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AppConfig,
  loadConfig,
  saveConfig,
  clearHistory,
} from '../services/configStore';
import { dictationCoordinator } from '../services/shortcutManager';

const SHORTCUT_PRESETS = [
  { label: 'Cmd/Ctrl + Shift + Space (Bawaan)', value: 'CommandOrControl+Shift+Space' },
  { label: 'Cmd/Ctrl + Shift + D', value: 'CommandOrControl+Shift+D' },
  { label: 'Alt / Option + Space', value: 'Alt+Space' },
  { label: 'F8', value: 'F8' },
  { label: 'F9', value: 'F9' },
];

const PROMPT_PRESETS = {
  default: `You are a professional, high-accuracy dictation assistant.
Your task is to transcribe speech into clean, well-punctuated text.
The speech may be in Indonesian, English, or a natural mix of both (code-switching / slang).

Rules:
1. Output ONLY the transcribed words. No intro, no conversational response, no explanations.
2. Automatically format with proper capitalization and punctuation (periods, commas, question marks).
3. Remove hesitation filler words like "um", "uh", "eh", "anu", "nganu", "ya" (when used as filler).
4. Preserve technical terminology, programming keywords, abbreviations, and product names (e.g., GitHub, React, API, bug, PR, commit).
5. Do not invent words or summarize; accurately capture what was spoken.`,

  code: `You are a technical dictation assistant for software engineers.
Transcribe spoken Indonesian and English into precise technical text.
Preserve exact programming identifiers, camelCase, snake_case, terminal commands, and framework names.
Do not explain anything. Output ONLY the final spoken statement.`,

  formal: `Anda adalah asisten transkripsi profesional untuk dokumen resmi dan korespondensi formal.
Transkripsikan ucapan ke dalam bahasa Indonesia baku dan sopan.
Gunakan ejaan yang disempurnakan (EYD), tanda baca lengkap, dan kapitalisasi yang tepat.
Keluarkan HANYA hasil teks transkripsi tanpa komentar tambahan.`,
};

export const SettingsView: React.FC = () => {
  const [config, setConfig] = useState<AppConfig>(loadConfig());
  const [activeTab, setActiveTab] = useState<'shortcut' | 'engine' | 'prompt' | 'history'>('shortcut');
  const [showApiKey, setShowApiKey] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saveBanner, setSaveBanner] = useState(false);

  useEffect(() => {
    // Initial shortcut registration
    dictationCoordinator.updateShortcut(config.shortcut).catch((e) => {
      console.error('Failed to bind initial shortcut:', e);
    });
  }, []);

  const updateConfig = (patch: Partial<AppConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveConfig(next);

    if (patch.shortcut !== undefined) {
      dictationCoordinator.updateShortcut(patch.shortcut).catch((e) => {
        setTestState('error');
        setTestMsg(`Gagal mendaftarkan shortcut: ${e}`);
      });
    }

    setSaveBanner(true);
    setTimeout(() => setSaveBanner(false), 2000);
  };

  const handleTestApiKey = async () => {
    setTestState('testing');
    setTestMsg('Menghubungkan ke API...');

    try {
      if (config.engine === 'gemini') {
        if (!config.geminiApiKey?.trim()) {
          throw new Error('Masukkan Gemini API Key terlebih dahulu.');
        }
        const model = config.geminiModel || 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          config.geminiApiKey.trim()
        )}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Respond with the word OK.' }] }],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message || `HTTP ${res.status}`);
        }
        setTestState('success');
        setTestMsg('Koneksi Gemini 2.0 Flash berhasil terhubung!');
      } else {
        if (!config.groqApiKey?.trim()) {
          throw new Error('Masukkan Groq API Key terlebih dahulu.');
        }
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${config.groqApiKey.trim()}` },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message || `HTTP ${res.status}`);
        }
        setTestState('success');
        setTestMsg('Koneksi Groq Whisper berhasil terhubung!');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestState('error');
      setTestMsg(msg);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch (e) {
      console.error(e);
    }
  };

  const handleMinimizeToTray = async () => {
    try {
      await invoke('hide_main_window');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="header-brand">
          <div className="logo-badge">
            <Mic size={20} className="logo-icon" />
          </div>
          <div>
            <h1 className="brand-title">LioSpeak</h1>
            <p className="brand-subtitle">AI Dictation & Voice Typing</p>
          </div>
        </div>

        <div className="header-actions">
          <span className="status-badge ready">
            <span className="pulse-dot" />
            Siap Mendikte
          </span>
          <button
            className="btn-icon"
            onClick={handleMinimizeToTray}
            title="Sembunyikan ke Menu Bar / System Tray"
          >
            <Minimize2 size={16} />
          </button>
        </div>
      </header>

      {/* SAVE TOAST */}
      {saveBanner && (
        <div className="save-toast">
          <Check size={14} /> Pengaturan tersimpan otomatis
        </div>
      )}

      {/* MAIN LAYOUT */}
      <div className="app-main">
        {/* SIDEBAR TABS */}
        <nav className="app-nav">
          <button
            className={`nav-item ${activeTab === 'shortcut' ? 'active' : ''}`}
            onClick={() => setActiveTab('shortcut')}
          >
            <Keyboard size={18} />
            <span>Shortcut & Kontrol</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'engine' ? 'active' : ''}`}
            onClick={() => setActiveTab('engine')}
          >
            <Sparkles size={18} />
            <span>Model AI & Biaya</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'prompt' ? 'active' : ''}`}
            onClick={() => setActiveTab('prompt')}
          >
            <Settings size={18} />
            <span>Gaya Penulisan</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <Clock size={18} />
            <span>Riwayat Dikte ({config.history?.length || 0})</span>
          </button>
        </nav>

        {/* CONTENT AREA */}
        <main className="app-content">
          {/* TAB 1: SHORTCUT & CONTROL */}
          {activeTab === 'shortcut' && (
            <div className="tab-pane">
              <div className="section-title">
                <h2>Shortcut Global</h2>
                <p>Tekan tombol ini di aplikasi atau kolom teks manapun untuk mulai mengetik dengan suara.</p>
              </div>

              <div className="card-box">
                <label className="field-label">Pilih Kombinasi Shortcut</label>
                <div className="shortcut-presets-grid">
                  {SHORTCUT_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      className={`btn-chip ${config.shortcut === preset.value ? 'selected' : ''}`}
                      onClick={() => updateConfig({ shortcut: preset.value })}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="custom-shortcut-row">
                  <label className="field-sublabel">Atau ketik shortcut custom:</label>
                  <input
                    type="text"
                    className="text-input"
                    value={config.shortcut}
                    placeholder="Contoh: CommandOrControl+Shift+Space"
                    onChange={(e) => updateConfig({ shortcut: e.target.value })}
                  />
                </div>
              </div>

              <div className="card-box">
                <label className="field-label">Mode Pemicu Dikte</label>
                <div className="mode-options-grid">
                  <div
                    className={`mode-option ${config.mode === 'toggle' ? 'selected' : ''}`}
                    onClick={() => updateConfig({ mode: 'toggle' })}
                  >
                    <div className="mode-header">
                      <Radio size={16} className="mode-radio" />
                      <strong>Toggle (Tekan Sekali)</strong>
                    </div>
                    <p>Tekan shortcut sekali untuk mulai merekam, tekan sekali lagi untuk langsung mengetikkan hasil ke layar.</p>
                  </div>

                  <div
                    className={`mode-option ${config.mode === 'push-to-talk' ? 'selected' : ''}`}
                    onClick={() => updateConfig({ mode: 'push-to-talk' })}
                  >
                    <div className="mode-header">
                      <Radio size={16} className="mode-radio" />
                      <strong>Push-to-Talk (Tahan Tombol)</strong>
                    </div>
                    <p>Tahan shortcut saat berbicara, dan lepaskan tombol saat selesai untuk langsung mengetik.</p>
                  </div>
                </div>
              </div>

              <div className="card-box info-callout">
                <Mic size={18} className="info-icon" />
                <div>
                  <strong>Cara Kerja Pengetikan:</strong>
                  <p>
                    Saat hasil suara selesai ditranskripsi, LioSpeak akan otomatis menempelkan teks langsung ke posisi kursor kamu yang sedang aktif melalui simulasi keystroke (Cmd+V di Mac, Ctrl+V di Windows/Linux).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AI ENGINE & API KEY */}
          {activeTab === 'engine' && (
            <div className="tab-pane">
              <div className="section-title">
                <h2>Mesin Speech-to-Text & Biaya</h2>
                <p>Pilih model LLM/STT yang optimal untuk Bahasa Indonesia dan Bahasa Inggris.</p>
              </div>

              <div className="engine-cards-grid">
                {/* GEMINI CARD */}
                <div
                  className={`engine-card ${config.engine === 'gemini' ? 'selected' : ''}`}
                  onClick={() => updateConfig({ engine: 'gemini' })}
                >
                  <div className="engine-card-badge">Paling Baru & Akurat</div>
                  <div className="engine-card-header">
                    <Sparkles size={20} className="engine-icon gemini" />
                    <div>
                      <h3>Google Gemini 3.5 Transcribe</h3>
                      <span className="price-tag">Dedicated Speech-to-Text / Free Tier</span>
                    </div>
                  </div>
                  <p className="engine-desc">
                    Model khusus transkripsi dari Google: otomatis membuang filler kata gumam (*"um"*, *"eh"*), memperbaiki koreksi diri (*"hari Selasa, eh bukan, Rabu"*), dan sangat akurat untuk campuran Indo-Inggris.
                  </p>
                </div>

                {/* GROQ CARD */}
                <div
                  className={`engine-card ${config.engine === 'groq' ? 'selected' : ''}`}
                  onClick={() => updateConfig({ engine: 'groq' })}
                >
                  <div className="engine-card-badge fast">Super Cepat</div>
                  <div className="engine-card-header">
                    <RotateCw size={20} className="engine-icon groq" />
                    <div>
                      <h3>Groq Whisper Large v3</h3>
                      <span className="price-tag">Gratis / ~Rp 650 per jam</span>
                    </div>
                  </div>
                  <p className="engine-desc">
                    Model Whisper OpenAI v3 bertenaga chip Groq LPU dengan latensi ultra-cepat (~250ms).
                  </p>
                </div>
              </div>

              {/* GEMINI MODEL SELECTOR (IF GEMINI SELECTED) */}
              {config.engine === 'gemini' && (
                <div className="card-box">
                  <label className="field-label">Varian Model Gemini</label>
                  <div className="shortcut-presets-grid">
                    <button
                      className={`btn-chip ${config.geminiModel === 'gemini-3.5-transcribe' ? 'selected' : ''}`}
                      onClick={() => updateConfig({ geminiModel: 'gemini-3.5-transcribe' })}
                    >
                      Gemini 3.5 Transcribe (Model Khusus STT)
                    </button>
                    <button
                      className={`btn-chip ${config.geminiModel === 'gemini-2.0-flash' ? 'selected' : ''}`}
                      onClick={() => updateConfig({ geminiModel: 'gemini-2.0-flash' })}
                    >
                      Gemini 2.0 Flash (Multimodal)
                    </button>
                    <button
                      className={`btn-chip ${config.geminiModel === 'gemini-2.5-flash' ? 'selected' : ''}`}
                      onClick={() => updateConfig({ geminiModel: 'gemini-2.5-flash' })}
                    >
                      Gemini 2.5 Flash
                    </button>
                  </div>
                </div>
              )}

              {/* API KEY INPUT */}
              <div className="card-box">
                <div className="field-header-row">
                  <label className="field-label">
                    {config.engine === 'gemini' ? 'Google AI Studio API Key' : 'Groq API Key'}
                  </label>
                  <button
                    className="btn-link"
                    onClick={() => {
                      const url =
                        config.engine === 'gemini'
                          ? 'https://aistudio.google.com/app/apikey'
                          : 'https://console.groq.com/keys';
                      openUrl(url).catch(() => window.open(url, '_blank'));
                    }}
                  >
                    Dapatkan Key Gratis <ExternalLink size={12} />
                  </button>
                </div>

                <div className="api-input-wrap">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    className="text-input"
                    placeholder={
                      config.engine === 'gemini'
                        ? 'Contoh: AIzaSy...'
                        : 'Contoh: gsk_...'
                    }
                    value={config.engine === 'gemini' ? config.geminiApiKey : config.groqApiKey}
                    onChange={(e) => {
                      if (config.engine === 'gemini') {
                        updateConfig({ geminiApiKey: e.target.value });
                      } else {
                        updateConfig({ groqApiKey: e.target.value });
                      }
                    }}
                  />
                  <button
                    className="btn-icon-inner"
                    onClick={() => setShowApiKey(!showApiKey)}
                    title={showApiKey ? 'Sembunyikan' : 'Tampilkan'}
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <div className="test-action-row">
                  <button
                    className="btn-secondary"
                    onClick={handleTestApiKey}
                    disabled={testState === 'testing'}
                  >
                    {testState === 'testing' ? 'Memverifikasi...' : 'Uji Koneksi API'}
                  </button>

                  {testState === 'success' && (
                    <span className="test-feedback success">
                      <Check size={14} /> {testMsg}
                    </span>
                  )}
                  {testState === 'error' && (
                    <span className="test-feedback error">{testMsg}</span>
                  )}
                </div>
              </div>

              {/* LANGUAGE SELECTION */}
              <div className="card-box">
                <label className="field-label">Preferensi Bahasa</label>
                <div className="lang-options">
                  <button
                    className={`btn-chip ${config.language === 'auto' ? 'selected' : ''}`}
                    onClick={() => updateConfig({ language: 'auto' })}
                  >
                    Otomatis (Indo + English Campur)
                  </button>
                  <button
                    className={`btn-chip ${config.language === 'id' ? 'selected' : ''}`}
                    onClick={() => updateConfig({ language: 'id' })}
                  >
                    Bahasa Indonesia
                  </button>
                  <button
                    className={`btn-chip ${config.language === 'en' ? 'selected' : ''}`}
                    onClick={() => updateConfig({ language: 'en' })}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PROMPT & FORMAT */}
          {activeTab === 'prompt' && (
            <div className="tab-pane">
              <div className="section-title">
                <h2>Gaya Penulisan & Prompt Instruksi</h2>
                <p>Kendalikan bagaimana AI memformat tanda baca, istilah teknis, dan gaya bahasa.</p>
              </div>

              <div className="card-box">
                <label className="field-label">Pilihan Preset Gaya</label>
                <div className="preset-buttons-row">
                  <button
                    className="btn-chip"
                    onClick={() => updateConfig({ systemPrompt: PROMPT_PRESETS.default })}
                  >
                    Standar (Tanda Baca Otomatis & Bersih)
                  </button>
                  <button
                    className="btn-chip"
                    onClick={() => updateConfig({ systemPrompt: PROMPT_PRESETS.code })}
                  >
                    Coding / Programmer Mode
                  </button>
                  <button
                    className="btn-chip"
                    onClick={() => updateConfig({ systemPrompt: PROMPT_PRESETS.formal })}
                  >
                    Formal / Bahasa Baku
                  </button>
                </div>

                <div className="prompt-editor-wrap">
                  <label className="field-sublabel">Prompt Kustom (System Instructions):</label>
                  <textarea
                    className="textarea-input"
                    rows={8}
                    value={config.systemPrompt}
                    onChange={(e) => updateConfig({ systemPrompt: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: HISTORY */}
          {activeTab === 'history' && (
            <div className="tab-pane">
              <div className="section-title history-title-row">
                <div>
                  <h2>Riwayat Dikte</h2>
                  <p>Daftar transkripsi suara terakhir yang telah diketik.</p>
                </div>
                {config.history?.length > 0 && (
                  <button
                    className="btn-danger-outline"
                    onClick={() => {
                      clearHistory();
                      setConfig(loadConfig());
                    }}
                  >
                    <Trash2 size={14} /> Hapus Riwayat
                  </button>
                )}
              </div>

              {(!config.history || config.history.length === 0) ? (
                <div className="empty-history">
                  <Clock size={40} className="empty-icon" />
                  <p>Belum ada riwayat dikte.</p>
                  <span>Tekan shortcut kamu di aplikasi apapun untuk mulai mengetik dengan suara.</span>
                </div>
              ) : (
                <div className="history-list">
                  {config.history.map((item) => (
                    <div key={item.id} className="history-item">
                      <div className="history-header">
                        <span className="history-time">
                          {new Date(item.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                        <div className="history-badges">
                          <span className={`engine-mini-badge ${item.engine}`}>
                            {item.engine === 'gemini' ? 'Gemini 2.0' : 'Groq'}
                          </span>
                          <span className="duration-mini-badge">
                            {(item.durationMs / 1000).toFixed(1)}s
                          </span>
                          <button
                            className="btn-icon-tiny"
                            onClick={() => copyToClipboard(item.text, item.id)}
                            title="Salin ke clipboard"
                          >
                            {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>
                      <p className="history-text">{item.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
