import { PARTIAL_PROFILES } from './partial-profiles';
import { LogSpectrum } from './spectrum';

/**
 * Typical partial amplitudes around `midi`: log-average of the measured profiles within ±4.5 semitones,
 * so one sample's quirks do not define a whole register.
 */
export function smoothedProfile(midi: number): number[] {
  const near = PARTIAL_PROFILES.filter(([m]) => Math.abs(m - midi) <= 4.5);
  const use = near.length ? near : [PARTIAL_PROFILES.reduce((best, r) => (Math.abs(r[0] - midi) < Math.abs(best[0] - midi) ? r : best))];
  const K = use[0]![1].length;
  const out: number[] = [];
  for (let k = 0; k < K; k++) {
    let acc = 0;
    let wsum = 0;
    for (const [m, amps] of use) {
      const w = 1 / (1 + Math.abs(m - midi));
      acc += w * Math.log(Math.max(0.003, amps[k]!));
      wsum += w;
    }
    out.push(Math.exp(acc / wsum));
  }
  const max = Math.max(...out);
  return out.map((a) => a / max);
}

/**
 * Parametric piano note model used to build the dictionary. It is *not* fitted to the test recordings:
 * partial frequencies follow the stiff-string law f_k = k f0 sqrt(1 + B k^2) with a register-dependent B,
 * and partial amplitudes follow a smooth register-dependent roll-off.
 */
export function inharmonicity(midi: number): number {
  const log2B = midi > 45 ? -13 + ((midi - 45) / 12) * 0.95 : -13 + ((45 - midi) / 12) * 0.4;
  return Math.pow(2, log2B);
}

export function partials(midi: number, a4Hz: number, maxHz: number, learned = true): { f: number; a: number }[] {
  const f0 = a4Hz * Math.pow(2, (midi - 69) / 12);
  const B = inharmonicity(midi);
  if (learned) {
    const prof = smoothedProfile(midi);
    const out: { f: number; a: number }[] = [];
    for (let k = 1; k <= 30; k++) {
      const f = k * f0 * Math.sqrt(1 + B * k * k);
      if (f > maxHz) break;
      // Beyond the measured partials, continue the last measured level with a 1/k roll-off.
      const a = k <= prof.length ? prof[k - 1]! : prof[prof.length - 1]! * (prof.length / k);
      if (a > 0.004) out.push({ f, a });
    }
    return out;
  }
  // Bass notes: weak fundamental, rich upper partials. Treble: fundamental dominates.
  const alpha = midi < 40 ? 0.7 : midi < 60 ? 0.7 + ((midi - 40) / 20) * 0.5 : 1.2 + Math.min(1, (midi - 60) / 36) * 0.6;
  const out: { f: number; a: number }[] = [];
  for (let k = 1; k <= 30; k++) {
    const f = k * f0 * Math.sqrt(1 + B * k * k);
    if (f > maxHz) break;
    let a = 1 / Math.pow(k, alpha);
    if (midi < 36 && k === 1) a *= 0.35;
    else if (midi < 36 && k === 2) a *= 0.7;
    else if (midi < 48 && k === 1) a *= 0.6;
    // Gentle high-frequency roll-off (hammer felt, microphone, room).
    a /= Math.sqrt(1 + Math.pow(f / 3500, 2));
    out.push({ f, a });
  }
  return out;
}

export interface Dictionary {
  pitches: number[];
  /** atoms[i] has spectrum.bins entries, unit L2 norm, already compressed. */
  atoms: Float64Array[];
  /** Gram matrix, pitches.length^2, row-major. */
  gram: Float64Array;
}

/**
 * Renders each note model through the real front end (same windows, same pooling), so smearing of low
 * partials in the long window is represented exactly.
 */
export function buildDictionary(
  spectrum: LogSpectrum,
  lowMidi: number,
  highMidi: number,
  tuningCents: number,
  compress: (x: number) => number,
): Dictionary {
  const { sampleRate, longSize } = spectrum.cfg;
  const a4 = 440 * Math.pow(2, tuningCents / 1200);
  const maxHz = spectrum.centerHz[spectrum.bins - 1]!;
  const pitches: number[] = [];
  const atoms: Float64Array[] = [];
  const signal = new Float64Array(longSize);
  const spec = new Float64Array(spectrum.bins);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let m = lowMidi; m <= highMidi; m++) {
    signal.fill(0);
    for (const { f, a } of partials(m, a4, maxHz)) {
      const w = (2 * Math.PI * f) / sampleRate;
      const ph = rand() * 2 * Math.PI;
      for (let i = 0; i < longSize; i++) signal[i] = signal[i]! + a * Math.cos(w * i + ph);
    }
    spectrum.compute(signal, longSize, spec);
    const atom = new Float64Array(spectrum.bins);
    let norm = 0;
    for (let b = 0; b < spectrum.bins; b++) {
      atom[b] = compress(spec[b]!);
      norm += atom[b]! * atom[b]!;
    }
    norm = Math.sqrt(norm) || 1;
    for (let b = 0; b < spectrum.bins; b++) atom[b] = atom[b]! / norm;
    pitches.push(m);
    atoms.push(atom);
  }
  const n = atoms.length;
  const gram = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      const ai = atoms[i]!;
      const aj = atoms[j]!;
      for (let b = 0; b < ai.length; b++) s += ai[b]! * aj[b]!;
      gram[i * n + j] = s;
      gram[j * n + i] = s;
    }
  }
  return { pitches, atoms, gram };
}
