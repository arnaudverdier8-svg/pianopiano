import { buildEvents, eventIndexAtOrAfter } from '../music/events';
import { noteName } from '../music/spelling';
import type { PartSelection, PracticeEvent, Song } from '../music/types';
import { GateMatcher } from './matcher';
import { Transport } from './transport';
import type { EngineSnapshot, EngineState, Evidence, GateResult, MatcherSettings, PracticeMode, ToneState } from './types';

/**
 * The deterministic practice state machine. It owns the musical cursor and the gate matcher; it knows
 * nothing about audio devices. All time values are audio-context seconds supplied by the caller.
 *
 *   idle → ready (song loaded) → running ⇄ waiting (frozen at a gate) → completed
 *                     ↘ paused ↙          ↘ previewing ("Hear this passage") ↙
 */
export class PracticeEngine {
  readonly transport = new Transport();
  readonly matcher: GateMatcher;
  private song: Song | null = null;
  private part: PartSelection = { kind: 'all' };
  private mode: PracticeMode = 'learn';
  private events: PracticeEvent[] = [];
  private gateIndex = 0;
  private state: EngineState = 'idle';
  private generation = 1;
  /** Evidence before this audio time belongs to an earlier generation. */
  private notBefore = -Infinity;
  private loop: { a: number; b: number } | null = null;
  private results: GateResult[] = [];
  private waitStartedAt: number | null = null;
  private lastEval: { tones: ToneState[]; extraNotes: number[] } = { tones: [], extraNotes: [] };
  private statusOverride: string | null = null;
  private stateBeforePreview: EngineState | null = null;
  private selfPlayed: ((pitch: number, t: number) => boolean) | null = null;
  /** Called whenever evidence from before now must be discarded (seek, loop, restart, mode or part change). */
  onGenerationChange: ((generation: number) => void) | null = null;
  onGateResolved: ((result: GateResult) => void) | null = null;

  constructor(matcher: Partial<MatcherSettings> = {}) {
    this.matcher = new GateMatcher(matcher);
  }

  // ---------- configuration ----------

  load(song: Song, part: PartSelection, now: number): void {
    this.song = song;
    this.part = part;
    this.loop = null;
    this.results = [];
    this.transport.pause(now);
    this.transport.seek(0, now);
    this.rebuild(now);
    this.state = 'ready';
  }

  setPart(part: PartSelection, now: number): void {
    this.part = part;
    this.rebuild(now);
  }

  setMode(mode: PracticeMode, now: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.rebuild(now);
  }

  setMatcherSettings(s: Partial<MatcherSettings>): void {
    this.matcher.settings = { ...this.matcher.settings, ...s };
  }

  setTempo(rate: number, now: number): void {
    this.transport.setRate(Math.max(0.25, Math.min(1.5, rate)), now);
  }

  setLoop(loop: { a: number; b: number } | null, now: number): void {
    if (loop && loop.b - loop.a < 0.25) loop = null;
    this.loop = loop;
    if (loop && (this.transport.songTime < loop.a || this.transport.songTime > loop.b)) this.seek(loop.a, now);
  }

  /** Predicate telling whether the app itself just played `pitch` around audio time t (accompaniment). */
  setSelfPlayedFilter(fn: ((pitch: number, t: number) => boolean) | null): void {
    this.selfPlayed = fn;
  }

  private rebuild(now: number): void {
    if (!this.song) return;
    const base = buildEvents(this.song, this.part);
    // Single-note mode: only the highest note of each onset of the selected part (a labelled practice aid).
    this.events =
      this.mode === 'single'
        ? base.map((e, index) => ({ ...e, index, pitches: [e.pitches[e.pitches.length - 1]!] }))
        : base;
    this.newGeneration(now);
    this.gateIndex = eventIndexAtOrAfter(this.events, this.transport.songTime);
    this.waitStartedAt = null;
    if (this.transport.frozen) this.transport.release(now);
  }

  private newGeneration(now: number): void {
    this.generation++;
    this.notBefore = now;
    this.matcher.clear();
    this.lastEval = { tones: [], extraNotes: [] };
    this.transport.resetHistory(now);
    this.onGenerationChange?.(this.generation);
  }

  // ---------- transport ----------

  get gatesActive(): boolean {
    return this.mode !== 'listen';
  }

  play(now: number): void {
    if (!this.song || this.state === 'previewing') return;
    if (this.state === 'completed') this.seek(this.loop?.a ?? 0, now);
    // Evidence captured while paused must not count after resuming.
    this.newGeneration(now);
    this.transport.play(now);
    this.state = 'running';
    this.tick(now);
  }

