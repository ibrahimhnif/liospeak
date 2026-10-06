import { register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { AudioRecorder } from './audioRecorder';
import { transcribeAudio } from './sttService';
import { loadConfig, addHistoryItem } from './configStore';
import { termLog } from './logger';

export type DictationState = 'idle' | 'listening' | 'transcribing' | 'done' | 'error';

export interface DictationStatusEvent {
  state: DictationState;
  text?: string;
  error?: string;
  volume?: number;
}

class DictationCoordinator {
  private recorder: AudioRecorder | null = null;
  private state: DictationState = 'idle';
  private currentShortcut = '';
  private lastFnPressTime = 0;
  private isEnabled = true;
  private startPromise: Promise<void> | null = null;

  constructor() {
    // Crucial: Only initialize in MAIN window, never in the overlay HUD window!
    const isOverlay = typeof window !== 'undefined' && window.location.hash.includes('overlay');
    if (isOverlay) {
      this.isEnabled = false;
      return;
    }

    this.recorder = new AudioRecorder((volume) => {
      this.broadcastStatus({ state: 'listening', volume });
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
    try {
      listen<string>('fn-key-state', async (event) => {
        const config = loadConfig();
        if (!config.useFnKeyMac) return;

        const isPressed = event.payload === 'pressed';
        const fnMode = config.fnMode || 'hold';

        if (fnMode === 'hold') {
          // Push-to-Talk via Fn key
          if (isPressed) {
            if (this.state === 'idle') {
              await this.startRecording();
            }
          } else {
            if (this.state === 'listening') {
              await this.stopAndTranscribe();
            }
          }
        } else if (fnMode === 'double-tap') {
          // Double-Tap Fn to toggle
          if (isPressed) {
            const now = Date.now();
            if (now - this.lastFnPressTime < 450) {
              if (this.state === 'idle') {
                await this.startRecording();
              } else if (this.state === 'listening') {
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
        await unregister(this.currentShortcut);
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
            if (this.state === 'idle') {
              await this.startRecording();
            }
          } else if (event.state === 'Released') {
            if (this.state === 'listening') {
              await this.stopAndTranscribe();
            }
          }
        } else {
          // Toggle mode: trigger only on Pressed
          if (event.state === 'Pressed') {
            if (this.state === 'idle') {
              await this.startRecording();
            } else if (this.state === 'listening') {
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
    if (this.state !== 'idle') {
      termLog(`startRecording diabaikan karena status saat ini: ${this.state}`, 'warn');
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
    if (this.state !== 'listening' || !this.recorder) {
      termLog(`stopAndTranscribe diabaikan karena status: ${this.state}`, 'warn');
      return;
    }

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

      // 1. Paste text automatically to the user's active cursor
      termLog(`Menempelkan teks ke kursor via paste_text (${finalText.length} karakter)...`, 'info');
      await invoke('paste_text', { text: finalText });
      termLog('Teks berhasil ditempelkan ke aplikasi aktif!', 'info');

      // 2. Add to history
      addHistoryItem({
        text: finalText,
        timestamp: Date.now(),
        engine: sttResult.engine,
        durationMs: recordResult.durationMs,
      });

      // 3. Show success status on overlay
      await this.broadcastStatus({ state: 'done', text: finalText });

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
