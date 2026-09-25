import { FFT, hannWindow } from '../dsp/fft';

/**
 * Two-resolution front end mapped onto a log-frequency axis (3 bins per semitone).
 * Low bins come from a long window (frequency resolution for bass partials), high bins from a short
 * window (faster response). Both windows end at the newest sample.
 */
export interface SpectrumConfig {
  sampleRate: number;
  longSize: number;
  shortSize: number;
  /** Bins below this frequency use the long window. */
  splitHz: number;
  binsPerSemitone: number;
  /** MIDI number of the lowest and highest bin centre. */
  lowMidi: number;
  highMidi: number;
}

export const DEFAULT_SPECTRUM: SpectrumConfig = {
  sampleRate: 22050,
  longSize: 4096,
  shortSize: 2048,
  splitHz: 500,
  binsPerSemitone: 3,
  lowMidi: 20,
  highMidi: 120,
};

export class LogSpectrum {
  readonly bins: number;
  readonly centerHz: Float64Array;
  /** true when the bin is fed by the long window. */
  readonly isLong: Uint8Array;
  private readonly fftLong: FFT;
  private readonly fftShort: FFT;
  private readonly winLong: Float64Array;
  private readonly winShort: Float64Array;
  private readonly magLong: Float64Array;
  private readonly magShort: Float64Array;
  private readonly lo: Int32Array;
  private readonly hi: Int32Array;
  private readonly interp: Float64Array;

  constructor(readonly cfg: SpectrumConfig = DEFAULT_SPECTRUM) {
    this.bins = Math.round((cfg.highMidi - cfg.lowMidi) * cfg.binsPerSemitone) + 1;
    this.centerHz = new Float64Array(this.bins);
    this.isLong = new Uint8Array(this.bins);
    this.lo = new Int32Array(this.bins);
    this.hi = new Int32Array(this.bins);
    this.interp = new Float64Array(this.bins);
    this.fftLong = new FFT(cfg.longSize);
    this.fftShort = new FFT(cfg.shortSize);
    this.winLong = hannWindow(cfg.longSize);
    this.winShort = hannWindow(cfg.shortSize);
    this.magLong = new Float64Array(cfg.longSize / 2 + 1);
    this.magShort = new Float64Array(cfg.shortSize / 2 + 1);
    const half = 0.5 / cfg.binsPerSemitone;
    for (let b = 0; b < this.bins; b++) {
      const midi = cfg.lowMidi + b / cfg.binsPerSemitone;
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      this.centerHz[b] = f;
      const long = f < cfg.splitHz;
      this.isLong[b] = long ? 1 : 0;
      const n = long ? cfg.longSize : cfg.shortSize;
      const df = cfg.sampleRate / n;
      const fLo = 440 * Math.pow(2, (midi - half - 69) / 12);
      const fHi = 440 * Math.pow(2, (midi + half - 69) / 12);
      this.lo[b] = Math.ceil(fLo / df);
      this.hi[b] = Math.floor(fHi / df);
      this.interp[b] = f / df;
    }
  }

  /** Bins of `out` receive the pooled magnitude. `buf` holds the newest `longSize` samples ending at `end`. */
  compute(buf: ArrayLike<number>, end: number, out: Float64Array): void {
    const { longSize, shortSize } = this.cfg;
    this.fftLong.magnitude(buf, end - longSize, this.winLong, this.magLong);
    this.fftShort.magnitude(buf, end - shortSize, this.winShort, this.magShort);
    for (let b = 0; b < this.bins; b++) {
      const mag = this.isLong[b] ? this.magLong : this.magShort;
      const lo = this.lo[b]!;
      const hi = Math.min(this.hi[b]!, mag.length - 1);
      let v = 0;
      if (hi >= lo) {
        for (let k = lo; k <= hi; k++) if (mag[k]! > v) v = mag[k]!;
      } else {
        // Bin narrower than the FFT resolution: interpolate at the centre frequency.
        const x = this.interp[b]!;
        const k = Math.floor(x);
        const t = x - k;
        v = (mag[k] ?? 0) * (1 - t) + (mag[k + 1] ?? 0) * t;
      }
      out[b] = v;
    }
  }
}
