import { register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { AudioRecorder } from './audioRecorder';
import { transcribeAudio } from './sttService';
import { loadConfig, addHistoryItem } from './configStore';

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

  constructor() {
    this.recorder = new AudioRecorder((volume) => {
      this.broadcastStatus({ state: 'listening', volume });
    });
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
    if (this.state !== 'idle') return;

    try {
      await invoke('show_overlay');
      await this.broadcastStatus({ state: 'listening', volume: 0 });
      await this.recorder?.start();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('Failed to start recording:', err);
      await this.broadcastStatus({ state: 'error', error: errorMsg });
      setTimeout(async () => {
        await invoke('hide_overlay');
        await this.broadcastStatus({ state: 'idle' });
      }, 3000);
    }
  }

  public async stopAndTranscribe(): Promise<void> {
    if (this.state !== 'listening' || !this.recorder) return;

    try {
      await this.broadcastStatus({ state: 'transcribing' });
      const recordResult = await this.recorder.stop();

      // Skip empty or micro recordings (<300ms)
      if (recordResult.durationMs < 300) {
        await invoke('hide_overlay');
        await this.broadcastStatus({ state: 'idle' });
        return;
      }

      const config = loadConfig();
      const sttResult = await transcribeAudio(recordResult, config);

      if (!sttResult.text || !sttResult.text.trim()) {
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
      await invoke('paste_text', { text: finalText });

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
      console.error('Transcription error:', err);
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
