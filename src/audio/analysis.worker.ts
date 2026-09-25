/**
 * Analysis worker: receives microphone chunks directly from the AudioWorklet, resamples them explicitly
 * to the detector rate, runs the detector and posts timestamped evidence to the main thread.
 *
 * Backpressure: chunks are processed newest-aware. If the worker falls more than MAX_BACKLOG seconds behind
 * the capture clock, the backlog is dropped and the detector is reset, so recognition can never drift
 * progressively later than the music.
 */
import { measureNote } from './detector/calibration';
import { PolyphonicDetector } from './detector/polyphonic';
import { Resampler } from './dsp/resampler';
import type { FromWorker, ToWorker } from './protocol';

const MAX_BACKLOG = 0.35; // seconds of audio

interface Chunk {
  frame: number;
  rate: number;
  data: Float32Array;
}

let detector = new PolyphonicDetector();
let resampler: Resampler | null = null;
let inputRate = 0;
let generation = 0;
let paused = false;
let queue: Chunk[] = [];
let scheduled = false;
let dropped = 0;
/** Detector-rate samples produced since the last reset, and the audio time of the first one. */
let producedSamples = 0;
let producedStart: number | null = null;
let latestFrame = 0;
/** Frame index the next chunk should start at; a gap (suspended context, dropped chunk) re-anchors timestamps. */
let expectedFrame: number | null = null;
let noiseRms: number[] = [];

// Rolling raw buffer for note measurement (setup step), at the input rate.
let measure: { pitch: number; need: number; got: Float32Array[]; count: number; requestId: number } | null = null;

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function resetStream(): void {
  detector.reset();
  resampler?.reset();
  producedSamples = 0;
  producedStart = null;
  expectedFrame = null;
}

function onAudio(c: Chunk): void {
  latestFrame = Math.max(latestFrame, c.frame + c.data.length);
  if (measure) {
    measure.got.push(c.data.slice());
    measure.count += c.data.length;
    if (measure.count >= measure.need) finishMeasure();
  }
  if (paused) return;
  queue.push(c);
  if (!scheduled) {
    scheduled = true;
    // Yield so several chunks that arrived together are handled in one pass.
    setTimeout(drain, 0);
  }
}

function drain(): void {
  scheduled = false;
  if (!resampler || queue.length === 0) return;
  // Backlog check against the newest captured frame.
  const backlog = (latestFrame - queue[0]!.frame) / inputRate;
  if (backlog > MAX_BACKLOG) {
    dropped += queue.length - 1;
    queue = queue.slice(-1);
    resetStream();
  }
  const t0 = performance.now();
  const frames = [];
  const queueSeconds = (latestFrame - queue[0]!.frame) / inputRate;
  for (const c of queue) {
    if (expectedFrame !== null && c.frame !== expectedFrame) resetStream();
    expectedFrame = c.frame + c.data.length;
    const startTime = c.frame / c.rate;
    const out = resampler.process(c.data);
    if (producedStart === null) producedStart = startTime;
    // Timestamp of the first resampled sample in this batch, on the audio-context clock.
    const t = producedStart + producedSamples / detector.capabilities.sampleRate;
    producedSamples += out.length;
    for (const f of detector.process(out, t)) frames.push(f);
    let sq = 0;
    for (const v of c.data) sq += v * v;
    noiseRms.push(10 * Math.log10(sq / c.data.length + 1e-12));
    if (noiseRms.length > 200) noiseRms.shift();
  }
  queue = [];
  if (frames.length) {
    post({ type: 'frames', generation, frames, processMs: performance.now() - t0, queueSeconds, dropped });
    dropped = 0;
  }
}

function finishMeasure(): void {
  if (!measure) return;
  const all = new Float32Array(measure.count);
  let o = 0;
  for (const g of measure.got) {
    all.set(g, o);
    o += g.length;
  }
  let peak = 0;
  for (const v of all) peak = Math.max(peak, Math.abs(v));
  const result = measureNote(all, inputRate, measure.pitch);
  post({ type: 'measurement', requestId: measure.requestId, result, peak });
  measure = null;
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init': {
        inputRate = m.inputRate;
        detector = new PolyphonicDetector();
        resampler = new Resampler(inputRate, detector.capabilities.sampleRate);
        resetStream();
        m.port.onmessage = (ev: MessageEvent) => {
          const d = ev.data as { type: string; frame: number; rate: number; data: Float32Array };
          if (d.type === 'audio') onAudio(d);
        };
        post({ type: 'ready', capabilities: detector.capabilities, detectorRate: detector.capabilities.sampleRate, inputRate });
        break;
      }
      case 'generation':
        generation = m.generation;
        if (m.reset) {
          queue = [];
          resetStream();
        }
        break;
      case 'configure':
        detector.configure(m.settings);
        if (m.noiseProfile !== undefined) detector.setNoiseProfile(m.noiseProfile ? Float32Array.from(m.noiseProfile) : null);
        break;
      case 'capture-noise': {
        const profile = detector.captureNoiseProfile();
        const sorted = [...noiseRms].sort((a, b) => a - b);
        const rmsDb = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : -100;
        post({ type: 'noise-profile', profile: profile ? Array.from(profile) : null, rmsDb });
        break;
      }
      case 'measure-note':
        measure = { pitch: m.pitch, need: Math.round(m.seconds * inputRate), got: [], count: 0, requestId: m.requestId };
        break;
      case 'pause':
        paused = m.paused;
        if (paused) queue = [];
        else resetStream();
        break;
      case 'stop':
        queue = [];
        resampler = null;
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
