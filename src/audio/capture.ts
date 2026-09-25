import workletUrl from './capture.worklet.ts?worker&url';
import type { DetectorCapabilities, DetectorSettings } from './detector/types';
import type { NoteMeasurement } from './detector/calibration';
import type { FrameMessage, FromWorker, ToWorker } from './protocol';

export type MicErrorKind = 'unsupported' | 'insecure' | 'iframe-blocked' | 'denied' | 'no-device' | 'busy' | 'constraints' | 'aborted' | 'unknown';

export class MicError extends Error {
  constructor(
    readonly kind: MicErrorKind,
    message: string,
    readonly help: string,
  ) {
    super(message);
    this.name = 'MicError';
  }
}

export interface InputInfo {
  label: string;
  deviceId: string;
  contextRate: number;
  settings: MediaTrackSettings;
  /** What we asked for vs. what the browser reports it applied (undefined = not reported). */
  processing: { name: 'echoCancellation' | 'noiseSuppression' | 'autoGainControl'; requested: false; applied: boolean | undefined }[];
  channelCount: number | undefined;
  baseLatency: number;
}

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function microphoneAllowedByPolicy(): boolean | null {
  const d = document as Document & { permissionsPolicy?: { allowsFeature(f: string): boolean }; featurePolicy?: { allowsFeature(f: string): boolean } };
  const policy = d.permissionsPolicy ?? d.featurePolicy;
  return policy ? policy.allowsFeature('microphone') : null;
}

const OPEN_DIRECTLY = 'Open the app in its own browser tab (for example http://localhost:5173) instead of an embedded preview.';

/** Explains a getUserMedia failure in terms the player can act on. */
export function classifyMicError(err: unknown): MicError {
  if (err instanceof MicError) return err;
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (inIframe() && microphoneAllowedByPolicy() === false)
    return new MicError('iframe-blocked', 'This embedded page is not allowed to use the microphone.', OPEN_DIRECTLY);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new MicError(
        'denied',
        'Microphone access was denied.',
        inIframe()
          ? `The browser or the embedding page blocked the microphone. ${OPEN_DIRECTLY}`
          : 'Click the microphone or lock icon in the address bar, allow the microphone for this site, then try again.',
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new MicError('no-device', 'No microphone was found.', 'Connect or enable a microphone (check the system sound settings), then try again.');
    case 'NotReadableError':
    case 'TrackStartError':
      return new MicError('busy', 'The microphone is in use or could not be started.', 'Close other apps or tabs using the microphone (calls, recorders), then try again.');
    case 'OverconstrainedError':
      return new MicError('constraints', 'The selected microphone does not support the requested settings.', 'Choose another microphone in the setup, or use the default device.');
    case 'SecurityError':
      return new MicError('insecure', 'The browser blocked the microphone on this page.', 'Use http://localhost during development or an https:// address.');
    case 'AbortError':
      return new MicError('aborted', 'Starting the microphone was interrupted.', 'Try again. If it keeps failing, restart the browser.');
    default:
      return new MicError('unknown', `Could not start the microphone: ${msg}`, 'Try again, or choose another microphone.');
  }
}

/**
 * Owns the one AudioContext (the app's single timing authority), the microphone graph and the analysis
 * worker. Microphone audio never leaves this device and is never recorded.
 */
export class AudioSystem {
  ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private worker: Worker | null = null;
  private workletLoaded = false;
  capabilities: DetectorCapabilities | null = null;
  input: InputInfo | null = null;
  onFrames: ((m: FrameMessage) => void) | null = null;
  onWorkerError: ((message: string) => void) | null = null;
  private pending = new Map<number, (v: unknown) => void>();
  private noiseWaiter: ((v: { profile: number[] | null; rmsDb: number }) => void) | null = null;
  private nextRequest = 1;

  /** Must be called from a user gesture the first time (autoplay policy). */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new MicError('unsupported', 'This browser has no Web Audio API.', 'Use a current version of Chrome or Edge.');
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get contextState(): AudioContextState | 'none' {
    return this.ctx?.state ?? 'none';
  }

  get listening(): boolean {
    return this.stream !== null;
  }

