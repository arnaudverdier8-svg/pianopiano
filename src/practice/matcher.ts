import type { PracticeEvent } from '../music/types';
import { DEFAULT_MATCHER, type Evidence, type MatcherSettings, type ToneState } from './types';

/** Semitone distances of partials 2, 3, 4, 5, 6, 8 — an unflagged detection at these offsets above an expected note is not counted as a wrong note. */
const PARTIAL_OFFSETS = new Set([12, 19, 24, 28, 31, 36]);
const POOL_LIMIT = 256;

export interface MatchContext {
  now: number;
  /** Where the cursor was (song seconds) and at which rate, at audio time t. */
  cursorAt: (t: number) => { song: number; rate: number };
  /** Evidence before this audio time belongs to an earlier session/seek and is ignored. */
  notBefore: number;
}

export interface MatchResult {
  satisfied: boolean;
  tones: ToneState[];
  extraNotes: number[];
  /** Onsets to consume if the gate is resolved. */
  used: number[];
}

/**
 * Decides whether one gate (a set of pitches with a common onset) has been played, from onset evidence.
 * Pure and deterministic: all timing comes from evidence timestamps and the supplied context.
 */
export class GateMatcher {
  settings: MatcherSettings;
  private pool = new Map<number, Evidence>();
  private consumed = new Set<number>();

  constructor(settings: Partial<MatcherSettings> = {}) {
    this.settings = { ...DEFAULT_MATCHER, ...settings };
  }

  add(e: Evidence): void {
    const prev = this.pool.get(e.id);
    // Updates of the same onset keep the best confidence but the original attack time.
    if (prev) {
      if (e.confidence > prev.confidence) this.pool.set(e.id, { ...e, time: prev.time });
      return;
    }
    this.pool.set(e.id, e);
    if (this.pool.size > POOL_LIMIT) {
      const oldest = [...this.pool.values()].sort((a, b) => a.time - b.time).slice(0, this.pool.size - POOL_LIMIT);
      for (const o of oldest) {
        this.pool.delete(o.id);
        this.consumed.delete(o.id);
      }
    }
  }

  consume(ids: number[]): void {
    for (const id of ids) this.consumed.add(id);
  }

  clear(): void {
    this.pool.clear();
    this.consumed.clear();
  }

  /** Drop evidence older than `t` (bounded memory; evidence that old can never qualify). */
  prune(t: number): void {
    for (const [id, e] of this.pool) {
      if (e.time < t) {
        this.pool.delete(id);
        this.consumed.delete(id);
      }
    }
  }

  private qualifies(e: Evidence, gate: PracticeEvent, ctx: MatchContext): boolean {
    if (this.consumed.has(e.id)) return false;
    if (e.time < ctx.notBefore) return false;
    if (e.time > ctx.now + 0.05) return false;
    const { song, rate } = ctx.cursorAt(e.time);
    const early = (gate.time - song) / Math.max(0.01, rate);
    return early <= this.settings.earlyTolerance;
  }

