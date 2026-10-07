import { register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AudioRecorder } from './audioRecorder';
import { transcribeAudio } from './sttService';
import { loadConfig, addHistoryItem } from './configStore';
import { termLog } from './logger';

export type DictationState = 'idle' | 'listening' | 'transcribing' | 'done' | 'error';

export interface DictationStatusEvent {
  state: DictationState;
  text?: string;
  error?: string;
  warning?: string;
  isInputField?: boolean;
  volume?: number;
  durationMs?: number;
  costUsd?: number;
  formattedCost?: string;
}

class DictationCoordinator {
  private recorder: AudioRecorder | null = null;
  private state: DictationState = 'idle';
  private currentShortcut = '';
  private lastFnPressTime = 0;
  private isEnabled = true;
  private startPromise: Promise<void> | null = null;
  private unlistenFn: (() => void) | null = null;
  private isProcessing = false;
  private lastTriggerTime = 0;
  private lastPastedText = '';
  private lastPasteTimestamp = 0;

  constructor() {
    // 1. Strict Window Guard: Only initialize in MAIN window, NEVER in overlay HUD!
    let isOverlay = false;
    try {
      const current = getCurrentWebviewWindow();
      if (current && current.label === 'overlay') {
        isOverlay = true;
      }
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined' && window.location.hash.includes('overlay')) {
      isOverlay = true;
    }

    if (isOverlay) {
      this.isEnabled = false;
      return;
    }

    // 2. Global Runtime Singleton: Prevent double-instantiation from HMR or multiple imports
    const win = typeof window !== 'undefined' ? (window as unknown as { __liospeak_coord_active__?: boolean }) : undefined;
    if (win) {
      if (win.__liospeak_coord_active__) {
        this.isEnabled = false;
        return;
      }
      win.__liospeak_coord_active__ = true;
    }

    this.recorder = new AudioRecorder((volume) => {
      // ONLY broadcast listening state if coordinator is currently listening and not processing
      if (this.state === 'listening' && !this.isProcessing) {
        this.broadcastStatus({ state: 'listening', volume });
      }
    });

    // Automatically pre-warm mic on startup so recording is instantaneous
    this.recorder.prewarm().catch((e) => {
      console.warn('Background mic prewarm notice:', e);
    });

    this.setupFnKeyListener();
  }

  public async prewarm(): Promise<void> {
    if (this.recorder) {
      await this.recorder.prewarm();
    }
  }

  private async setupFnKeyListener() {
    if (!this.isEnabled) return;
    try {
      if (this.unlistenFn) {
        this.unlistenFn();
        this.unlistenFn = null;
      }

      this.unlistenFn = await listen<string>('fn-key-state', async (event) => {
        const config = loadConfig();
        if (!config.useFnKeyMac) return;

        const isPressed = event.payload === 'pressed';
        const fnMode = config.fnMode || 'hold';

        if (fnMode === 'hold') {
          // Push-to-Talk via Fn key
          if (isPressed) {
            if (this.state === 'idle' && !this.isProcessing) {
              await this.startRecording();
            }
          } else {
            if (this.state === 'listening' && !this.isProcessing) {
              await this.stopAndTranscribe();
            }
          }
        } else if (fnMode === 'double-tap') {
          // Double-Tap Fn to toggle
          if (isPressed) {
            const now = Date.now();
            if (now - this.lastFnPressTime < 450) {
              if (this.state === 'idle' && !this.isProcessing) {
                await this.startRecording();
              } else if (this.state === 'listening' && !this.isProcessing) {
                await this.stopAndTranscribe();
              }
              this.lastFnPressTime = 0;
            } else {
              this.lastFnPressTime = now;
            }
          }
        }
      });

      const initialConfig = loadConfig();
      if (initialConfig.useFnKeyMac) {
        await invoke('set_fn_listener_enabled', { enabled: true });
      }
    } catch (e) {
      console.warn('Fn key listener setup warning:', e);
    }
  }

  public async updateFnListener(enabled: boolean): Promise<void> {
    try {
      await invoke('set_fn_listener_enabled', { enabled });
    } catch (e) {
      console.warn('Failed to update Fn listener state:', e);
    }
  }

  public getState(): DictationState {
    return this.state;
  }

  private async broadcastStatus(event: DictationStatusEvent) {
    this.state = event.state;
    // Broadcast locally in this window
    window.dispatchEvent(new CustomEvent('liospeak_status', { detail: event }));
    // Broadcast across all Tauri windows (including floating overlay HUD)
    try {
      await emit('liospeak_status_event', event);
    } catch {
      // ignore
    }
  }