  static supportCheck(): MicError | null {
    if (!window.isSecureContext) return new MicError('insecure', 'The microphone needs a secure page.', 'Use http://localhost during development or an https:// address.');
    if (!navigator.mediaDevices?.getUserMedia) return new MicError('unsupported', 'This browser cannot capture audio here.', 'Use a current version of Chrome or Edge.');
    if (typeof AudioWorkletNode === 'undefined') return new MicError('unsupported', 'This browser lacks AudioWorklet support.', 'Use a current version of Chrome or Edge.');
    if (inIframe() && microphoneAllowedByPolicy() === false) return new MicError('iframe-blocked', 'This embedded page is not allowed to use the microphone.', OPEN_DIRECTLY);
    return null;
  }

  async listDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  async startMic(deviceId?: string): Promise<InputInfo> {
    const unsupported = AudioSystem.supportCheck();
    if (unsupported) throw unsupported;
    const ctx = this.ensureContext();
    this.stopMic();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: { ideal: 1 },
          // The piano must reach the detector unprocessed; browsers may ignore these requests.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
    } catch (err) {
      throw classifyMicError(err);
    }
    this.stream = stream;
    try {
      if (!this.workletLoaded) {
        await ctx.audioWorklet.addModule(workletUrl);
        this.workletLoaded = true;
      }
      if (ctx.state === 'suspended') await ctx.resume();
      this.source = ctx.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(ctx, 'moonlight-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      // Keep the node pulled by the graph; its output is silence (gain 0 for good measure).
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.node).connect(this.sink).connect(ctx.destination);
      await this.startWorker(ctx.sampleRate);
    } catch (err) {
      this.stopMic();
      throw err instanceof MicError ? err : new MicError('unknown', `Audio processing failed to start: ${err instanceof Error ? err.message : String(err)}`, 'Reload the page and try again.');
    }
    const track = stream.getAudioTracks()[0]!;
    const settings = track.getSettings();
    track.onended = () => this.onTrackEnded?.();
    this.input = {
      label: track.label || 'Microphone',
      deviceId: settings.deviceId ?? '',
      contextRate: ctx.sampleRate,
      settings,
      processing: (['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const).map((name) => ({ name, requested: false, applied: settings[name] as boolean | undefined })),
      channelCount: settings.channelCount,
      baseLatency: ctx.baseLatency ?? 0,
    };
    return this.input;
  }

  onTrackEnded: (() => void) | null = null;

  private async startWorker(inputRate: number): Promise<void> {
    this.worker?.terminate();
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const channel = new MessageChannel();
    this.node!.port.postMessage({ type: 'port', port: channel.port1 }, [channel.port1]);
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('analysis worker did not start')), 5000);
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        switch (m.type) {
          case 'ready':
            clearTimeout(timer);
            this.capabilities = m.capabilities;
            resolve();
            break;
          case 'frames':
            this.onFrames?.(m);
            break;
          case 'noise-profile':
            this.noiseWaiter?.({ profile: m.profile, rmsDb: m.rmsDb });
            this.noiseWaiter = null;
            break;
          case 'measurement':
            this.pending.get(m.requestId)?.({ result: m.result, peak: m.peak });
            this.pending.delete(m.requestId);
            break;
          case 'error':
            this.onWorkerError?.(m.message);
            break;
        }
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.message || 'analysis worker failed'));
        this.onWorkerError?.(e.message || 'analysis worker failed');
      };
    });
    this.send({ type: 'init', port: channel.port2, inputRate }, [channel.port2]);
    await ready;
  }

  send(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(m, transfer);
  }

  setGeneration(generation: number, reset: boolean): void {
    this.send({ type: 'generation', generation, reset });
  }

  configure(settings: Partial<DetectorSettings>, noiseProfile?: number[] | null): void {
    const m: ToWorker = noiseProfile !== undefined ? { type: 'configure', settings, noiseProfile } : { type: 'configure', settings };
    this.send(m);
  }

  captureNoise(): Promise<{ profile: number[] | null; rmsDb: number }> {
    return new Promise((resolve) => {
      this.noiseWaiter = resolve;
      this.send({ type: 'capture-noise' });
    });
  }

  measureNote(pitch: number, seconds: number): Promise<{ result: NoteMeasurement | null; peak: number }> {
    const requestId = this.nextRequest++;
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve as (v: unknown) => void);
      this.send({ type: 'measure-note', pitch, seconds, requestId });
    });
  }

  /** Stops the microphone and releases every audio resource it used. */
  stopMic(): void {
    this.node?.port.postMessage({ type: 'stop' });
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.send({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
    this.source = null;
    this.node = null;
    this.sink = null;
    this.stream = null;
    this.input = null;
  }

  async dispose(): Promise<void> {
    this.stopMic();
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close();
    this.ctx = null;
    this.workletLoaded = false;
  }
}
