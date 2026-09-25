/**
 * AudioWorklet processor: copies the microphone input (downmixed to mono) into fixed-size chunks and
 * posts them, with the audio-clock frame index of their first sample, straight to the analysis worker.
 * No analysis happens here — the audio render thread must never block.
 */

// Minimal AudioWorkletGlobalScope typings (not in TypeScript's DOM lib).
declare const currentFrame: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const CHUNK = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  private out: MessagePort | null = null;
  private buf = new Float32Array(CHUNK);
  private fill = 0;
  private startFrame = 0;
  private running = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'port') this.out = e.data.port as MessagePort;
      else if (e.data?.type === 'stop') this.running = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // Output stays silent: the microphone is never played back.
    for (const ch of outputs[0] ?? []) ch.fill(0);
    const input = inputs[0];
    if (!input || input.length === 0 || !this.out) return this.running;
    const n = input[0]!.length;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < input.length; c++) s += input[c]![i]!;
      if (this.fill === 0) this.startFrame = currentFrame + i;
      this.buf[this.fill++] = s / input.length;
      if (this.fill === CHUNK) {
        this.out.postMessage({ type: 'audio', frame: this.startFrame, rate: sampleRate, data: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(CHUNK);
        this.fill = 0;
      }
    }
    return this.running;
  }
}

registerProcessor('moonlight-capture', CaptureProcessor);
