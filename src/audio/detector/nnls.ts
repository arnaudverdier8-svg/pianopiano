import type { Dictionary } from './templates';

/**
 * Sparse nonnegative least squares by coordinate descent:
 *   minimise ½‖v − W h‖² + λ Σ h   subject to h ≥ 0,
 * with W the unit-norm dictionary. Works on the Gram matrix, so each sweep costs O(atoms²).
 */
export class SparseNNLS {
  readonly n: number;
  readonly b: Float64Array; // Wᵀv
  readonly h: Float64Array;
  private readonly gh: Float64Array; // G h
  private vv = 0;

  constructor(private readonly dict: Dictionary) {
    this.n = dict.atoms.length;
    this.b = new Float64Array(this.n);
    this.h = new Float64Array(this.n);
    this.gh = new Float64Array(this.n);
  }

  /** Projects v onto the atoms. Returns ‖v‖². */
  load(v: Float64Array): number {
    let vv = 0;
    for (let k = 0; k < v.length; k++) vv += v[k]! * v[k]!;
    this.vv = vv;
    for (let i = 0; i < this.n; i++) {
      const a = this.dict.atoms[i]!;
      let s = 0;
      for (let k = 0; k < v.length; k++) s += a[k]! * v[k]!;
      this.b[i] = s;
    }
    return vv;
  }

  solve(lambda: number, sweeps = 40, exclude = -1, h: Float64Array = this.h): void {
    const { n, b } = this;
    const G = this.dict.gram;
    const gh = this.gh;
    gh.fill(0);
    for (let j = 0; j < n; j++) {
      const hj = h[j]!;
      if (hj === 0) continue;
      for (let i = 0; i < n; i++) gh[i] = gh[i]! + G[i * n + j]! * hj;
    }
    for (let s = 0; s < sweeps; s++) {
      let maxDelta = 0;
      for (let i = 0; i < n; i++) {
        const old = h[i]!;
        const next = i === exclude ? 0 : Math.max(0, old + (b[i]! - gh[i]! - lambda) / G[i * n + i]!);
        const d = next - old;
        if (d !== 0) {
          h[i] = next;
          for (let j = 0; j < n; j++) gh[j] = gh[j]! + G[j * n + i]! * d;
          if (Math.abs(d) > maxDelta) maxDelta = Math.abs(d);
        }
      }
      if (maxDelta < 1e-7) break;
    }
  }

  /** ‖v − W h‖² for any coefficient vector (uses the loaded projection). */
  residual(h: Float64Array = this.h): number {
    const { n, b } = this;
    const G = this.dict.gram;
    let hb = 0;
    let hGh = 0;
    for (let i = 0; i < n; i++) {
      const hi = h[i]!;
      if (hi === 0) continue;
      hb += hi * b[i]!;
      let row = 0;
      for (let j = 0; j < n; j++) row += G[i * n + j]! * h[j]!;
      hGh += hi * row;
    }
    return Math.max(0, this.vv - 2 * hb + hGh);
  }

  /**
   * Leave-one-out test: how much residual energy appears when atom i is forbidden and the others refit.
   * A pitch that is only a harmonic of another played pitch scores near zero.
   */
  uniqueContribution(i: number, lambda: number, scratch: Float64Array): number {
    const base = this.residual(this.h) + 2 * lambda * sum(this.h);
    scratch.set(this.h);
    scratch[i] = 0;
    this.solve(lambda, 15, i, scratch);
    const without = this.residual(scratch) + 2 * lambda * sum(scratch);
    return Math.max(0, without - base);
  }

  get energy(): number {
    return this.vv;
  }
}

function sum(h: Float64Array): number {
  let s = 0;
  for (let i = 0; i < h.length; i++) s += h[i]!;
  return s;
}
