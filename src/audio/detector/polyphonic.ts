import { SparseNNLS } from './nnls';
import { DEFAULT_SPECTRUM, LogSpectrum, type SpectrumConfig } from './spectrum';
import { buildDictionary, type Dictionary } from './templates';
import type { Detector, DetectorCapabilities, DetectorFrame, DetectorSettings, OnsetEvidence, OnsetRejection, SoundingPitch } from './types';

/**
 * Polyphonic piano detector: harmonic-template dictionary + sparse NNLS, run twice per frame.
 *
 *  1. Level fit on the current spectrum → which pitches are sounding (display only; never a key press).
 *  2. Attack fit on the *positive spectral change* over the last ~100–190 ms → which pitches received new
 *     energy. Ringing notes decay, so they contribute nothing here; a re-struck note does.
 *
 * Each attack candidate then goes through a leave-one-out test: the attack spectrum is refit without it,
 * and only the energy no other pitch can absorb counts as its own evidence. This is what separates a real
 * C5 from the 2nd partial of a C4, and a full chord from a partial one.
 */

export interface PolyphonicOptions {
  spectrum?: SpectrumConfig;
  hop?: number;
  lowMidi?: number;
  highMidi?: number;
  /** Frames between the compared spectra for attack evidence (short / long window regions). */
  attackLagShort?: number;
  attackLagLong?: number;
  settings?: Partial<DetectorSettings>;
}

const COMPRESS = 0.6;
/** Semitone distances of partials 2, 3, 4, 5, 6 and 8 above a fundamental. */
const HARMONIC_INTERVALS = [12, 19, 24, 28, 31, 36];
/** Below this input level (dBFS RMS) no new onset is proposed: it is microphone self-noise, not a piano. */
const ABSOLUTE_FLOOR_DB = -80;
const HARMONIC_PENALTY = 0.6;
const compress = (x: number) => Math.pow(Math.max(0, x), COMPRESS);

interface PitchTrack {
  armed: boolean;
  lastOnsetFrame: number;
  lastOnsetAmp: number;
  /** Largest attack amplitude seen for this pitch in the last few frames. */
  recentPeak: number;
  pending: OnsetEvidence | null;
  pendingAmp: number;
  pendingFrames: number;
  /** Frames since onset during which a better confidence may be re-emitted. */
  openOnset: OnsetEvidence | null;
  openFrames: number;
  /** Frame of the last confirmed (emitted) onset. */
  lastEmittedFrame: number;
  lowFrames: number;
}

export class PolyphonicDetector implements Detector {
  readonly capabilities: DetectorCapabilities;
  private readonly spectrum: LogSpectrum;
  private dict: Dictionary;
  private levelSolver: SparseNNLS;
  private attackSolver: SparseNNLS;
  private readonly hop: number;
  private readonly lowMidi: number;
  private readonly highMidi: number;
  private readonly lagShort: number;
  private readonly lagLong: number;
  private settings: DetectorSettings = { tuningCents: 0, sensitivity: 1 };

  // audio buffer (at detector rate)
  private buf: Float32Array;
  private bufLen = 0;
  private bufStartTime = 0; // audio time of buf[0]
  private sinceHop = 0;

  // spectral history (compressed, noise-subtracted), ring buffer
  private readonly history: Float64Array[];
  private histPos = 0;
  private frames = 0;
  private readonly raw: Float64Array;
  private readonly cur: Float64Array;
  private readonly diff: Float64Array;
  private readonly scratch: Float64Array;
  private levelPrev: Float64Array[]; // level coefficients history (for re-attack detection)

  // noise
  private noiseProfile: Float32Array | null = null;
  private adaptiveNoise: Float64Array;
  private noiseFrames: Float64Array[] = [];

  // transient envelope (high-passed energy per 128-sample block)
  private readonly blockEnergy: Float64Array = new Float64Array(64);
  private blockPos = 0;
  private blockAcc = 0;
  private blockCount = 0;
  private hpPrev = 0;
  private readonly blockTimes: Float64Array = new Float64Array(64);

