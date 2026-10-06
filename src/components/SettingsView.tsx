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
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  const [recordedPreview, setRecordedPreview] = useState('');

  const formatModifier = (mod: string) => {
    if (mod === 'CommandOrControl') return '⌘ Cmd / Ctrl';
    if (mod === 'Shift') return '⇧ Shift';
    if (mod === 'Alt') return '⌥ Option / Alt';
    return mod;
  };

  const handleShortcutKeyDown = (e: React.KeyboardEvent) => {
    if (!isRecordingShortcut) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      setIsRecordingShortcut(false);
      setRecordedPreview('');
      return;
    }

    const modifiers: string[] = [];
    if (e.metaKey || e.ctrlKey) modifiers.push('CommandOrControl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');

    // If only a modifier was pressed, update preview
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
      setRecordedPreview(modifiers.map(formatModifier).join(' + ') + ' + ...');
      return;
    }

    // A final non-modifier key was pressed
    let keyName = e.key;
    if (e.code === 'Space') {
      keyName = 'Space';
    } else if (/^F\d+$/.test(e.key)) {
      keyName = e.key;
    } else if (e.key.length === 1) {
      keyName = e.key.toUpperCase();
    } else {
      keyName = e.code.replace('Key', '').replace('Digit', '');
    }

    const parts = [...modifiers, keyName];
    const newShortcut = parts.join('+');

    updateConfig({ shortcut: newShortcut });
    setIsRecordingShortcut(false);
    setRecordedPreview('');
  };

  const renderKeyBadges = (shortcutStr: string) => {
    if (!shortcutStr) return <span className="key-badge">Belum diatur</span>;
    const parts = shortcutStr.split('+');
    return parts.map((part, idx) => {
      let label = part;
      if (part === 'CommandOrControl') label = '⌘ Cmd / Ctrl';
      else if (part === 'Shift') label = '⇧ Shift';
      else if (part === 'Alt') label = '⌥ Option / Alt';
      else if (part === 'Space') label = 'Space ␣';

      return (
        <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          {idx > 0 && <span className="key-badge-plus">+</span>}
          <span className="key-badge">{label}</span>
        </span>
      );
    });
  };

  useEffect(() => {
    // Initial shortcut registration
    dictationCoordinator.updateShortcut(config.shortcut).catch((e) => {
      console.error('Failed to bind initial shortcut:', e);
    });
    // Pre-warm microphone so recording starts with zero latency
    dictationCoordinator.prewarm().catch((e) => {
      console.warn('Pre-warm error:', e);
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

    if (patch.useFnKeyMac !== undefined) {
      dictationCoordinator.updateFnListener(patch.useFnKeyMac);
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
        const testModel = config.geminiModel === 'gemini-3.8-flash' ? 'gemini-3.8-flash' : 'gemini-3.8-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent?key=${encodeURIComponent(
          config.geminiApiKey.trim()
        )}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.geminiApiKey.trim(),
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Respond with OK.' }] }],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message || `HTTP ${res.status}`);
        }
        setTestState('success');
        setTestMsg('Koneksi Google Gemini API berhasil terhubung!');
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

              {/* INTERACTIVE SHORTCUT RECORDER CARD */}
              <div className="card-box shortcut-recorder-card">
                <div className="field-header-row">
                  <label className="field-label">Tombol Shortcut Saat Ini</label>
                  {isRecordingShortcut ? (
                    <button
                      className="btn-link"
                      style={{ color: '#f87171' }}
                      onClick={() => {
                        setIsRecordingShortcut(false);
                        setRecordedPreview('');
                      }}
                    >
                      Batal (Esc)
                    </button>
                  ) : (
                    <button
                      className="btn-link"
                      onClick={() => updateConfig({ shortcut: 'CommandOrControl+Shift+Space' })}
                    >
                      Reset ke Default
                    </button>
                  )}
                </div>

                <div
                  tabIndex={0}
                  className={`shortcut-box-interactive ${isRecordingShortcut ? 'recording' : ''}`}
                  onClick={() => {
                    if (!isRecordingShortcut) {
                      setIsRecordingShortcut(true);
                      setRecordedPreview('');
                    }
                  }}
                  onKeyDown={handleShortcutKeyDown}
                  title="Klik untuk merekam tombol baru"
                >
                  {isRecordingShortcut ? (
                    <div className="recording-indicator">
                      <span className="rec-dot" />
                      <div>
                        <div className="recording-text">
                          {recordedPreview || 'Tekan kombinasi tombol di keyboard kamu...'}
                        </div>
                        <div className="recording-hint">
                          Tahan tombol modifier (Cmd/Ctrl, Shift, Alt) lalu tekan tombol utama (cth: Space, D, K)
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="shortcut-keys-row">
                        {renderKeyBadges(config.shortcut)}
                      </div>
                      <button
                        className="btn-record-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsRecordingShortcut(true);
                          setRecordedPreview('');
                        }}
                      >
                        <Keyboard size={14} /> Ganti Shortcut
                      </button>
                    </>
                  )}
                </div>

                <div className="custom-shortcut-row" style={{ marginTop: '10px' }}>
                  <label className="field-sublabel">Atau pilih dari preset cepat:</label>
                  <div className="shortcut-presets-grid" style={{ marginTop: '6px' }}>
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
                </div>
              </div>

              {/* DEDICATED MAC FN KEY CARD */}
              <div className="card-box">
                <div className="field-header-row">
                  <div>
                    <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>🌐 Tombol Fn / Globe (Khusus Mac)</span>
                      <span className="engine-card-badge" style={{ position: 'static' }}>Mac Native</span>
                    </label>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Gunakan tombol Fn sendirian sebagai tombol dikte cepat tanpa perlu kombinasi tombol lain.
                    </p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={config.useFnKeyMac}
                      onChange={(e) => updateConfig({ useFnKeyMac: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>

                {config.useFnKeyMac && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div className="mode-options-grid">
                      <div
                        className={`mode-option ${config.fnMode === 'hold' ? 'selected' : ''}`}
                        onClick={() => updateConfig({ fnMode: 'hold' })}
                      >
                        <div className="mode-header">
                          <Radio size={16} className="mode-radio" />
                          <strong>Tahan Tombol Fn (Push-to-Talk)</strong>
                        </div>
                        <p>Tahan tombol Fn saat berbicara, lepaskan untuk langsung mengetik hasil ke aplikasi aktif.</p>
                      </div>

                      <div
                        className={`mode-option ${config.fnMode === 'double-tap' ? 'selected' : ''}`}
                        onClick={() => updateConfig({ fnMode: 'double-tap' })}
                      >
                        <div className="mode-header">
                          <Radio size={16} className="mode-radio" />
                          <strong>Tekan Fn 2x Cepat (Double-Tap)</strong>
                        </div>
                        <p>Tekan tombol Fn dua kali berturut-turut untuk mulai atau selesai mendikte (seperti dikte asli Apple).</p>
                      </div>
                    </div>

                    <div className="info-callout" style={{ fontSize: '11px', padding: '10px 14px' }}>
                      <span>
                        💡 <strong>Tips macOS:</strong> Agar tombol Fn tidak membuka Emoji bawaan Mac, buka <strong>System Settings → Keyboard → 'Press 🌐 key to'</strong> lalu pilih <strong>'Do Nothing'</strong>.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="card-box">
                <label className="field-label">Mode Pemicu Shortcut Standar</label>
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

              {/* TRAILING AUDIO BUFFER / STOP PADDING CARD */}
              <div className="card-box">
                <div className="field-header-row">
                  <div>
                    <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={16} style={{ color: 'var(--primary)' }} />
                      <span>Jeda Akhir Rekaman (Trailing Buffer)</span>
                      <span className="engine-card-badge" style={{ position: 'static' }}>Anti-Potong</span>
                    </label>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Menjaga mikrofon tetap merekam beberapa milidetik setelah tombol dilepas agar suku kata atau kata terakhir tidak terpotong sebelum ditranskripsi.
                    </p>
                  </div>
                  <span className="key-badge" style={{ fontSize: '12px', padding: '4px 10px' }}>
                    {config.stopPaddingMs ?? 400} ms
                  </span>
                </div>

                <div className="shortcut-presets-grid" style={{ marginTop: '12px' }}>
                  {[
                    { label: '150 ms (Cepat)', value: 150 },
                    { label: '300 ms (Standar)', value: 300 },
                    { label: '400 ms (Direkomendasikan)', value: 400 },
                    { label: '600 ms (Ekstra Aman)', value: 600 },
                  ].map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className={`btn-chip ${(config.stopPaddingMs ?? 400) === preset.value ? 'selected' : ''}`}
                      onClick={() => updateConfig({ stopPaddingMs: preset.value })}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input
                    type="range"
                    min="100"
                    max="1000"
                    step="50"
                    value={config.stopPaddingMs ?? 400}
                    onChange={(e) => updateConfig({ stopPaddingMs: Number(e.target.value) })}
                    style={{ flex: 1, accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '70px', textAlign: 'right' }}>
                    {config.stopPaddingMs ?? 400} ms
                  </span>
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
                      className={`btn-chip ${config.geminiModel === 'gemini-3.8-flash' ? 'selected' : ''}`}
                      onClick={() => updateConfig({ geminiModel: 'gemini-3.8-flash' })}
                    >
                      Gemini 3.8 Flash (Multimodal Flagship Audio)
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