  pause(now: number): void {
    if (!this.song || this.state === 'previewing') return;
    this.transport.pause(now);
    this.state = 'paused';
    this.waitStartedAt = null;
  }

  toggle(now: number): void {
    if (this.state === 'running' || this.state === 'waiting') this.pause(now);
    else this.play(now);
  }

  seek(songTime: number, now: number): void {
    if (!this.song) return;
    const t = Math.max(0, Math.min(songTime, this.song.duration));
    this.transport.seek(t, now);
    this.gateIndex = eventIndexAtOrAfter(this.events, t);
    this.waitStartedAt = null;
    this.newGeneration(now);
    if (this.state === 'waiting' || this.state === 'completed') this.state = this.transport.playing ? 'running' : 'paused';
    if (this.state === 'running') this.tick(now);
  }

  restart(now: number): void {
    this.seek(this.loop?.a ?? 0, now);
  }

  // ---------- evidence ----------

  addEvidence(list: Evidence[], now: number): void {
    if (this.mode !== 'learn' && this.mode !== 'single') return; // Listen and Manual never take microphone credit
    if (this.state !== 'running' && this.state !== 'waiting') return;
    for (const e of list) {
      if (e.generation !== this.generation) continue; // stale worker result
      if (e.time < this.notBefore) continue;
      if (this.selfPlayed?.(e.pitch, e.time)) continue; // the app's own playback is never evidence
      this.matcher.add(e);
    }
    this.evaluateGate(now);
  }

  /** Space / "Continue" button: resolves the current gate as a manual skip. */
  manualAdvance(now: number): boolean {
    const gate = this.currentGate();
    if (!gate || !this.gatesActive || this.state === 'previewing') return false;
    if (this.state !== 'waiting' && this.state !== 'running') return false;
    // Only skip the gate the cursor is at or approaching.
    this.resolve(gate, 'manual', this.lastEval.tones.length ? this.lastEval.tones : gate.pitches.map((p) => ({ pitch: p, status: 'expected', confidence: 0 })), [], [], now);
    return true;
  }

  // ---------- preview ("Hear this passage") ----------

  beginPreview(now: number): boolean {
    if (!this.song || this.state === 'previewing') return false;
    this.stateBeforePreview = this.state === 'running' || this.state === 'waiting' ? 'waiting' : this.state;
    this.transport.pause(now);
    this.state = 'previewing';
    this.newGeneration(now);
    return true;
  }

  /** Call only after playback stopped and the ring-down check passed. */
  endPreview(now: number): void {
    if (this.state !== 'previewing') return;
    this.newGeneration(now);
    const back = this.stateBeforePreview;
    this.state = 'paused';
    if (back === 'waiting' || back === 'running') this.play(now);
    this.stateBeforePreview = null;
  }

  // ---------- clock ----------

  tick(now: number): void {
    if (!this.song) return;
    if (this.state !== 'running' && this.state !== 'waiting') return;
    const gate = this.gatesActive ? this.currentGate() : null;
    const loopB = this.loop?.b ?? Infinity;
    const gateTime = gate && gate.time < loopB ? gate.time : null;
    const frozen = this.transport.advance(now, gateTime);
    if (this.loop && this.transport.songTime >= this.loop.b) {
      this.seek(this.loop.a, now);
      return;
    }
    if (frozen) {
      if (this.state !== 'waiting') {
        this.state = 'waiting';
        this.waitStartedAt = now;
      }
      this.evaluateGate(now);
    } else {
      this.state = 'running';
      if (gate) this.evaluateGate(now); // early playing is allowed
    }
    if (!gate && this.transport.songTime >= this.song.duration) {
      this.transport.pause(now);
      this.state = 'completed';
    }
    // Bounded memory: evidence older than 30 s can never qualify.
    this.matcher.prune(now - 30);
  }

  private currentGate(): PracticeEvent | null {
    return this.events[this.gateIndex] ?? null;
  }

  private evaluateGate(now: number): void {
    const gate = this.currentGate();
    if (!gate || !this.gatesActive || this.mode === 'manual') {
      this.lastEval = gate ? { tones: gate.pitches.map((p) => ({ pitch: p, status: 'expected', confidence: 0 })), extraNotes: [] } : { tones: [], extraNotes: [] };
      return;
    }
    const res = this.matcher.evaluate(gate, { now, cursorAt: (t) => this.transport.at(t), notBefore: this.notBefore });
    this.lastEval = { tones: res.tones, extraNotes: res.extraNotes };
    if (res.satisfied) {
      const partial = res.tones.some((t) => t.status !== 'heard');
      this.resolve(gate, partial ? 'recognized-uncertain-parts' : 'recognized', res.tones, res.extraNotes, res.used, now);
    }
  }