  private tracks: PitchTrack[];
  private levelNorm = 0;
  private nextOnsetId = 1;

  constructor(opts: PolyphonicOptions = {}) {
    const cfg = opts.spectrum ?? DEFAULT_SPECTRUM;
    this.spectrum = new LogSpectrum(cfg);
    this.hop = opts.hop ?? 512;
    this.lowMidi = opts.lowMidi ?? 21;
    this.highMidi = opts.highMidi ?? 108;
    this.lagShort = opts.attackLagShort ?? 4;
    this.lagLong = opts.attackLagLong ?? 7;
    Object.assign(this.settings, opts.settings ?? {});
    this.dict = buildDictionary(this.spectrum, this.lowMidi, this.highMidi, this.settings.tuningCents, compress);
    this.levelSolver = new SparseNNLS(this.dict);
    this.attackSolver = new SparseNNLS(this.dict);
    const bins = this.spectrum.bins;
    const histLen = Math.max(this.lagShort, this.lagLong) + 2;
    this.history = Array.from({ length: histLen }, () => new Float64Array(bins));
    this.levelPrev = Array.from({ length: histLen }, () => new Float64Array(this.dict.atoms.length));
    this.raw = new Float64Array(bins);
    this.cur = new Float64Array(bins);
    this.diff = new Float64Array(bins);
    this.scratch = new Float64Array(this.dict.atoms.length);
    this.adaptiveNoise = new Float64Array(bins);
    this.buf = new Float32Array(cfg.longSize * 4);
    this.tracks = this.dict.pitches.map(() => ({ armed: true, lastOnsetFrame: -1000, lastOnsetAmp: 0, recentPeak: 0, pending: null, pendingAmp: 0, pendingFrames: 0, openOnset: null, openFrames: 0, lastEmittedFrame: -1000, lowFrames: 0 }));
    this.capabilities = {
      id: 'nnls-harmonic-v1',
      label: 'Polyphonic (harmonic templates + sparse NNLS)',
      sampleRate: cfg.sampleRate,
      polyphonic: true,
      modelRange: [this.lowMidi, this.highMidi],
      hopSamples: this.hop,
      windowSamples: [cfg.longSize, cfg.shortSize],
      limits: [
        'Estimates pitches from sound; it cannot see which keys were pressed.',
        'Note releases and pedal position are not measured.',
        'Octave-related notes share partials; an added upper octave is the hardest case.',
        `Bass below about ${Math.round(cfg.splitHz)} Hz is analysed with a ${Math.round((cfg.longSize / cfg.sampleRate) * 1000)} ms window and reacts more slowly.`,
        'Loud sound from speakers, voices, or other instruments can create false evidence.',
      ],
    };
  }

  configure(s: Partial<DetectorSettings>): void {
    const retune = s.tuningCents !== undefined && s.tuningCents !== this.settings.tuningCents;
    Object.assign(this.settings, s);
    if (retune) this.rebuild();
  }

  private rebuild(): void {
    this.dict = buildDictionary(this.spectrum, this.lowMidi, this.highMidi, this.settings.tuningCents, compress);
    this.levelSolver = new SparseNNLS(this.dict);
    this.attackSolver = new SparseNNLS(this.dict);
  }

  setNoiseProfile(profile: Float32Array | null): void {
    this.noiseProfile = profile && profile.length === this.spectrum.bins ? profile : null;
  }

  /** Median of recent raw spectra; call after ~1–2 s of room noise. */
  captureNoiseProfile(): Float32Array | null {
    if (this.noiseFrames.length < 8) return null;
    const bins = this.spectrum.bins;
    const out = new Float32Array(bins);
    const col = new Float64Array(this.noiseFrames.length);
    for (let b = 0; b < bins; b++) {
      for (let i = 0; i < this.noiseFrames.length; i++) col[i] = this.noiseFrames[i]![b]!;
      col.sort();
      // 75th percentile: a little conservative so steady room noise sits below the floor.
      out[b] = col[Math.floor(col.length * 0.75)]!;
    }
    return out;
  }

