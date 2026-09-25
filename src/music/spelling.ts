const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const NEUTRAL_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const MAJOR_TONICS = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const MINOR_TONICS = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];

/** Key name from a MIDI key signature (accidental count + mode). */
export function keyName(accidentals: number, mode: 'major' | 'minor'): string {
  const i = Math.max(-7, Math.min(7, Math.round(accidentals))) + 7;
  return `${(mode === 'major' ? MAJOR_TONICS : MINOR_TONICS)[i]} ${mode}`;
}

/** Pitch class name spelled for the key: flats in flat keys, sharps in sharp keys. */
export function pitchClassName(pitch: number, keyAccidentals = 0): string {
  const pc = ((pitch % 12) + 12) % 12;
  const table = keyAccidentals < 0 ? FLAT_NAMES : keyAccidentals > 0 ? SHARP_NAMES : NEUTRAL_NAMES;
  return table[pc]!;
}

/** Scientific pitch name, e.g. 61 in D♭ major → "D♭4". Middle C (60) is C4. */
export function noteName(pitch: number, keyAccidentals = 0): string {
  return `${pitchClassName(pitch, keyAccidentals)}${Math.floor(pitch / 12) - 1}`;
}

/** Screen-reader friendly form: "D-flat 4". */
export function spokenNoteName(pitch: number, keyAccidentals = 0): string {
  return noteName(pitch, keyAccidentals).replace('♭', '-flat ').replace('♯', '-sharp ').replace(/([A-G])(\d)/, '$1 $2');
}

export function isBlackKey(pitch: number): boolean {
  const pc = ((pitch % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function midiToHz(pitch: number, a4 = 440): number {
  return a4 * Math.pow(2, (pitch - 69) / 12);
}
