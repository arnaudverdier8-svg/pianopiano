/** Normalized, parser-independent song model. All positions are kept in MIDI ticks; seconds are derived from the tempo map at 100% tempo. */

export type Hand = 'right' | 'left';

export interface SongNote {
  /** Index into Song.notes (notes are sorted by tick, then pitch). */
  id: number;
  pitch: number;
  tick: number;
  durationTicks: number;
  /** Seconds from song start at 100% tempo, via the tempo map. */
  time: number;
  duration: number;
  /** 0..1 as stored in the file. */
  velocity: number;
  track: number;
  channel: number;
  /** Present only when a validated hand mapping exists (see HandMappingInfo). */
  hand?: Hand;
}

export interface SongTrack {
  index: number;
  name: string;
  channel: number;
  noteCount: number;
  minPitch: number;
  maxPitch: number;
  /** Human label, e.g. "Upper staff". Comes from the sidecar when validated, else the MIDI track name. */
  label: string;
}

export interface TempoPoint {
  tick: number;
  time: number;
  /** Quarter notes per minute, as written in the file. */
  bpm: number;
}

export interface MeterPoint {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface KeyPoint {
  tick: number;
  /** Negative = flats, positive = sharps. */
  accidentals: number;
  mode: 'major' | 'minor';
  /** Correct tonic name, e.g. "C♯ minor" (not the relative major). */
  name: string;
}

export interface Bar {
  /** 1-based bar number as printed in the score (bar 1 = first full bar unless an anacrusis is declared). */
  number: number;
  tick: number;
  time: number;
  numerator: number;
  denominator: number;
  lengthTicks: number;
}

export interface PedalEvent {
  tick: number;
  time: number;
  /** CC64 value 0..127 as stored in the file. */
  value: number;
}

export interface TextMark {
  bar: number;
  tick: number;
  text: string;
}

export interface Provenance {
  source: string;
  catalogUrl?: string;
  fileUrl?: string;
  license?: string;
  edition?: string;
  maintainer?: string;
  sha256?: string;
}

export interface HandMappingInfo {
  /** How the hand labels were obtained; shown to the user. */
  method: string;
  /** Notes the mapping could not assign; they stay visible and are required in "Both". */
  unassigned: number;
}

export interface Song {
  id: string;
  title: string;
  composer: string;
  ppq: number;
  durationTicks: number;
  duration: number;
  notes: SongNote[];
  tracks: SongTrack[];
  tempos: TempoPoint[];
  meters: MeterPoint[];
  keys: KeyPoint[];
  bars: Bar[];
  pedal: PedalEvent[];
  textMarks: TextMark[];
  provenance?: Provenance;
  handMapping?: HandMappingInfo;
  /** True when track labels were validated against a sidecar (not guessed). */
  tracksValidated: boolean;
  warnings: string[];
}

/** Which notes the player must play. The rest are shown dimmed (and can be heard in Listen mode). */
export type PartSelection =
  | { kind: 'all' }
  | { kind: 'tracks'; tracks: number[] }
  | { kind: 'hand'; hand: Hand };

/** One gate of the wait-for-notes engine: every pitch here needs fresh evidence. */
export interface PracticeEvent {
  index: number;
  tick: number;
  time: number;
  /** Sorted, unique MIDI pitches. */
  pitches: number[];
  noteIds: number[];
  bar: number;
}
