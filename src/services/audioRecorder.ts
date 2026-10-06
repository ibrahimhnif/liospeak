import { termLog } from './logger';

export interface AudioRecordResult {
  blob: Blob;
  base64: string;
  durationMs: number;
  sampleRate: number;
}

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private inputNode: MediaStreamAudioSourceNode | null = null;
  private muteNode: GainNode | null = null;
  private pcmBuffers: Float32Array[] = [];
  private recording = false;
  private isStopping = false;
  private startPromise: Promise<void> | null = null;
  private prewarmPromise: Promise<void> | null = null;
  private startTime = 0;
  private chunkCount = 0;
  private onVolumeChange?: (volume: number) => void;

  constructor(onVolumeChange?: (volume: number) => void) {
    this.onVolumeChange = onVolumeChange;
  }

  public isRecording(): boolean {
    return this.recording;
  }

  /**
   * Pre-warms the microphone stream and AudioContext on app launch
   * so that recording starts with 0ms latency when the user triggers it.
   */
  public async prewarm(): Promise<void> {
    if (this.isStreamAlive()) return;
    if (this.prewarmPromise) return this.prewarmPromise;

    this.prewarmPromise = (async () => {
      try {
        termLog('[AudioRecorder] Memulai pre-warm mikrofon agar siap pakai tanpa delay...', 'info');
        await this.ensureStream();
        termLog('[AudioRecorder] Mikrofon berhasil di-prewarm & siap mendikte!', 'info');
      } catch (err) {
        termLog(`[AudioRecorder] Pre-warm notice: ${err}`, 'warn');
      } finally {
        this.prewarmPromise = null;
      }
    })();

    return this.prewarmPromise;
  }

  private isStreamAlive(): boolean {
    if (!this.mediaStream || !this.mediaStream.active) return false;
    const tracks = this.mediaStream.getAudioTracks();
    return tracks.length > 0 && tracks.some((t) => t.readyState === 'live');
  }

  private async ensureStream(): Promise<MediaStream> {
    if (this.isStreamAlive()) {
      return this.mediaStream!;
    }

    if (!navigator || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      const err =
        'Akses mikrofon tidak didukung atau diblokir oleh macOS. Pastikan izin mikrofon diizinkan di System Settings -> Privacy & Security -> Microphone.';
      termLog(err, 'error');
      throw new Error(err);
    }

    termLog('Meminta stream mikrofon via getUserMedia...', 'info');
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const tracks = this.mediaStream.getAudioTracks();
    termLog(
      `Mikrofon terhubung! Track count: ${tracks.length}, label: "${tracks[0]?.label || 'Microphone'}"`,
      'info'
    );

    return this.mediaStream;
  }

  public async start(): Promise<void> {
    if (this.recording) return;

    // If start is already in progress, return the existing promise
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      try {
        termLog('Memulai AudioRecorder...', 'info');
        this.pcmBuffers = [];
        this.chunkCount = 0;
        this.startTime = Date.now();

        // 1. Ensure stream is warm and ready
        await this.ensureStream();

        // 2. Initialize or resume AudioContext
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

        if (!this.audioContext || this.audioContext.state === 'closed') {
          this.audioContext = new AudioCtx();
          termLog(`AudioContext dibuat! Hardware sampleRate: ${this.audioContext.sampleRate}Hz`, 'info');
        }

        if (this.audioContext.state === 'suspended') {
          termLog('Resume AudioContext...', 'info');
          await this.audioContext.resume();
        }

        // 3. Connect audio processing nodes
        this.inputNode = this.audioContext.createMediaStreamSource(this.mediaStream!);
        // Using 2048 samples (~42ms at 48kHz) for lower buffering latency and smoother volume updates
        this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);

        this.processor.onaudioprocess = (e) => {
          if (!this.recording) return;

          const input = e.inputBuffer.getChannelData(0);
          const copy = new Float32Array(input.length);
          copy.set(input);
          this.pcmBuffers.push(copy);
          this.chunkCount++;

          // Do not calculate or fire volume updates once stopping has initiated
          if (this.isStopping) return;

          // Calculate RMS for visual volume meter
          let sum = 0;
          for (let i = 0; i < input.length; i++) {
            sum += input[i] * input[i];
          }
          const rms = Math.sqrt(sum / input.length);
          const normalized = Math.min(1.0, rms * 5.0);

          if (this.chunkCount % 10 === 1) {
            termLog(
              `[Perekaman] Chunk #${this.chunkCount} diterima: ${input.length} samples, RMS volume: ${normalized.toFixed(3)}`,
              'log'
            );
          }

          if (this.onVolumeChange) {
            this.onVolumeChange(normalized);
          }
        };

        // Connect through a zero-gain node to destination to avoid speaker feedback while keeping processor active
        this.muteNode = this.audioContext.createGain();
        this.muteNode.gain.value = 0.0;

        this.inputNode.connect(this.processor);
        this.processor.connect(this.muteNode);
        this.muteNode.connect(this.audioContext.destination);

        this.recording = true;
        this.isStopping = false;
        termLog('Perekaman audio aktif berjalan!', 'info');
      } finally {
        this.startPromise = null;
      }
    })();

    return this.startPromise;
  }

  public async stop(tailPaddingMs = 350): Promise<AudioRecordResult> {
    termLog(`Menghentikan perekaman audio... (total chunk diterima: ${this.chunkCount})`, 'info');
    this.isStopping = true;

    // If start is still initializing (e.g. quick tap), wait for it to finish first
    if (this.startPromise) {
      termLog('Menunggu inisialisasi perekaman selesai sebelum berhenti...', 'info');
      try {
        await this.startPromise;
      } catch {
        // if start failed, continue to throw
      }
    }

    if (!this.recording) {
      termLog('Stop dipanggil tapi status recording = false', 'warn');
      throw new Error('Perekam suara belum dimulai atau belum selesai inisialisasi.');
    }

    // Trailing buffer / grace period:
    // When the user finishes speaking or releases the key, human reflex causes them to release
    // the key at the exact moment the final syllable is spoken. Waiting tailPaddingMs ensures
    // the in-flight hardware audio buffer and trailing speech decay are fully captured.
    if (tailPaddingMs > 0) {
      termLog(
        `[AudioRecorder] Menahan trailing buffer (${tailPaddingMs}ms) agar kata/suku kata terakhir tidak terpotong...`,
        'info'
      );
      await new Promise((resolve) => setTimeout(resolve, tailPaddingMs));
    }

    this.recording = false;
    const durationMs = Date.now() - this.startTime;
    const inputSampleRate = this.audioContext?.sampleRate || 44100;

    // Disconnect active nodes to stop processing
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.muteNode) {
      this.muteNode.disconnect();
      this.muteNode = null;
    }
    if (this.inputNode) {
      this.inputNode.disconnect();
      this.inputNode = null;
    }

    // Suspend AudioContext to conserve CPU while idle, but DO NOT DESTROY mediaStream
    // Keeping mediaStream alive ensures next recording trigger is instantaneous (<1ms)!
    if (this.audioContext && this.audioContext.state === 'running') {
      try {
        await this.audioContext.suspend();
      } catch {
        // ignore
      }
    }

    termLog(
      `Perekaman selesai. Durasi: ${(durationMs / 1000).toFixed(2)} detik, Buffer count: ${this.pcmBuffers.length}`,
      'info'
    );

    if (this.pcmBuffers.length === 0) {
      const err = 'Tidak ada data audio yang tertangkap (0 chunk buffer).';
      termLog(err, 'error');
      throw new Error(err);
    }

    // Merge raw PCM buffers
    let totalLength = 0;
    for (const buf of this.pcmBuffers) {
      totalLength += buf.length;
    }
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of this.pcmBuffers) {
      merged.set(buf, offset);
      offset += buf.length;
    }

    termLog(`Merged raw samples: ${merged.length} pada ${inputSampleRate}Hz`, 'info');

    // Downsample to 16000Hz (standard STT sample rate)
    const downsampled = downsampleBuffer(merged, inputSampleRate, 16000);
    termLog(`Downsampled to 16000Hz: ${downsampled.length} samples`, 'info');

    // Encode to 16kHz 16-bit Mono WAV & instant Base64
    const { blob: wavBlob, base64 } = encodeWAV(downsampled, 16000);

    termLog(`WAV Blob berhasil di-generate! Ukuran: ${(wavBlob.size / 1024).toFixed(1)} KB`, 'info');

    return {
      blob: wavBlob,
      base64,
      durationMs,
      sampleRate: 16000,
    };
  }

  /**
   * Completely closes mediaStream and AudioContext when the app exits.
   */
  public async destroy(): Promise<void> {
    this.recording = false;
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.muteNode) {
      this.muteNode.disconnect();
      this.muteNode = null;
    }
    if (this.inputNode) {
      this.inputNode.disconnect();
      this.inputNode = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }
}

/**
 * Resamples Float32Array from inputRate to outputRate.
 */
function downsampleBuffer(buffer: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const originalIndex = Math.floor(i * ratio);
    result[i] = buffer[originalIndex] || 0;
  }
  return result;
}

/**
 * Encodes Float32Array PCM samples into a standard 16-bit Mono WAV Blob and Base64 string instantly.
 */
function encodeWAV(samples: Float32Array, sampleRate: number): { blob: Blob; base64: string } {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');

  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Write PCM 16-bit samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, val, true);
    offset += 2;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const base64 = arrayBufferToBase64(buffer);

  return { blob, base64 };
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Super-fast ArrayBuffer to Base64 encoder without FileReader overhead.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunkSize, len)) as unknown as number[]
    );
  }
  return btoa(binary);
}

