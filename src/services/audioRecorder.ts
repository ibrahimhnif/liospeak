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
  private startTime = 0;
  private chunkCount = 0;
  private onVolumeChange?: (volume: number) => void;

  constructor(onVolumeChange?: (volume: number) => void) {
    this.onVolumeChange = onVolumeChange;
  }

  public isRecording(): boolean {
    return this.recording;
  }

  public async start(): Promise<void> {
    if (this.recording) return;

    termLog('Memulai AudioRecorder...', 'info');
    this.pcmBuffers = [];
    this.chunkCount = 0;
    this.startTime = Date.now();

    // 1. Validate navigator.mediaDevices
    if (!navigator || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      const err = 'Akses mikrofon tidak didukung atau diblokir oleh sistem macOS. Pastikan izin mikrofon diberikan di System Settings -> Privacy & Security -> Microphone.';
      termLog(err, 'error');
      throw new Error(err);
    }

    // 2. Request user media (mic stream)
    try {
      termLog('Meminta izin stream mikrofon via getUserMedia...', 'info');
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err: unknown) {
      const msg = `Gagal mendapatkan akses mikrofon: ${err instanceof Error ? err.message : String(err)}`;
      termLog(msg, 'error');
      throw new Error(msg);
    }

    const tracks = this.mediaStream.getAudioTracks();
    termLog(`Mikrofon terhubung! Track count: ${tracks.length}, label: "${tracks[0]?.label}", readyState: ${tracks[0]?.readyState}`, 'info');

    // 3. Create AudioContext (match hardware rate to prevent WebKit distortion)
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioCtx();
    termLog(`AudioContext dibuat! Hardware sampleRate: ${this.audioContext.sampleRate}Hz, state: ${this.audioContext.state}`, 'info');

    // WebKit often starts in 'suspended' state without user click. Must resume!
    if (this.audioContext.state === 'suspended') {
      termLog('AudioContext dalam status "suspended", memanggil audioContext.resume()...', 'info');
      await this.audioContext.resume();
      termLog(`AudioContext setelah resume: status = ${this.audioContext.state}`, 'info');
    }

    this.inputNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // 4. Create ScriptProcessorNode (buffer size 4096)
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return;

      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.pcmBuffers.push(copy);
      this.chunkCount++;

      // Calculate RMS for visual volume meter
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * input[i];
      }
      const rms = Math.sqrt(sum / input.length);
      const normalized = Math.min(1.0, rms * 5.0);

      if (this.chunkCount % 5 === 1) {
        termLog(`[Perekaman] Chunk #${this.chunkCount} diterima: ${input.length} samples, RMS volume: ${normalized.toFixed(3)}`, 'log');
      }

      if (this.onVolumeChange) {
        this.onVolumeChange(normalized);
      }
    };

    // 5. Connect through zero-gain node to destination to avoid speaker feedback while keeping processor active
    this.muteNode = this.audioContext.createGain();
    this.muteNode.gain.value = 0.0;

    this.inputNode.connect(this.processor);
    this.processor.connect(this.muteNode);
    this.muteNode.connect(this.audioContext.destination);

    this.recording = true;
    termLog('Perekaman audio aktif berjalan!', 'info');
  }

  public async stop(): Promise<AudioRecordResult> {
    termLog(`Menghentikan perekaman audio... (total chunk diterima: ${this.chunkCount})`, 'info');

    if (!this.recording) {
      termLog('Stop dipanggil tapi status recording = false', 'warn');
      throw new Error('Perekam suara belum dimulai.');
    }

    this.recording = false;
    const durationMs = Date.now() - this.startTime;
    const inputSampleRate = this.audioContext?.sampleRate || 44100;

    // Disconnect audio nodes
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
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    termLog(`Perekaman selesai. Durasi: ${(durationMs / 1000).toFixed(2)} detik, Buffer count: ${this.pcmBuffers.length}`, 'info');

    if (this.pcmBuffers.length === 0) {
      const err = 'Tidak ada data audio yang tertangkap (0 chunk buffer). Pastikan mikrofon berfungsi dan tidak diblokir.';
      termLog(err, 'error');
      throw new Error(err);
    }

    // Merge PCM buffers
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

    // Encode to 16kHz 16-bit Mono WAV
    const wavBlob = encodeWAV(downsampled, 16000);
    const base64 = await blobToBase64(wavBlob);

    termLog(`WAV Blob berhasil di-generate! Ukuran: ${(wavBlob.size / 1024).toFixed(1)} KB`, 'info');

    return {
      blob: wavBlob,
      base64,
      durationMs,
      sampleRate: 16000,
    };
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
 * Encodes Float32Array PCM samples into a standard 16-bit Mono WAV Blob.
 */
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
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

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