  reset(): void {
    for (const h of this.history) h.fill(0);
    for (const l of this.levelPrev) l.fill(0);
    this.levelSolver.h.fill(0);
    this.frames = 0;
    this.histPos = 0;
    for (const t of this.tracks) {
      t.armed = true;
      t.lastOnsetFrame = -1000;
      t.lastOnsetAmp = 0;
      t.recentPeak = 0;
      t.pending = null;
      t.openOnset = null;
      t.openFrames = 0;
      t.lastEmittedFrame = -1000;
      t.lowFrames = 0;
    }
    this.blockEnergy.fill(0);
    this.blockPos = 0;
    this.blockAcc = 0;
    this.blockCount = 0;
  }

  process(samples: Float32Array, startTime: number): DetectorFrame[] {
    const out: DetectorFrame[] = [];
    const rate = this.spectrum.cfg.sampleRate;
    const longSize = this.spectrum.cfg.longSize;
    // Keep the buffer's time base consistent with the incoming timestamps.
    if (this.bufLen === 0) this.bufStartTime = startTime;
    let offset = 0;
    while (offset < samples.length) {
      if (this.bufLen === this.buf.length) {
        const drop = this.buf.length - longSize;
        this.buf.copyWithin(0, drop, this.bufLen);
        this.bufLen -= drop;
        this.bufStartTime += drop / rate;
      }
      const n = Math.min(samples.length - offset, this.buf.length - this.bufLen, this.hop - this.sinceHop);
      for (let i = 0; i < n; i++) this.feedTransient(samples[offset + i]!, startTime + (offset + i) / rate);
      this.buf.set(samples.subarray(offset, offset + n), this.bufLen);
      this.bufLen += n;
      offset += n;
      this.sinceHop += n;
      if (this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        if (this.bufLen >= longSize) out.push(this.analyse(this.bufStartTime + this.bufLen / rate));
      }
    }
    return out;
  }

  private feedTransient(x: number, t: number): void {
    // First-order high-pass (~2 kHz at 22.05 kHz) then block energy.
    const y = x - this.hpPrev * 0.55;
    this.hpPrev = x;
    this.blockAcc += y * y;
    this.blockCount++;
    if (this.blockCount === 128) {
      this.blockEnergy[this.blockPos] = this.blockAcc / 128;
      this.blockTimes[this.blockPos] = t;
      this.blockPos = (this.blockPos + 1) % this.blockEnergy.length;
      this.blockAcc = 0;
      this.blockCount = 0;
    }
  }

  /** Strongest broadband energy jump in the last ~200 ms: strength 0..1 and its time. */
  private transientInfo(): { strength: number; time: number } {
    const N = this.blockEnergy.length;
    let best = 0;
    let bestTime = 0;
    for (let k = 0; k < 36; k++) {
      const i = (this.blockPos - 1 - k + N * 2) % N;
      const e = this.blockEnergy[i]!;
      // Reference: mean of the 6 blocks (~35 ms) before a 2-block gap.
      let ref = 0;
      for (let j = 3; j < 9; j++) ref += this.blockEnergy[(i - j + N * 2) % N]!;
      ref = ref / 6 + 1e-10;
      const ratio = e / ref;
      if (ratio > best) {
        best = ratio;
        bestTime = this.blockTimes[i]!;
      }
    }
    // ratio 2 → 0, ratio 12 → ~1
    const strength = Math.max(0, Math.min(1, Math.log(best / 2) / Math.log(6)));
    return { strength, time: bestTime };
  }

