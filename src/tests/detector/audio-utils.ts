import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Resampler } from '../../audio/dsp/resampler';
import type { Detector, DetectorFrame, OnsetEvidence } from '../../audio/detector/types';

export const FIXTURE_DIR = join(process.cwd(), 'fixtures/audio');

export interface Clip {
  rate: number;
  data: Float32Array;
}

export function readWav(path: string): Clip {
  const buf = readFileSync(path);
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV file`);
  let pos = 12;
  let rate = 0;
  let channels = 1;
  let bits = 16;
  let format = 1;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      format = buf.readUInt16LE(pos + 8);
      channels = buf.readUInt16LE(pos + 10);
      rate = buf.readUInt32LE(pos + 12);
      bits = buf.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      const frames = Math.floor(size / (channels * (bits / 8)));
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) {
          const o = pos + 8 + (i * channels + c) * (bits / 8);
          s += format === 3 ? buf.readFloatLE(o) : bits === 16 ? buf.readInt16LE(o) / 32768 : buf.readInt32LE(o) / 2147483648;
        }
        data[i] = s / channels;
      }
      return { rate, data };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error(`${path}: no data chunk`);
}

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const uiowaName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** Recorded note from the University of Iowa set, or null if fixtures were not fetched. The attack is at ~30 ms. */
export function uiowa(midi: number, dyn: 'mf' | 'pp' = 'mf'): Clip | null {
  const p = join(FIXTURE_DIR, 'uiowa', `Piano.${dyn}.${uiowaName(midi)}.wav`);
  return existsSync(p) ? readWav(p) : null;
}

/** Attack position inside a raw UIowa excerpt. */
export const UIOWA_ATTACK = 0.03;
/** Lead-in added by `primed` so the detector has history before the first attack (the app listens continuously). */
export const LEAD_IN = 0.5;
export const UIOWA_ONSET = LEAD_IN + UIOWA_ATTACK;

/** Prepends LEAD_IN seconds of very quiet noise. */
export function primed(clip: Clip): Clip {
  const lead = noise(clip.rate, LEAD_IN, -85, true, 99);
  const out = new Float32Array(lead.data.length + clip.data.length);
  out.set(lead.data);
  out.set(clip.data, lead.data.length);
  return { rate: clip.rate, data: out };
}

/** Mixes clips at given start times (seconds) and gains into one clip of `seconds` length. */
export function mix(rate: number, seconds: number, parts: { clip: Clip; at: number; gain?: number }[]): Clip {
  const out = new Float32Array(Math.round(rate * seconds));
  for (const { clip, at, gain = 1 } of parts) {
    if (clip.rate !== rate) throw new Error('mix expects equal rates');
    const off = Math.round(at * rate);
    for (let i = 0; i < clip.data.length && off + i < out.length; i++) if (off + i >= 0) out[off + i] = out[off + i]! + clip.data[i]! * gain;
  }
  return { rate, data: out };
}

/** Deterministic noise (xorshift) so results are reproducible. */
export function noise(rate: number, seconds: number, rmsDb: number, pink = true, seed = 7): Clip {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
  const out = new Float32Array(Math.round(rate * seconds));
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rnd();
    if (pink) {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else out[i] = w;
  }
  let sq = 0;
  for (const v of out) sq += v * v;
  const g = Math.pow(10, rmsDb / 20) / Math.sqrt(sq / out.length);
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * g;
  return { rate, data: out };
}

export function add(a: Clip, b: Clip): Clip {
  const out = new Float32Array(Math.max(a.data.length, b.data.length));
  for (let i = 0; i < out.length; i++) out[i] = (a.data[i] ?? 0) + (b.data[i] ?? 0);
  return { rate: a.rate, data: out };
}

export interface RunResult {
  frames: DetectorFrame[];
  /** Best version of each onset id; `firstFrameTime` is when the id was first reported. */
  onsets: (OnsetEvidence & { firstFrameTime: number })[];
  msPerSecond: number;
}

/**
 * Feeds a clip through the same path as the app: 128-sample render quanta at the capture rate,
 * explicit resampling to the detector rate, audio-clock timestamps.
 */
export function runDetector(det: Detector, clip: Clip, t0 = 0): RunResult {
  const rs = new Resampler(clip.rate, det.capabilities.sampleRate);
  const frames: DetectorFrame[] = [];
  const byId = new Map<number, OnsetEvidence & { firstFrameTime: number }>();
  let produced = 0;
  const outRate = det.capabilities.sampleRate;
  const start = performance.now();
  for (let i = 0; i < clip.data.length; i += 128) {
    const chunk = clip.data.subarray(i, Math.min(clip.data.length, i + 128));
    const res = rs.process(chunk);
    if (res.length === 0) continue;
    const fs = det.process(res, t0 + produced / outRate);
    produced += res.length;
    for (const f of fs) {
      frames.push(f);
      for (const o of f.onsets) {
        const prev = byId.get(o.id);
        if (!prev || o.confidence >= prev.confidence) byId.set(o.id, { ...o, firstFrameTime: prev?.firstFrameTime ?? o.frameTime });
      }
    }
  }
  const ms = performance.now() - start;
  return { frames, onsets: [...byId.values()].sort((a, b) => a.time - b.time), msPerSecond: ms / (clip.data.length / clip.rate) };
}
