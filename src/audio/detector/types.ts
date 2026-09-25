/**
 * Replaceable detector interface. A detector turns mono audio at `capabilities.sampleRate` into
 * timestamped pitch evidence. It never sees the score, so it cannot manufacture expected notes.
 */

export interface DetectorCapabilities {
  id: string;
  label: string;
  /** Required input rate; callers must resample to it. */
  sampleRate: number;
  polyphonic: boolean;
  /** MIDI pitch range the detector models (not a promise of accuracy across all of it). */
  modelRange: [number, number];
  hopSamples: number;
  windowSamples: number[];
  /** What this detector cannot know from a microphone. Shown in the diagnostics panel. */
  limits: string[];
}

/** Evidence that `pitch` was freshly struck. The same `id` may be re-emitted with higher confidence. */
export interface OnsetEvidence {
  id: number;
  pitch: number;
  /** Estimated attack time, in audio-context seconds (not worker arrival time). */
  time: number;
  /** Time of the frame that produced this evidence (end of the analysis window). */
  frameTime: number;
  /** New energy attributed to this pitch, relative to the frame's total new energy (0..1). */
  share: number;
  /** Fraction of the attack spectrum that only this pitch explains (leave-one-out residual test). */
  unique: number;
  /** Attack amplitude of this pitch relative to the whole frame's level (new energy vs. what is already sounding). */
  relative: number;
  /** Fraction of this pitch's own attack energy that no other pitch can absorb (1 = fully independent). */
  own: number;
  /** Combined 0..1 confidence. */
  confidence: number;
  /** True when a broadband attack transient accompanied it. */
  transient: boolean;
  /** Pitch was already sounding when this re-attack was detected. */
  reattack: boolean;
  /**
   * Set when a stronger, simultaneously attacked lower pitch has partials that coincide with this pitch
   * (octave, twelfth, double octave…). The evidence may be a partial of that note rather than a key press.
   */
  harmonicOf?: number;
}

/** A pitch estimated to be sounding in this frame (sustain evidence, not proof of a key press). */
export interface SoundingPitch {
  pitch: number;
  /** 0..1 share of the frame's explained energy. */
  level: number;
}

/** Why an attack candidate was not reported (for the diagnostics panel). */
export interface OnsetRejection {
  pitch: number;
  reason: 'explained-by-others' | 'too-weak-vs-sounding' | 'not-sustained' | 'neighbour-smear' | 'refractory';
  relative?: number;
  unique?: number;
}

export interface DetectorFrame {
  /** Audio-context time of the newest sample in the analysis window. */
  time: number;
  rmsDb: number;
  peak: number;
  clipped: boolean;
  /** Energy of the analysed spectrum above the noise profile, in dB. */
  signalDb: number;
  noiseDb: number;
  sounding: SoundingPitch[];
  onsets: OnsetEvidence[];
  rejections: OnsetRejection[];
  /** Broadband attack strength in this frame, 0..1. */
  transient: number;
  /** Fraction of the level spectrum left unexplained by the dictionary (high = noise, voice, or not a piano). */
  residual: number;
}

export interface DetectorSettings {
  /** Tuning offset in cents relative to A4 = 440 Hz. */
  tuningCents: number;
  /** 0.5 (strict) .. 2 (sensitive); scales onset thresholds. */
  sensitivity: number;
}

export interface Detector {
  readonly capabilities: DetectorCapabilities;
  /** Feed samples at capabilities.sampleRate. `startTime` is the audio-context time of samples[0]. */
  process(samples: Float32Array, startTime: number): DetectorFrame[];
  configure(settings: Partial<DetectorSettings>): void;
  /** Median noise spectrum learned from room-noise frames; replaces the adaptive floor. */
  setNoiseProfile(profile: Float32Array | null): void;
  captureNoiseProfile(): Float32Array | null;
  /** Clears history (onset tracking, envelopes). Call after seeking or when resuming from a pause. */
  reset(): void;
}
