/**
 * AudioRecorder provides high-fidelity 16kHz mono WAV recording
 * optimized for Speech-to-Text engines (Gemini & Whisper).
 */

export interface AudioRecordResult {
  blob: Blob;
  base64: string;
  durationMs: number;
}

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private inputNode: MediaStreamAudioSourceNode | null = null;
  private pcmBuffers: Float32Array[] = [];
  private recording = false;
  private startTime = 0;
  private onVolumeChange?: (volume: number) => void;

  constructor(onVolumeChange?: (volume: number) => void) {
    this.onVolumeChange = onVolumeChange;
  }

  public isRecording(): boolean {
    return this.recording;
  }

  public async start(): Promise<void> {
    if (this.recording) return;

    this.pcmBuffers = [];
    this.startTime = Date.now();

    // Request microphone access
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Create 16kHz AudioContext
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioCtx({ sampleRate: 16000 });
    this.inputNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Buffer size 4096 gives ~0.25s chunks at 16kHz
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return;

      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.pcmBuffers.push(copy);

      // Calculate RMS for visual volume meter
      if (this.onVolumeChange) {
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i];
        }
        const rms = Math.sqrt(sum / input.length);
        // Normalize roughly between 0.0 and 1.0
        const normalized = Math.min(1.0, rms * 4.0);
        this.onVolumeChange(normalized);
      }
    };

    this.inputNode.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.recording = true;
  }

  public async stop(): Promise<AudioRecordResult> {
    if (!this.recording) {
      throw new Error('Perekam suara belum dimulai.');
    }

    this.recording = false;
    const durationMs = Date.now() - this.startTime;

    // Disconnect and release audio stream
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
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

    // Encode to 16kHz 16-bit Mono WAV
    const wavBlob = encodeWAV(merged, 16000);
    const base64 = await blobToBase64(wavBlob);

    return {
      blob: wavBlob,
      base64,
      durationMs,
    };
  }
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
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample (16 bits)

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Write PCM 16-bit samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp to [-1.0, 1.0]
    const s = Math.max(-1, Math.min(1, samples[i]));
    // Convert to 16-bit signed integer
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
