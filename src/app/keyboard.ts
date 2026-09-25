import { isBlackKey } from '../music/spelling';

export const PIANO_LOW = 21;
export const PIANO_HIGH = 108;

export interface KeyRect {
  pitch: number;
  black: boolean;
  x: number;
  w: number;
}

export interface KeyboardLayout {
  lo: number;
  hi: number;
  whiteWidth: number;
  keys: Map<number, KeyRect>;
}

/** Extends a range so it starts and ends on white keys, clamped to the 88 keys. */
export function normalizeRange(lo: number, hi: number): [number, number] {
  let a = Math.max(PIANO_LOW, Math.min(lo, hi));
  let b = Math.min(PIANO_HIGH, Math.max(lo, hi));
  while (a > PIANO_LOW && isBlackKey(a)) a--;
  while (b < PIANO_HIGH && isBlackKey(b)) b++;
  return [a, b];
}

/** Horizontal key geometry for [lo, hi] across `width` pixels. Black keys sit over the white-key boundary. */
export function layoutKeyboard(lo: number, hi: number, width: number): KeyboardLayout {
  [lo, hi] = normalizeRange(lo, hi);
  let whites = 0;
  for (let p = lo; p <= hi; p++) if (!isBlackKey(p)) whites++;
  const W = width / Math.max(1, whites);
  const keys = new Map<number, KeyRect>();
  let wi = 0;
  for (let p = lo; p <= hi; p++) {
    if (isBlackKey(p)) {
      const bw = W * 0.62;
      // Slight offsets like a real keyboard (C♯/D♯ lean outward, F♯/A♯ and G♯ nearly centred).
      const pc = p % 12;
      const shift = pc === 1 || pc === 6 ? -0.08 : pc === 3 || pc === 10 ? 0.08 : 0;
      keys.set(p, { pitch: p, black: true, x: wi * W - bw / 2 + shift * W, w: bw });
    } else {
      keys.set(p, { pitch: p, black: false, x: wi * W, w: W });
      wi++;
    }
  }
  return { lo, hi, whiteWidth: W, keys };
}

/** The piece's range padded to whole white keys, with a minimum width of two octaves. */
export function pieceRange(minPitch: number, maxPitch: number): [number, number] {
  let lo = minPitch - 1;
  let hi = maxPitch + 1;
  while (hi - lo < 24) {
    lo--;
    hi++;
  }
  return normalizeRange(lo, hi);
}

/** Shifts a view window by `semitones`, keeping its width, clamped to the keyboard. */
export function shiftRange(lo: number, hi: number, semitones: number): [number, number] {
  const width = hi - lo;
  let a = lo + semitones;
  if (a < PIANO_LOW) a = PIANO_LOW;
  if (a + width > PIANO_HIGH) a = PIANO_HIGH - width;
  return normalizeRange(a, a + width);
}