  evaluate(gate: PracticeEvent, ctx: MatchContext): MatchResult {
    const s = this.settings;
    const expected = new Set(gate.pitches);
    const candidates = [...this.pool.values()].filter((e) => this.qualifies(e, gate, ctx));
    const byPitch = new Map<number, Evidence[]>();
    for (const e of candidates) {
      const list = byPitch.get(e.pitch);
      if (list) list.push(e);
      else byPitch.set(e.pitch, [e]);
    }
    const newestFirst = (a: Evidence, b: Evidence) => b.time - a.time;
    const taken = new Set<number>();

    // Pass 1: direct evidence for each expected pitch.
    const tones = new Map<number, ToneState>();
    for (const p of gate.pitches) {
      const list = (byPitch.get(p) ?? []).sort(newestFirst);
      const clear = list.find((e) => e.confidence >= s.acceptConfidence && e.harmonicOf === undefined);
      const masked = list.find((e) => e.harmonicOf !== undefined && expected.has(e.harmonicOf) && e.confidence >= s.maskedConfidence);
      const weak = list.find((e) => e.confidence >= s.uncertainConfidence);
      if (clear) {
        tones.set(p, { pitch: p, status: 'heard', confidence: clear.confidence, onsetId: clear.id, onsetTime: clear.time });
        taken.add(clear.id);
      } else if (masked) {
        tones.set(p, { pitch: p, status: 'masked', confidence: masked.confidence, onsetId: masked.id, onsetTime: masked.time, maskedBy: masked.harmonicOf! });
        taken.add(masked.id);
      } else if (weak) {
        const t: ToneState = { pitch: p, status: 'uncertain', confidence: weak.confidence, onsetId: weak.id, onsetTime: weak.time };
        if (weak.harmonicOf !== undefined) t.maskedBy = weak.harmonicOf;
        tones.set(p, t);
      } else {
        tones.set(p, { pitch: p, status: 'expected', confidence: 0 });
      }
    }

    // Pass 2: bass-octave tolerance with onsets not already used by another tone.
    if (s.bassOctaveBelow > 0) {
      for (const p of gate.pitches) {
        const t = tones.get(p)!;
        if (p >= s.bassOctaveBelow || t.status === 'heard' || t.status === 'masked') continue;
        const alt = [...(byPitch.get(p + 12) ?? []), ...(byPitch.get(p - 12) ?? [])]
          .filter((e) => !taken.has(e.id) && e.confidence >= s.acceptConfidence && !expected.has(e.pitch))
          .sort(newestFirst)[0];
        if (alt) {
          tones.set(p, { pitch: p, status: 'octave', confidence: alt.confidence, onsetId: alt.id, onsetTime: alt.time, maskedBy: alt.pitch });
          taken.add(alt.id);
        }
      }
    }

    // Pass 3: masked tones need their masking note to be clearly heard; "trust-lower" infers octave doublings.
    for (const p of gate.pitches) {
      const t = tones.get(p)!;
      if (t.status === 'masked') {
        const parent = tones.get(t.maskedBy!);
        if (!parent || (parent.status !== 'heard' && parent.status !== 'octave')) tones.set(p, { ...t, status: 'uncertain' });
      }
      if (s.octavePolicy === 'trust-lower' && (t.status === 'expected' || t.status === 'uncertain')) {
        const lower = tones.get(p - 12);
        if (lower && lower.status === 'heard') tones.set(p, { pitch: p, status: 'inferred', confidence: 0, maskedBy: p - 12 });
      }
    }

    // Roll window: every accepted tone must lie within rollWindow of the newest one.
    const accepted = [...tones.values()].filter((t) => t.onsetTime !== undefined && (t.status === 'heard' || t.status === 'masked' || t.status === 'octave'));
    const newest = accepted.reduce((m, t) => Math.max(m, t.onsetTime!), -Infinity);
    for (const t of accepted) {
      if (newest - t.onsetTime! > s.rollWindow) tones.set(t.pitch, { ...t, status: 'stale' });
    }

    // Extra notes: confident onsets near the chord that are neither expected nor a partial of an expected note.
    const windowStart = Number.isFinite(newest) ? newest - s.rollWindow : ctx.now - s.rollWindow;
    const extraNotes = [
      ...new Set(
        candidates
          .filter((e) => !taken.has(e.id) && !expected.has(e.pitch) && e.time >= windowStart)
          .filter((e) => e.confidence >= s.acceptConfidence && e.harmonicOf === undefined)
          .filter((e) => !gate.pitches.some((p) => PARTIAL_OFFSETS.has(e.pitch - p)))
          .filter((e) => !(s.bassOctaveBelow > 0 && gate.pitches.some((p) => p < s.bassOctaveBelow && Math.abs(e.pitch - p) === 12)))
          .map((e) => e.pitch),
      ),
    ].sort((a, b) => a - b);

    const list = gate.pitches.map((p) => tones.get(p)!);
    const done = (t: ToneState) => t.status === 'heard' || t.status === 'masked' || t.status === 'octave' || t.status === 'inferred';
    const blocked = s.blockOnExtraNotes > 0 && extraNotes.length >= s.blockOnExtraNotes;
    const satisfied = list.every(done) && !blocked;
    const used = list.filter((t) => done(t) && t.onsetId !== undefined).map((t) => t.onsetId!);
    return { satisfied, tones: list, extraNotes, used };
  }
}