  public async updateShortcut(newShortcut: string): Promise<void> {
    if (!this.isEnabled) return;
    try {
      if (this.currentShortcut) {
        await unregister(this.currentShortcut).catch(() => {});
      }
      if (newShortcut?.trim()) {
        await unregister(newShortcut.trim()).catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to unregister previous shortcut:', e);
    }

    if (!newShortcut?.trim()) return;

    try {
      await register(newShortcut.trim(), async (event) => {
        const config = loadConfig();
        const isPushToTalk = config.mode === 'push-to-talk';

        if (isPushToTalk) {
          if (event.state === 'Pressed') {
            if (this.state === 'idle' && !this.isProcessing) {
              await this.startRecording();
            }
          } else if (event.state === 'Released') {
            if (this.state === 'listening' && !this.isProcessing) {
              await this.stopAndTranscribe();
            }
          }
        } else {
          // Toggle mode: trigger only on Pressed
          if (event.state === 'Pressed') {
            if (this.state === 'idle' && !this.isProcessing) {
              await this.startRecording();
            } else if (this.state === 'listening' && !this.isProcessing) {
              await this.stopAndTranscribe();
            }
          }
        }
      });
      this.currentShortcut = newShortcut.trim();
      console.log(`Global shortcut registered: ${this.currentShortcut}`);
    } catch (err) {
      console.error(`Failed to register shortcut ${newShortcut}:`, err);
      throw err;
    }
  }

  public async startRecording(): Promise<void> {
    if (!this.isEnabled) return;
    const now = Date.now();
    if (now - this.lastTriggerTime < 350) {
      termLog(`[Debounce] startRecording diabaikan (${now - this.lastTriggerTime}ms)`, 'warn');
      return;
    }
    this.lastTriggerTime = now;

    if (this.state !== 'idle' || this.isProcessing) {
      termLog(`startRecording diabaikan karena status: ${this.state}, isProcessing: ${this.isProcessing}`, 'warn');
      return;
    }

    termLog('>>> [TRIGGER] Memulai proses dikte...', 'info');
    try {
      // 1. Start audio recording IMMEDIATELY in parallel with UI/Window operations
      const startAudioPromise = this.recorder ? this.recorder.start() : Promise.resolve();
      this.startPromise = startAudioPromise;

      // 2. Concurrently show overlay and broadcast listening status
      const showOverlayPromise = invoke('show_overlay').catch((err) => {
        termLog(`Warning show_overlay: ${err}`, 'warn');
      });
      const broadcastPromise = this.broadcastStatus({ state: 'listening', volume: 0 });

      await Promise.all([startAudioPromise, showOverlayPromise, broadcastPromise]);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      termLog(`Gagal memulai perekaman: ${errorMsg}`, 'error');
      await this.broadcastStatus({ state: 'error', error: errorMsg });
      setTimeout(async () => {
        await invoke('hide_overlay');
        await this.broadcastStatus({ state: 'idle' });
      }, 3500);
    } finally {
      this.startPromise = null;
    }
  }

  public async stopAndTranscribe(): Promise<void> {
    const now = Date.now();
    if (now - this.lastTriggerTime < 350) {
      termLog(`[Debounce] stopAndTranscribe diabaikan (${now - this.lastTriggerTime}ms)`, 'warn');
      return;
    }
    this.lastTriggerTime = now;

    // Strict atomic lock: Must be in listening state and not already processing!
    if (this.state !== 'listening' || this.isProcessing || !this.recorder) {
      termLog(`[Lock] stopAndTranscribe diabaikan (state: ${this.state}, isProcessing: ${this.isProcessing})`, 'warn');
      return;
    }

    // SYNCHRONOUSLY lock state immediately before ANY await!
    this.isProcessing = true;
    this.state = 'transcribing';

    termLog('>>> [TRIGGER] Menghentikan rekaman & memulai transkripsi...', 'info');

    // If start is still initializing in the background, wait for it before stopping!
    if (this.startPromise) {
      termLog('Menunggu proses inisialisasi perekam selesai sebelum menghentikan...', 'info');
      try {
        await this.startPromise;
      } catch (e) {
        termLog(`Perekaman gagal saat ditunggu di stopAndTranscribe: ${e}`, 'warn');
      }
    }

    try {
      // 1. Immediately provide visual feedback in the HUD
      await this.broadcastStatus({ state: 'transcribing' });

      // 2. Load configured trailing padding (default 400ms)
      const config = loadConfig();
      const paddingMs = typeof config.stopPaddingMs === 'number' ? config.stopPaddingMs : 400;

      // 3. Stop audio recording with trailing grace period to ensure no cut-off syllables
      const recordResult = await this.recorder.stop(paddingMs);

      // 4. Firmly maintain transcribing state in HUD during the STT network call
      await this.broadcastStatus({ state: 'transcribing' });

      termLog(
        `Audio ditangkap: durasi ${(recordResult.durationMs / 1000).toFixed(2)}s, ukuran ${(recordResult.blob.size / 1024).toFixed(1)} KB`,
        'info'
      );

      // Skip empty or micro recordings (<300ms)
      if (recordResult.durationMs < 300) {
        termLog('Rekaman terlalu singkat (<300ms), diabaikan.', 'warn');
        await invoke('hide_overlay');
        await this.broadcastStatus({ state: 'idle' });
        return;
      }

      termLog(`Memanggil STT Engine: ${config.engine} (Model: ${config.geminiModel || 'default'})...`, 'info');
      const sttResult = await transcribeAudio(recordResult, config);

      termLog(`Hasil Transkripsi Diterima: "${sttResult.text}"`, 'info');

      if (!sttResult.text || !sttResult.text.trim()) {
        termLog('Teks hasil transkripsi kosong / tidak ada suara.', 'warn');
        await this.broadcastStatus({
          state: 'error',
          error: 'Tidak ada suara yang terdeteksi.',
        });
        setTimeout(async () => {
          await invoke('hide_overlay');
          await this.broadcastStatus({ state: 'idle' });
        }, 1500);
        return;
      }

      const finalText = sttResult.text.trim();

      // 1. Detect if active cursor is focused on an editable input field
      let isInputField = true;
      try {
        isInputField = await invoke<boolean>('check_is_input_field');
        termLog(`[Input Detection] Apakah kursor berada di kolom teks? -> ${isInputField}`, 'info');
      } catch (err) {
        console.warn('Gagal mengecek status input field:', err);
      }

      // Deduplicate: If identical text is being pasted within 2500ms, suppress duplicate paste
      const pasteNow = Date.now();
      if (this.lastPastedText === finalText && pasteNow - this.lastPasteTimestamp < 2500) {
        termLog(`[Deduplicate] Menolak penempelan duplikat untuk teks yang sama dalam 2.5s: "${finalText}"`, 'warn');
      } else {
        this.lastPastedText = finalText;
        this.lastPasteTimestamp = pasteNow;

        // Paste text to active application/cursor
        termLog(`Menempelkan teks ke kursor via paste_text (${finalText.length} karakter)...`, 'info');
        await invoke('paste_text', { text: finalText });
        termLog('Teks berhasil disalin & ditempelkan ke aplikasi aktif!', 'info');
      }

      // 2. Add to history
      addHistoryItem({
        text: finalText,
        timestamp: Date.now(),
        engine: sttResult.engine,
        model: sttResult.model,
        durationMs: recordResult.durationMs,
        costUsd: sttResult.costUsd,
        costIdr: sttResult.costIdr,
      });

      // 3. Show success status on overlay with smart input indicator
      const warning = !isInputField ? 'Kursor di luar kolom teks (Tersalin ke clipboard)' : undefined;

      await this.broadcastStatus({
        state: 'done',
        text: finalText,
        warning,
        isInputField,
        durationMs: recordResult.durationMs,
        costUsd: sttResult.costUsd,
        formattedCost: sttResult.formattedCost,
      });

      // 4. Auto-hide overlay after 1.8 seconds
      setTimeout(async () => {
        await invoke('hide_overlay');
        await this.broadcastStatus({ state: 'idle' });
      }, 1800);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      termLog(`Transcription / Paste error: ${errorMsg}`, 'error');
      await this.broadcastStatus({ state: 'error', error: errorMsg });
      setTimeout(async () => {
        await invoke('hide_overlay');
        await this.broadcastStatus({ state: 'idle' });
      }, 3500);
    } finally {
      this.isProcessing = false;
    }
  }

  public async cleanup(): Promise<void> {
    try {
      await unregisterAll();
    } catch {
      // ignore
    }
  }
}

export const dictationCoordinator = new DictationCoordinator();