  private resolve(gate: PracticeEvent, kind: GateResult['kind'], tones: ToneState[], extraNotes: number[], used: number[], now: number): void {
    this.matcher.consume(used);
    const result: GateResult = {
      eventIndex: gate.index,
      kind,
      tones,
      resolvedAt: now,
      waited: this.waitStartedAt !== null ? now - this.waitStartedAt : 0,
      extraNotes,
    };
    this.results.push(result);
    if (this.results.length > 5000) this.results.shift();
    this.onGateResolved?.(result);
    this.gateIndex++;
    this.waitStartedAt = null;
    this.lastEval = { tones: [], extraNotes: [] };
    if (this.transport.frozen) this.transport.release(now);
    if (this.state === 'waiting') this.state = 'running';
    // A following gate at the same song time (should not happen after grouping) or one already reached: re-tick.
    this.tick(now);
  }

  // ---------- read-out ----------

  get currentGeneration(): number {
    return this.generation;
  }

  get eventList(): readonly PracticeEvent[] {
    return this.events;
  }

  get currentMode(): PracticeMode {
    return this.mode;
  }

  get currentState(): EngineState {
    return this.state;
  }

  setStatusOverride(s: string | null): void {
    this.statusOverride = s;
  }

  snapshot(): EngineSnapshot {
    const gate = this.gatesActive ? this.currentGate() : null;
    const totals = { recognized: 0, withUncertainParts: 0, manual: 0 };
    for (const r of this.results) {
      if (r.kind === 'recognized') totals.recognized++;
      else if (r.kind === 'manual') totals.manual++;
      else totals.withUncertainParts++;
    }
    return {
      state: this.state,
      mode: this.mode,
      songTime: this.transport.songTime,
      rate: this.transport.rate,
      generation: this.generation,
      gate,
      gateIndex: this.gateIndex,
      tones: this.lastEval.tones,
      extraNotes: this.lastEval.extraNotes,
      status: this.statusOverride ?? this.describe(gate),
      loop: this.loop,
      results: this.results,
      totals,
    };
  }

  private keyAt(): number {
    if (!this.song) return 0;
    let acc = 0;
    for (const k of this.song.keys) if (k.tick <= (this.currentGate()?.tick ?? 0)) acc = k.accidentals;
    return acc;
  }

  private describe(gate: PracticeEvent | null): string {
    const key = this.keyAt();
    const name = (p: number) => noteName(p, key);
    switch (this.state) {
      case 'idle':
        return 'No piece loaded';
      case 'ready':
        return this.mode === 'listen' ? 'Ready to play the piece' : 'Ready — press Start';
      case 'paused':
        return 'Paused';
      case 'previewing':
        return 'Playing the passage — matching is paused';
      case 'completed':
        return 'Finished';
      case 'error':
        return 'Error';
      default:
        break;
    }
    if (this.mode === 'listen') return 'Listening mode — the app plays, nothing is scored';
    if (!gate) return 'Playing to the end';
    if (this.state === 'running') return `Next: ${gate.pitches.map(name).join(' + ')}`;
    if (this.mode === 'manual') return `Manual mode — press Space for ${gate.pitches.map(name).join(' + ')}`;
    const tones = this.lastEval.tones;
    const missing = tones.filter((t) => t.status === 'expected').map((t) => t.pitch);
    const heard = tones.filter((t) => t.status === 'heard' || t.status === 'octave').map((t) => t.pitch);
    const uncertain = tones.filter((t) => t.status === 'uncertain');
    const stale = tones.filter((t) => t.status === 'stale').map((t) => t.pitch);
    if (this.lastEval.extraNotes.length >= this.matcher.settings.blockOnExtraNotes && this.matcher.settings.blockOnExtraNotes > 0)
      return `Too many other notes heard (${this.lastEval.extraNotes.map(name).join(', ')}) — play just ${gate.pitches.map(name).join(' + ')}`;
    if (stale.length) return `Play the chord together — ${stale.map(name).join(' + ')} came too early`;
    const hardToHear = uncertain.filter((t) => t.maskedBy !== undefined);
    if (hardToHear.length && !missing.length)
      return `${hardToHear.map((t) => name(t.pitch)).join(' + ')} hard to hear (overlaps ${name(hardToHear[0]!.maskedBy!)}) — play again, or press Space if you played it`;
    if (uncertain.length && !missing.length) return `Recognition uncertain for ${uncertain.map((t) => name(t.pitch)).join(' + ')} — play again or press Space`;
    if (heard.length && missing.length) return `Heard ${heard.map(name).join(' + ')} · waiting for ${missing.map(name).join(' + ')}`;
    return `Waiting for ${gate.pitches.map(name).join(' + ')}`;
  }
}
