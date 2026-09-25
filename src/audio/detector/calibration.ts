import { FFT, hannWindow } from '../dsp/fft';
import { inharmonicity } from './templates';

export const PROFILE_PARTIALS = 16;

export interface NoteMeasurement {
  pitch: number;
  /** Relative partial amplitudes (peak = 1), partials 1..PROFILE_PARTIALS. */
  amps: number[];
  /** Tuning of this note relative to A4 = 440 Hz equal temperament, from partials 1–3. */
  cents: number;
  /** Peak level of the excerpt (0..1). */
  peak: number;
  /** Energy ratio of the expected partials to the whole spectrum; low = wrong note, noise, or not a piano. */
  harmonicity: number;
}

/**
 * Measures a single played note (the setup step "play the suggested note"). `samples` are mono at `rate`
 * and must contain the attack. Returns null if no clear attack was found.
 */
export function measureNote(samples: Float32Array, rate: number, pitch: number): NoteMeasurement | null {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-3) return null;
  // Attack = first sample above 25% of peak.
  let onset = 0;
  while (onset < samples.length && Math.abs(samples[onset]!) < peak * 0.25) onset++;
  const N = 16384;
  const len = Math.min(N, Math.round(0.3 * rate), samples.length - onset);
  if (len < 0.1 * rate) return null;
  const seg = new Float64Array(N);
  for (let i = 0; i < len; i++) seg[i] = samples[onset + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
  const fft = new FFT(N);
  const mag = new Float64Array(N / 2 + 1);
  const ones = new Float64Array(N).fill(1);
  fft.magnitude(seg, 0, ones, mag);

  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);
  const B = inharmonicity(pitch);
  const amps: number[] = [];
  const cents: { c: number; w: number }[] = [];
  let partialEnergy = 0;
  for (let k = 1; k <= PROFILE_PARTIALS; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > rate * 0.45) {
      amps.push(0);
      continue;
    }
    const lo = Math.max(1, Math.floor((fk * Math.pow(2, -0.45 / 12) * N) / rate));
    const hi = Math.min(mag.length - 2, Math.ceil((fk * Math.pow(2, 0.45 / 12) * N) / rate));
    let bi = lo;
    for (let b = lo; b <= hi; b++) if (mag[b]! > mag[bi]!) bi = b;
    amps.push(mag[bi]!);
    for (let b = Math.max(0, bi - 3); b <= bi + 3; b++) partialEnergy += mag[b]! * mag[b]!;
    if (k <= 3) {
      const a = mag[bi - 1]!;
      const b0 = mag[bi]!;
      const c = mag[bi + 1]!;
      const denom = a - 2 * b0 + c;
      const d = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      const f = ((bi + d) * rate) / N;
      cents.push({ c: 1200 * Math.log2(f / fk), w: b0 });
    }
  }
  let total = 0;
  for (let b = 1; b < mag.length; b++) total += mag[b]! * mag[b]!;
  const max = Math.max(...amps);
  if (max <= 0) return null;
  const wsum = cents.reduce((s, x) => s + x.w, 0) || 1;
  return {
    pitch,
    amps: amps.map((a) => a / max),
    cents: cents.reduce((s, x) => s + x.c * x.w, 0) / wsum,
    peak,
    harmonicity: total > 0 ? partialEnergy / total : 0,
  };
}

/** Robust global tuning estimate from several measured notes (median, mid-register notes preferred). */
export function estimateTuning(measurements: NoteMeasurement[]): number | null {
  const usable = measurements.filter((m) => m.harmonicity > 0.3 && m.pitch >= 45 && m.pitch <= 84);
  const src = usable.length ? usable : measurements.filter((m) => m.harmonicity > 0.3);
  if (!src.length) return null;
  const c = src.map((m) => m.cents).sort((a, b) => a - b);
  return c[Math.floor(c.length / 2)]!;
}

/** Hann window re-export for callers that measure spectra themselves. */
export { hannWindow };
