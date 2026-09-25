/** In-place iterative radix-2 complex FFT with precomputed tables. Allocation-free after construction. */
export class FFT {
  readonly size: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  readonly re: Float64Array;
  readonly im: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
  }

  /** Transforms this.re/this.im in place. */
  transform(): void {
    const { size, re, im, rev, cos, sin } = this;
    for (let i = 0; i < size; i++) {
      const j = rev[i]!;
      if (j > i) {
        let t = re[i]!;
        re[i] = re[j]!;
        re[j] = t;
        t = im[i]!;
        im[i] = im[j]!;
        im[j] = t;
      }
    }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const step = size / len;
      for (let start = 0; start < size; start += len) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step]!;
          const wi = sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  }

  /** Windowed magnitude spectrum of real input (bins 0..size/2). `out` must have size/2+1 entries. */
  magnitude(input: ArrayLike<number>, offset: number, window: Float64Array, out: Float64Array): void {
    const { size, re, im } = this;
    for (let i = 0; i < size; i++) {
      re[i] = (input[offset + i] ?? 0) * window[i]!;
      im[i] = 0;
    }
    this.transform();
    for (let i = 0; i <= size / 2; i++) out[i] = Math.hypot(re[i]!, im[i]!);
  }
}

/** Hann window scaled so a full-scale sinusoid of amplitude A peaks at A in the magnitude spectrum. */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    sum += w[i]!;
  }
  for (let i = 0; i < size; i++) w[i] = (w[i]! * 2) / sum;
  return w;
}