  private analyse(frameTime: number): DetectorFrame {
    const bins = this.spectrum.bins;
    this.spectrum.compute(this.buf, this.bufLen, this.raw);

    // Level statistics from the newest short window.
    const shortSize = this.spectrum.cfg.shortSize;
    let sq = 0;
    let peak = 0;
    for (let i = this.bufLen - shortSize; i < this.bufLen; i++) {
      const v = this.buf[i]!;
      sq += v * v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    const rmsDb = 10 * Math.log10(sq / shortSize + 1e-12);

    // Noise floor: calibrated profile if present, else a slow per-bin minimum tracker.
    const noise = this.noiseProfile;
    let noiseE = 0;
    let sigE = 0;
    for (let b = 0; b < bins; b++) {
      const r = this.raw[b]!;
      const an = this.adaptiveNoise[b]!;
      this.adaptiveNoise[b] = an === 0 ? r : r < an ? an * 0.9 + r * 0.1 : an * 1.003;
      const floor = noise ? Math.max(noise[b]!, 0.5 * this.adaptiveNoise[b]!) : this.adaptiveNoise[b]!;
      noiseE += floor * floor;
      const clean = Math.max(0, r - 1.5 * floor);
      sigE += clean * clean;
      this.cur[b] = compress(clean);
    }
    this.noiseFrames.push(Float64Array.from(this.raw));
    if (this.noiseFrames.length > 120) this.noiseFrames.shift();

    // ---- 1. level fit ----
    const lv = this.levelSolver;
    const vv = lv.load(this.cur);
    this.levelNorm = Math.sqrt(vv);
    const lambdaL = 0.08 * Math.sqrt(vv);
    lv.solve(lambdaL, 25);
    const residual = vv > 0 ? lv.residual() / vv : 0;
    let hSum = 0;
    for (let i = 0; i < lv.n; i++) hSum += lv.h[i]!;
    const sounding: SoundingPitch[] = [];
    if (hSum > 0) {
      for (let i = 0; i < lv.n; i++) {
        const level = lv.h[i]! / hSum;
        if (level >= 0.06) sounding.push({ pitch: this.dict.pitches[i]!, level });
      }
    }

    // ---- 2. attack fit on positive spectral change ----
    const H = this.history.length;
    const lagS = this.history[(this.histPos - this.lagShort + H * 4) % H]!;
    const lagL = this.history[(this.histPos - this.lagLong + H * 4) % H]!;
    const ready = this.frames >= this.lagLong;
    for (let b = 0; b < bins; b++) {
      const prev = this.spectrum.isLong[b] ? lagL[b]! : lagS[b]!;
      this.diff[b] = ready ? Math.max(0, this.cur[b]! - prev) : 0;
    }
    const at = this.attackSolver;
    const dd = at.load(this.diff);
    at.h.fill(0);
    const lambdaA = 0.1 * Math.sqrt(dd);
    at.solve(lambdaA, 30);

    const tr = this.transientInfo();
    const onsets: OnsetEvidence[] = [];
    const rejections: OnsetRejection[] = [];
    const sens = this.settings.sensitivity;
    // Absolute gate on attack energy relative to the noise energy of the same frame.
    const noiseRef = Math.pow(noiseE, COMPRESS / 2) + 1e-9;
    let aSum = 0;
    for (let i = 0; i < at.n; i++) aSum += at.h[i]!;
    const aMax = at.h.reduce((m, x) => Math.max(m, x), 0);
    const levelOld = this.levelPrev[(this.histPos - this.lagShort + H * 4) % H]!;

    for (let i = 0; i < at.n; i++) {
      const track = this.tracks[i]!;
      const a = at.h[i]!;
      const strongEnough = a > 0 && a >= (0.12 / sens) * aMax && a >= (0.35 / sens) * noiseRef;
      if (!strongEnough) {
        track.lowFrames++;
        if (track.lowFrames >= 2) track.armed = true;
      } else {
        track.lowFrames = 0;
      }
      const levelShare = hSum > 0 ? lv.h[i]! / hSum : 0;
      track.recentPeak = Math.max(a, track.recentPeak * 0.7);

      // Update a recently emitted onset if evidence keeps growing.
      if (track.openOnset) {
        track.openFrames++;
        if (strongEnough && dd > 0) {
          const ev = this.evaluate(i, a, aSum, dd, lambdaA, tr, track.openOnset.reattack, track.openOnset.harmonicOf);
          if (ev.confidence > track.openOnset.confidence + 0.02) {
            const upd: OnsetEvidence = { ...track.openOnset, ...ev, id: track.openOnset.id, time: track.openOnset.time, frameTime };
            track.openOnset = upd;
            onsets.push(upd);
          }
        }
        // Ghost parent: the lower note this onset might be a partial of was never confirmed itself, so the
        // harmonic suspicion is lifted and the evidence is re-emitted at full confidence.
        const open = track.openOnset;
        if (open && open.harmonicOf !== undefined) {
          const pj = i - (open.pitch - open.harmonicOf);
          const parent = this.tracks[pj];
          if (parent && parent.pending === null && this.frames - parent.lastEmittedFrame > 8 && track.openFrames >= 2) {
            const upd: OnsetEvidence = { ...open, confidence: Math.min(1, open.confidence / HARMONIC_PENALTY), frameTime };
            delete upd.harmonicOf;
            track.openOnset = upd;
            onsets.push(upd);
          }
        }
        if (track.openFrames >= (track.openOnset?.harmonicOf !== undefined ? 8 : 4)) track.openOnset = null;
      }

      // Confirm a pending candidate two frames (~46 ms) later: by then the attack transient has passed and the
      // level fit must show the pitch clearly sounding. Semitone neighbours smeared by the hammer transient
      // and flickers in decaying partials fail this test.
      if (track.pending) {
        track.pendingFrames++;
        track.pendingAmp = Math.max(track.pendingAmp, a);
        if (track.pendingFrames < 2) continue;
        let neighbourShare = 0;
        for (const d of [-2, -1, 1, 2]) neighbourShare = Math.max(neighbourShare, hSum > 0 ? (lv.h[i + d] ?? 0) / hSum : 0);
        const neighbourAttack = Math.max(this.tracks[i - 1]?.recentPeak ?? 0, this.tracks[i + 1]?.recentPeak ?? 0);
        const dominated = neighbourAttack > (2.2 * track.pendingAmp) / sens;
        const confirmed = !dominated && levelShare >= 0.08 / sens && levelShare >= 0.35 * neighbourShare;
        const p = track.pending;
        track.pending = null;
        if (!confirmed) {
          rejections.push({ pitch: p.pitch, reason: dominated ? 'neighbour-smear' : 'not-sustained' });
          continue;
        }
        const harmonicOf = this.harmonicParent(i, track.pendingAmp);
        const ev = strongEnough ? this.evaluate(i, a, aSum, dd, lambdaA, tr, p.reattack, harmonicOf) : null;
        const pendingConf = harmonicOf !== undefined ? p.confidence * HARMONIC_PENALTY : p.confidence;
        const best = ev && ev.confidence > pendingConf ? ev : { ...p, confidence: pendingConf };
        const evidence: OnsetEvidence = { ...p, ...best, id: p.id, pitch: p.pitch, time: p.time, frameTime, reattack: p.reattack };
        if (harmonicOf !== undefined) evidence.harmonicOf = harmonicOf;
        track.openOnset = evidence;
        track.openFrames = 0;
        track.lastEmittedFrame = this.frames;
        onsets.push(evidence);
        continue;
      }

      if (!strongEnough || !track.armed || rmsDb < ABSOLUTE_FLOOR_DB) continue;
      if (this.frames - track.lastOnsetFrame < 4) {
        rejections.push({ pitch: this.dict.pitches[i]!, reason: 'refractory' }); // ~90 ms
        continue;
      }
      const wasSounding = levelOld[i]! > 0 && hSum > 0 && levelOld[i]! / Math.max(1e-9, hSum) > 0.06;
      const ev = this.evaluate(i, a, aSum, dd, lambdaA, tr, wasSounding, undefined);
      if (ev.unique < 0.02) {
        rejections.push({ pitch: this.dict.pitches[i]!, reason: 'explained-by-others', relative: ev.relative, unique: ev.unique }); // harmonic/octave ghost
        continue;
      }
      // New energy must be a real part of what is sounding, not a flicker in a decaying partial.
      if (ev.relative < (ev.transient ? 0.12 : 0.25) / sens) {
        rejections.push({ pitch: this.dict.pitches[i]!, reason: 'too-weak-vs-sounding' });
        continue;
      }
      const onsetTime = tr.strength > 0.2 && frameTime - tr.time < 0.25 ? tr.time : frameTime - 0.06;
      track.pending = { id: this.nextOnsetId++, pitch: this.dict.pitches[i]!, time: onsetTime, frameTime, ...ev, reattack: wasSounding };
      track.pendingAmp = a;
      track.pendingFrames = 0;
      track.armed = false;
      track.lastOnsetFrame = this.frames;
      track.lastOnsetAmp = a;
    }

    // advance history
    this.history[this.histPos]!.set(this.cur);
    this.levelPrev[this.histPos]!.set(lv.h);
    this.histPos = (this.histPos + 1) % H;
    this.frames++;

    return {
      time: frameTime,
      rmsDb,
      peak,
      clipped: peak >= 0.99,
      signalDb: 10 * Math.log10(sigE + 1e-12),
      noiseDb: 10 * Math.log10(noiseE + 1e-12),
      sounding,
      onsets,
      rejections,
      transient: tr.strength,
      residual,
    };
  }

  /**
   * A lower pitch attacked at the same time (within ~4 frames), not much weaker, whose partials coincide
   * with this pitch (2nd–6th and 8th partials). Real pianos vary so much in partial balance that the upper
   * note of an octave cannot be told apart from a strong 2nd partial, so this is reported, not resolved.
   */
  private harmonicParent(i: number, amp: number): number | undefined {
    const p = this.dict.pitches[i]!;
    for (const d of HARMONIC_INTERVALS) {
      const j = i - d;
      if (j < 0) continue;
      const t = this.tracks[j]!;
      // Bass notes rise more slowly (long window), so their upper partials can be confirmed first:
      // a parent that is still pending or merely attacking right now counts too.
      const candidate = this.frames - t.lastOnsetFrame <= 4 || t.pending !== null;
      if (candidate && Math.max(t.lastOnsetAmp, t.recentPeak) >= 0.3 * amp) return p - d;
      const attackNow = this.attackSolver.h[j] ?? 0;
      if (attackNow >= 0.6 * amp && attackNow >= 0.12 * this.levelNorm) return p - d;
    }
    return undefined;
  }

  private evaluate(
    i: number,
    a: number,
    aSum: number,
    dd: number,
    lambda: number,
    tr: { strength: number },
    reattack: boolean,
    harmonicOf: number | undefined,
  ): Pick<OnsetEvidence, 'share' | 'unique' | 'confidence' | 'transient' | 'relative' | 'own'> {
    const share = aSum > 0 ? a / aSum : 0;
    const u = dd > 0 ? this.attackSolver.uniqueContribution(i, lambda, this.scratch) : 0;
    const unique = dd > 0 ? u / dd : 0;
    const own = a > 0 ? Math.min(1, u / (a * a)) : 0;
    const relative = this.levelNorm > 0 ? a / this.levelNorm : 0;
    const transient = tr.strength > 0.25;
    // Map evidence to 0..1. A re-attack of a ringing note needs a transient; harmonic ambiguity is penalised.
    let c = 0.35 * Math.min(1, unique / 0.1) + 0.3 * Math.min(1, relative / 0.3) + 0.2 * Math.min(1, own / 0.7) + (transient ? 0.15 : 0);
    if (reattack && !transient) c *= 0.5;
    if (harmonicOf !== undefined) c *= HARMONIC_PENALTY;
    return { share, unique, relative, own, confidence: Math.max(0, Math.min(1, c)), transient };
  }
}
