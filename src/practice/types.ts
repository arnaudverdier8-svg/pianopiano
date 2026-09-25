import type { PracticeEvent } from '../music/types';

export type PracticeMode = 'learn' | 'listen' | 'single' | 'manual';

export type EngineState = 'idle' | 'ready' | 'running' | 'waiting' | 'paused' | 'previewing' | 'completed' | 'error';

/** Microphone onset evidence as the engine sees it (already tagged with the generation it belongs to). */
export interface Evidence {
  id: number;
  pitch: number;
  /** Estimated attack time in audio-context seconds. */
  time: number;
  confidence: number;
  harmonicOf?: number;
  generation: number;
}

export type ToneStatus =
  | 'expected' // nothing heard yet
  | 'heard' // clear, independent evidence
  | 'masked' // evidence exists but coincides with partials of another expected note
  | 'octave' // accepted through bass-octave tolerance (octave above/below heard)
  | 'inferred' // accepted on the lower note of an octave ("trust lower note" policy) — not heard
  | 'uncertain' // weak or ambiguous evidence; does not advance
  | 'stale'; // was heard, but too long before the other chord tones

export interface ToneState {
  pitch: number;
  status: ToneStatus;
  confidence: number;
  onsetId?: number;
  onsetTime?: number;
  /** For masked/uncertain: the pitch whose partials may explain it. */
  maskedBy?: number;
}

export type ResolutionKind = 'recognized' | 'recognized-uncertain-parts' | 'manual';

export interface GateResult {
  eventIndex: number;
  kind: ResolutionKind;
  tones: ToneState[];
  /** Audio time at which the gate was satisfied. */
  resolvedAt: number;
  /** Seconds the transport spent frozen at this gate. */
  waited: number;
  extraNotes: number[];
}

export interface MatcherSettings {
  /** Confidence for clear evidence. */
  acceptConfidence: number;
  /** Minimum confidence for masked (harmonic-coincident) evidence. */
  maskedConfidence: number;
  /** Below acceptConfidence but at least this → shown as uncertain. */
  uncertainConfidence: number;
  /** Maximum spread between the first and last tone of a chord, seconds (gently rolled chords). */
  rollWindow: number;
  /** How far ahead of the strike line (real seconds) an onset may be played and still count. */
  earlyTolerance: number;
  /** Octave doublings: 'verify' needs evidence for the upper note; 'trust-lower' accepts it on the lower note (marked inferred). */
  octavePolicy: 'verify' | 'trust-lower';
  /** Below this MIDI pitch, an octave-displaced detection counts (laptop microphones barely capture bass fundamentals). 0 = off. */
  bassOctaveBelow: number;
  /** Confident onsets outside the chord that block acceptance. 0 = never block. */
  blockOnExtraNotes: number;
}

export const DEFAULT_MATCHER: MatcherSettings = {
  acceptConfidence: 0.55,
  maskedConfidence: 0.3,
  uncertainConfidence: 0.3,
  rollWindow: 0.4,
  earlyTolerance: 0.45,
  octavePolicy: 'verify',
  bassOctaveBelow: 0,
  blockOnExtraNotes: 3,
};

export interface EngineSnapshot {
  state: EngineState;
  mode: PracticeMode;
  songTime: number;
  rate: number;
  generation: number;
  gate: PracticeEvent | null;
  gateIndex: number;
  tones: ToneState[];
  /** Confident onsets heard near the gate that are not part of it (wrong or extra notes). */
  extraNotes: number[];
  status: string;
  loop: { a: number; b: number } | null;
  results: GateResult[];
  totals: { recognized: number; withUncertainParts: number; manual: number };
}
