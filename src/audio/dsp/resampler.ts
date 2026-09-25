/**
 * Streaming windowed-sinc resampler for an arbitrary rate ratio (e.g. 48000 → 22050).
 * Low-pass cutoff sits just below the lower Nyquist so downsampling does not alias.
 * Keeps its history between calls, so chunk boundaries are seamless.
 */
export class Resampler {
  private readonly ratio: number; // input samples per output sample
  private readonly halfTaps: number;
  private readonly cutoff: number; // normalised to the input rate (cycles/sample)
  private history: Float32Array;
  private historyLen = 0;
  /** Position of the next output sample, in input samples relative to history[0]. */
  private pos: number;
  private readonly table: Float32Array;
  private static readonly PHASES = 512;

  constructor(
    readonly inputRate: number,
    readonly outputRate: number,
    halfTaps = 16,
  ) {
    if (!(inputRate > 0 && outputRate > 0)) throw new Error('Sample rates must be positive');
    this.ratio = inputRate / outputRate;
    this.halfTaps = halfTaps;
    this.cutoff = 0.5 * Math.min(1, outputRate / inputRate) * 0.94;
    this.history = new Float32Array(8192);
    this.pos = halfTaps; // first output needs halfTaps of look-behind (zeros)
    this.historyLen = halfTaps;
    // Precompute the kernel on a fine phase grid: sinc * Blackman window.
    const P = Resampler.PHASES;
    const taps = 2 * halfTaps;
    this.table = new Float32Array((P + 1) * taps);
    for (let p = 0; p <= P; p++) {
      const frac = p / P;
      for (let t = 0; t < taps; t++) {
        const x = t - halfTaps + 1 - frac; // distance from output instant to tap, in input samples
        const arg = 2 * this.cutoff * x;
        const sinc = x === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
        const n = (x + halfTaps) / (2 * halfTaps);
        const win = n <= 0 || n >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
        this.table[p * taps + t] = 2 * this.cutoff * sinc * win;
      }
    }
  }

  /** Output samples produced so far correspond to input time `(inputConsumed - latency)`; latency is halfTaps input samples. */
  get latencyInputSamples(): number {
    return this.halfTaps;
  }

  process(input: Float32Array): Float32Array {
    if (this.inputRate === this.outputRate) return input.slice();
    // Append input to history.
    const needed = this.historyLen + input.length;
    if (needed > this.history.length) {
      const grown = new Float32Array(Math.max(needed, this.history.length * 2));
      grown.set(this.history.subarray(0, this.historyLen));
      this.history = grown;
    }
    this.history.set(input, this.historyLen);
    this.historyLen += input.length;

    const taps = 2 * this.halfTaps;
    const P = Resampler.PHASES;
    const maxOut = Math.ceil((this.historyLen - this.pos) / this.ratio) + 1;
    const out = new Float32Array(Math.max(0, maxOut));
    let n = 0;
    const h = this.history;
    while (this.pos + this.halfTaps < this.historyLen) {
      const base = Math.floor(this.pos);
      const frac = this.pos - base;
      const phase = Math.round(frac * P);
      const k = phase * taps;
      let acc = 0;
      const start = base - this.halfTaps + 1;
      for (let t = 0; t < taps; t++) acc += h[start + t]! * this.table[k + t]!;
      out[n++] = acc;
      this.pos += this.ratio;
    }
    // Drop consumed history, keeping enough look-behind for the next call.
    const keepFrom = Math.max(0, Math.floor(this.pos) - this.halfTaps);
    if (keepFrom > 0) {
      h.copyWithin(0, keepFrom, this.historyLen);
      this.historyLen -= keepFrom;
      this.pos -= keepFrom;
    }
    return out.subarray(0, n);
  }

  reset(): void {
    this.history.fill(0);
    this.historyLen = this.halfTaps;
    this.pos = this.halfTaps;
  }
}
