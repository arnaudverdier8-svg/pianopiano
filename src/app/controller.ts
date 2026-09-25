import { AudioSystem, MicError, type InputInfo } from '../audio/capture';
import type { DetectorCapabilities, DetectorFrame, OnsetEvidence, OnsetRejection, SoundingPitch } from '../audio/detector/types';
import type { FrameMessage } from '../audio/protocol';
import { barAtTick } from '../music/meter';
import { MidiImportError, parseMidi, sha256Hex, type SongSidecar } from '../music/parse';
import type { PartSelection, Song } from '../music/types';
import { PracticeEngine } from '../practice/engine';
import type { EngineSnapshot, Evidence, GateResult, PracticeMode } from '../practice/types';
import { PianoSampler } from '../playback/sampler';
import { PlaybackScheduler } from '../playback/scheduler';
import { addSession, loadProgress, savePosition } from '../storage/progress';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings, type PartChoice } from '../storage/settings';

/** One piece of the bundled practice library (public/songs/library.json). */
export interface LibraryEntry {
  id: string;
  title: string;
  composer: string;
  file: string;
  sha256: string;
  source: string;
  catalogUrl: string;
  fileUrl: string;
  license: string;
}

export type SongStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'missing'; detail: string }
  | { kind: 'error'; detail: string };

export type MicState =
  | { kind: 'off' }
  | { kind: 'starting' }
  | { kind: 'on' }
  | { kind: 'error'; error: MicError };

export interface Levels {
  rmsDb: number;
  peak: number;
  clippedRecently: boolean;
  tooQuiet: boolean;
  noiseDb: number;
  residual: number;
}

export interface LatencyStats {
  /** Attack (audio timestamp) → evidence reaching the main thread, seconds. */
  decision: number[];
  /** Frame end (newest analysed sample) → main thread, seconds: buffering + transfer + analysis. */
  pipeline: number[];
  processMsPerFrame: number[];
  queueSeconds: number;
  droppedChunks: number;
}

export interface RecentOnset extends OnsetEvidence {
  receivedAt: number;
}

export interface PreviewState {
  phase: 'idle' | 'playing' | 'ringdown';
  until: number;
}

const BUNDLED = { midi: 'songs/clair-de-lune.mid', sidecar: 'songs/clair-de-lune.json' };

/**
 * Glue between the pure practice engine and the browser: audio clock, microphone worker, playback and
 * persistence. React components subscribe to coarse updates; the canvas reads live fields every frame.
 */
export class PracticeController {
  readonly audio = new AudioSystem();
  readonly engine: PracticeEngine;
  settings: AppSettings;
  song: Song | null = null;
  songStatus: SongStatus = { kind: 'loading' };
  isBundled = false;
  /** Pieces available in the library picker (Clair de lune is listed first, separately). */
  library: LibraryEntry[] = [];
  currentLibraryId: string | null = 'clair-de-lune';
  mic: MicState = { kind: 'off' };
  levels: Levels = { rmsDb: -100, peak: 0, clippedRecently: false, tooQuiet: false, noiseDb: -100, residual: 0 };
  sounding: SoundingPitch[] = [];
  soundingAt = 0;
  recentOnsets: RecentOnset[] = [];
  recentRejections: (OnsetRejection & { time: number })[] = [];
  latency: LatencyStats = { decision: [], pipeline: [], processMsPerFrame: [], queueSeconds: 0, droppedChunks: 0 };
  preview: PreviewState = { phase: 'idle', until: 0 };
  lastResult: GateResult | null = null;
  /** How each passed note of the selected part was resolved (drawn as ✓ / ~ / ›). Cleared on seek/loop/part change. */
  resolvedNotes = new Map<number, GateResult['kind']>();
  lastResultAt = 0;
  notice: string | null = null;
  snap: EngineSnapshot;
  capabilities: DetectorCapabilities | null = null;
  private sampler: PianoSampler | null = null;
  private scheduler: PlaybackScheduler | null = null;
  private listeners = new Set<() => void>();
  private timer: number | null = null;
  private lastNotify = 0;
  private peakHistory: { t: number; peak: number; rms: number }[] = [];
  private sessionStart: { at: string; bar: number; totals: EngineSnapshot['totals'] } | null = null;
  private quietSince: number | null = null;
  private seenOnsets = new Set<number>();
  private lastSeenSongTime = 0;
  private loadToken = 0;

  constructor() {
    this.settings = loadSettings();
    this.engine = new PracticeEngine(this.settings.matcher);
    this.snap = this.engine.snapshot();
    this.engine.onGenerationChange = (g) => {
      this.audio.setGeneration(g, true);
      // A jump (seek, loop wrap, restart) starts a fresh pass; resuming in place keeps the marks.
      if (Math.abs(this.engine.transport.songTime - this.lastSeenSongTime) > 0.05) this.resolvedNotes.clear();
      this.lastSeenSongTime = this.engine.transport.songTime;
      this.scheduler?.reset(this.engine.transport.songTime);
    };
    this.engine.onGateResolved = (r) => {
      this.lastResult = r;
      this.lastResultAt = this.audio.now;
      const ev = this.engine.eventList[r.eventIndex];
      if (ev) for (const id of ev.noteIds) this.resolvedNotes.set(id, r.kind);
    };
    this.engine.setSelfPlayedFilter((pitch, t) => this.sampler?.playedNear(pitch, t) ?? false);
    this.audio.onFrames = (m) => this.handleFrames(m);
    this.audio.onWorkerError = (msg) => {
      this.notice = `Recognition error: ${msg}`;
      this.notify(true);
    };
    this.audio.onTrackEnded = () => {
      this.mic = { kind: 'error', error: new MicError('busy', 'The microphone stopped (unplugged or taken by another app).', 'Reconnect it and press “Enable microphone”.') };
      this.audio.stopMic();
      this.notify(true);
    };
  }

  // ---------- subscription ----------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(force = false): void {
    const t = performance.now();
    if (!force && t - this.lastNotify < 90) return;
    this.lastNotify = t;
    this.snap = this.engine.snapshot();
    for (const l of this.listeners) l();
  }

  // ---------- lifecycle ----------

  start(): void {
    if (this.timer === null) this.timer = window.setInterval(() => this.loop(), 20);
    void this.loadBundled();
    void this.loadLibraryIndex();
    window.addEventListener('pagehide', this.onLeave);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.onLeave();
    window.removeEventListener('pagehide', this.onLeave);
    document.removeEventListener('visibilitychange', this.onVisibility);
    await this.audio.dispose();
  }

  private onLeave = (): void => {
    this.recordSession();
    if (this.song) savePosition(this.song.id, this.engine.transport.songTime, this.engine.snapshot().loop);
    this.audio.stopMic();
    this.sampler?.stopAll(0.01);
  };

  private onVisibility = (): void => {
    if (document.hidden && (this.snap.state === 'running' || this.snap.state === 'waiting')) {
      this.pause();
      this.notice = 'Paused because the tab was hidden.';
    }
  };

  // ---------- song loading ----------

  async loadBundled(): Promise<void> {
    // Only the most recent load may apply its result (a re-mount or "Try again" can overlap an earlier one).
    const token = ++this.loadToken;
    this.songStatus = { kind: 'loading' };
    this.notify(true);
    const base = import.meta.env.BASE_URL;
    let bytes: ArrayBuffer;
    try {
      const res = await fetch(`${base}${BUNDLED.midi}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = await res.arrayBuffer();
      if (bytes.byteLength < 14) throw new Error('file is empty');
    } catch (e) {
      if (token !== this.loadToken) return;
      this.songStatus = {
        kind: 'missing',
        detail: `public/${BUNDLED.midi} could not be loaded (${e instanceof Error ? e.message : String(e)}). Run “npm run fetch:song” to download it from the Mutopia Project, then reload.`,
      };
      this.notify(true);
      return;
    }
    let sidecar: SongSidecar | undefined;
    try {
      const res = await fetch(`${base}${BUNDLED.sidecar}`);
      if (res.ok) {
        const sc = (await res.json()) as SongSidecar;
        const sha = await sha256Hex(bytes);
        if (sc.sha256 === sha) sidecar = sc;
        else this.notice = 'The bundled MIDI does not match its recorded checksum; staff and hand labels are disabled.';
      } else {
        this.notice = `Song metadata could not be loaded (HTTP ${res.status}); staff and hand labels are disabled.`;
      }
    } catch {
      this.notice = 'Song metadata could not be read; staff and hand labels are disabled.';
    }
    if (token !== this.loadToken) return;
    try {
      const song = sidecar ? parseMidi(bytes, { sidecar }) : parseMidi(bytes, { id: 'clair-de-lune', title: 'Clair de lune', composer: 'Claude Debussy' });
      this.isBundled = true;
      this.currentLibraryId = 'clair-de-lune';
      this.setSong(song, true);
    } catch (e) {
      this.songStatus = { kind: 'error', detail: e instanceof Error ? e.message : String(e) };
      this.notify(true);
    }
  }

  private async loadLibraryIndex(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}songs/library.json`);
      if (res.ok) this.library = (await res.json()) as LibraryEntry[];
    } catch {
      this.library = [];
    }
    this.notify(true);
  }

  /** Loads a library piece. The file must match its recorded SHA-256; tracks are shown as-is (no hand mapping). */
  async loadLibrarySong(id: string): Promise<void> {
    if (id === 'clair-de-lune') {
      this.currentLibraryId = id;
      return this.loadBundled();
    }
    const entry = this.library.find((e) => e.id === id);
    if (!entry) return;
    const token = ++this.loadToken;
    this.pause();
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}songs/${entry.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      if ((await sha256Hex(bytes)) !== entry.sha256) throw new Error('the file does not match its recorded checksum');
      if (token !== this.loadToken) return;
      const song = parseMidi(bytes, { id: entry.id, title: entry.title, composer: entry.composer });
      song.provenance = { source: entry.source, catalogUrl: entry.catalogUrl, fileUrl: entry.fileUrl, license: entry.license, sha256: entry.sha256 };
      this.isBundled = false;
      this.currentLibraryId = id;
      this.setSong(song, false);
      this.notice = null;
    } catch (e) {
      if (token !== this.loadToken) return;
      this.notice = `Could not load “${entry.title}”: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.notify(true);
  }

  async importFile(file: File): Promise<void> {
    this.loadToken++; // an import supersedes any bundled load still in flight
    if (file.size > 8 * 1024 * 1024) {
      this.notice = `“${file.name}” is ${(file.size / 1e6).toFixed(1)} MB — the limit is 8 MB.`;
      this.notify(true);
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const song = parseMidi(bytes, { id: `import:${file.name}:${file.size}`, title: file.name.replace(/\.(mid|midi)$/i, ''), composer: 'Imported MIDI' });
      this.isBundled = false;
      this.currentLibraryId = null;
      this.setSong(song, false);
      this.notice = `Loaded “${file.name}”: ${song.notes.length} notes, ${song.tracks.length} track(s). Hand mapping is not available for imported files; choose tracks instead.`;
    } catch (e) {
      this.notice = e instanceof MidiImportError ? `Could not import “${file.name}”: ${e.message}` : `Could not import “${file.name}”.`;
    }
    this.notify(true);
  }

  private setSong(song: Song, bundled: boolean): void {
    this.recordSession();
    this.song = song;
    this.songStatus = { kind: 'ready' };
    const now = this.audio.now;
    this.engine.load(song, this.partSelection(this.effectivePart), now);
    this.engine.setMode(this.settings.mode, now);
    this.engine.setTempo(this.settings.tempo, now);
    this.scheduler?.setSong(song);
    const progress = loadProgress(song.id);
    if (bundled && !progress) {
      // First visit: a manageable loop over the opening four bars (clearly shown, one click to clear).
      const b5 = song.bars.find((b) => b.number === 5);
      if (b5) this.engine.setLoop({ a: 0, b: b5.time }, now);
    } else if (progress) {
      if (progress.loop && progress.loop.b <= song.duration + 0.01) this.engine.setLoop(progress.loop, now);
      if (progress.position > 0 && progress.position < song.duration - 1) this.engine.seek(progress.position, now);
    }
    this.persist();
    this.notify(true);
  }

  // ---------- parts ----------

  /** The part in use: the saved preference when this piece supports it, otherwise the nearest available one. */
  get effectivePart(): PartChoice {
    const p = this.settings.part;
    if (this.partAvailable(p)) return p;
    return this.song?.handMapping ? 'right' : 'both';
  }

  partAvailable(p: PartChoice): boolean {
    const s = this.song;
    if (!s) return false;
    if (p === 'both') return true;
    if (p === 'right' || p === 'left') return Boolean(s.handMapping);
    if (p === 'upper' || p === 'lower') return s.tracksValidated && s.tracks.length === 2;
    const idx = Number(p.slice(6));
    return Number.isInteger(idx) && idx >= 0 && idx < s.tracks.length && s.tracks[idx]!.noteCount > 0;
  }

  partSelection(p: PartChoice): PartSelection {
    if (p === 'both') return { kind: 'all' };
    if (p === 'right' || p === 'left') return { kind: 'hand', hand: p };
    if (p === 'upper') return { kind: 'tracks', tracks: [0] };
    if (p === 'lower') return { kind: 'tracks', tracks: [1] };
    return { kind: 'tracks', tracks: [Number(p.slice(6))] };
  }

  setPart(p: PartChoice): void {
    if (!this.partAvailable(p)) return;
    this.settings.part = p;
    this.engine.setPart(this.partSelection(p), this.audio.now);
    this.persist();
    this.notify(true);
  }

  // ---------- transport ----------

  private ensureAudio(): void {
    const ctx = this.audio.ensureContext();
    if (!this.sampler) {
      this.sampler = new PianoSampler(ctx);
      this.sampler.volume = this.settings.playbackVolume;
      this.scheduler = new PlaybackScheduler(this.sampler);
      this.scheduler.setSong(this.song);
      this.scheduler.reset(this.engine.transport.songTime);
    }
  }

  private needsPlayback(): boolean {
    return this.settings.mode === 'listen' || this.settings.accompaniment;
  }

  togglePlay(): void {
    const st = this.engine.currentState;
    if (st === 'running' || st === 'waiting') this.pause();
    else this.play();
  }

  play(): void {
    if (!this.song || this.preview.phase !== 'idle') return;
    this.ensureAudio();
    if (this.needsPlayback()) void this.sampler!.load().catch(() => (this.notice = `Piano samples failed to load (${this.sampler?.loadError}). Playback is unavailable.`));
    if (!this.sessionStart) this.sessionStart = { at: new Date().toISOString(), bar: this.currentBar(), totals: this.engine.snapshot().totals };
    this.notice = null;
    this.engine.play(this.audio.now);
    this.scheduler?.reset(this.engine.transport.songTime);
    this.notify(true);
  }

  pause(): void {
    this.engine.pause(this.audio.now);
    this.scheduler?.reset(this.engine.transport.songTime);
    if (this.song) savePosition(this.song.id, this.engine.transport.songTime, this.engine.snapshot().loop);
    this.notify(true);
  }

  restart(): void {
    this.engine.restart(this.audio.now);
    this.notify(true);
  }

  seek(songTime: number): void {
    this.engine.seek(songTime, this.audio.now);
    this.notify(true);
  }

  seekBars(delta: number): void {
    if (!this.song) return;
    const bars = this.song.bars;
    const cur = barAtTick(bars, this.song.notes.length ? this.tickAt(this.engine.transport.songTime) : 0);
    const idx = Math.max(0, Math.min(bars.length - 1, bars.indexOf(cur) + delta));
    this.seek(bars[idx]!.time);
  }

  private tickAt(time: number): number {
    const s = this.song!;
    // Single tempo in most files; general case via the tempo list.
    let p = s.tempos[0]!;
    for (const t of s.tempos) if (t.time <= time) p = t;
    return p.tick + ((time - p.time) * p.bpm * s.ppq) / 60;
  }

  currentBar(): number {
    if (!this.song) return 1;
    return barAtTick(this.song.bars, this.tickAt(this.engine.transport.songTime)).number;
  }

  setTempo(rate: number): void {
    const r = Math.max(0.25, Math.min(1.5, Math.round(rate * 100) / 100));
    this.settings.tempo = r;
    this.engine.setTempo(r, this.audio.now);
    this.scheduler?.reset(this.engine.transport.songTime);
    this.persist();
    this.notify(true);
  }

  setMode(mode: PracticeMode): void {
    this.settings.mode = mode;
    this.engine.setMode(mode, this.audio.now);
    if (mode === 'listen' && this.engine.currentState !== 'idle') {
      this.ensureAudio();
      void this.sampler!.load().catch(() => undefined);
    }
    this.persist();
    this.notify(true);
  }

  setLoopPoint(which: 'a' | 'b'): void {
    if (!this.song) return;
    const t = this.engine.transport.songTime;
    const cur = this.engine.snapshot().loop ?? { a: 0, b: this.song.duration };
    const next = which === 'a' ? { a: t, b: Math.max(cur.b, t + 1) } : { a: Math.min(cur.a, t - 0.5), b: t };
    this.engine.setLoop({ a: Math.max(0, next.a), b: Math.min(this.song.duration, next.b) }, this.audio.now);
    this.savePos();
    this.notify(true);
  }

  setLoopBars(fromBar: number, toBar: number): void {
    if (!this.song) return;
    const a = this.song.bars.find((b) => b.number === fromBar);
    const after = this.song.bars.find((b) => b.number === toBar + 1);
    if (!a) return;
    this.engine.setLoop({ a: a.time, b: after ? after.time : this.song.duration }, this.audio.now);
    this.savePos();
    this.notify(true);
  }

  clearLoop(): void {
    this.engine.setLoop(null, this.audio.now);
    this.savePos();
    this.notify(true);
  }

  /** True when Space / Continue would act: waiting at a gate, or the gate is about to reach the line. */
  canManualAdvance(): boolean {
    const s = this.engine.snapshot();
    if (!s.gate || s.mode === 'listen') return false;
    if (s.state === 'waiting') return true;
    return s.state === 'running' && (s.gate.time - s.songTime) / s.rate <= this.settings.matcher.earlyTolerance;
  }

  manualAdvance(): void {
    if (!this.canManualAdvance()) return;
    this.engine.manualAdvance(this.audio.now);
    this.notify(true);
  }

  // ---------- "Hear this passage" ----------

  async hearPassage(bars = 2): Promise<void> {
    if (!this.song || this.preview.phase !== 'idle') return;
    this.ensureAudio();
    try {
      await this.sampler!.load();
    } catch {
      this.notice = `Piano samples failed to load (${this.sampler?.loadError}).`;
      this.notify(true);
      return;
    }
    const now = this.audio.now;
    const from = this.snap.gate?.time ?? this.engine.transport.songTime;
    const startBar = barAtTick(this.song.bars, this.tickAt(from));
    const endBar = this.song.bars.find((b) => b.number === startBar.number + bars);
    const to = endBar ? endBar.time : this.song.duration;
    this.engine.beginPreview(now);
    this.scheduler?.reset(from);
    const rate = this.engine.transport.rate;
    const t0 = now + 0.15;
    for (const n of this.song.notes) {
      if (n.time < from - 1e-6 || n.time >= to) continue;
      this.sampler!.play(n.pitch, t0 + (n.time - from) / rate, Math.min(n.duration, to - n.time + 0.5) / rate, n.velocity);
    }
    this.preview = { phase: 'playing', until: Math.max(t0 + (to - from) / rate, this.sampler!.busyUntil) };
    this.notify(true);
  }

  stopPreview(): void {
    if (this.preview.phase === 'idle') return;
    this.sampler?.stopAll(0.05);
    this.preview = { phase: 'ringdown', until: this.audio.now + 0.4 };
    this.notify(true);
  }

  /** Conservative ring-down: playback over, then the room must be near its noise level for 0.4 s (max 6 s). */
  private previewStep(now: number): void {
    if (this.preview.phase === 'playing') {
      if (now >= this.preview.until) {
        this.sampler?.stopAll(0.05);
        this.preview = { phase: 'ringdown', until: now + 6 };
        this.quietSince = null;
      }
      return;
    }
    if (this.preview.phase === 'ringdown') {
      const floor = this.settings.noiseRmsDb ?? this.minRecentRms();
      const quiet = !this.audio.listening || this.levels.rmsDb <= floor + 6;
      if (quiet) this.quietSince ??= now;
      else this.quietSince = null;
      if ((this.quietSince !== null && now - this.quietSince >= 0.4) || now >= this.preview.until) {
        this.preview = { phase: 'idle', until: 0 };
        this.engine.endPreview(now);
        this.notify(true);
      }
    }
  }

  private minRecentRms(): number {
    return this.peakHistory.reduce((m, p) => Math.min(m, p.rms), 0);
  }

  // ---------- microphone ----------

  async enableMic(deviceId?: string | null): Promise<InputInfo | null> {
    this.mic = { kind: 'starting' };
    this.notify(true);
    try {
      this.ensureAudio();
      const info = await this.audio.startMic(deviceId ?? this.settings.deviceId ?? undefined);
      this.capabilities = this.audio.capabilities;
      this.audio.setGeneration(this.engine.currentGeneration, true);
      this.audio.configure({ tuningCents: this.settings.tuningCents, sensitivity: this.settings.sensitivity }, this.settings.noiseProfile);
      this.mic = { kind: 'on' };
      if (deviceId !== undefined && deviceId !== null) this.settings.deviceId = deviceId;
      this.persist();
      this.notify(true);
      return info;
    } catch (e) {
      // A saved device that disappeared: fall back to the default once.
      if (e instanceof MicError && e.kind === 'constraints' && this.settings.deviceId) {
        this.settings.deviceId = null;
        return this.enableMic(null);
      }
      this.mic = { kind: 'error', error: e instanceof MicError ? e : new MicError('unknown', String(e), 'Try again.') };
      this.notify(true);
      return null;
    }
  }

  disableMic(): void {
    this.audio.stopMic();
    this.mic = { kind: 'off' };
    this.sounding = [];
    this.notify(true);
  }

  private handleFrames(m: FrameMessage): void {
    const now = this.audio.now;
    const evidence: Evidence[] = [];
    for (const f of m.frames) {
      this.absorbFrame(f, now);
      for (const o of f.onsets) {
        const e: Evidence = { id: o.id, pitch: o.pitch, time: o.time, confidence: o.confidence, generation: m.generation };
        if (o.harmonicOf !== undefined) e.harmonicOf = o.harmonicOf;
        evidence.push(e);
        if (!this.seenOnsets.has(o.id)) {
          this.seenOnsets.add(o.id);
          pushBounded(this.latency.decision, now - o.time, 200);
        }
        const existing = this.recentOnsets.findIndex((r) => r.id === o.id);
        if (existing >= 0) this.recentOnsets[existing] = { ...o, receivedAt: now };
        else this.recentOnsets.push({ ...o, receivedAt: now });
      }
      for (const r of f.rejections) this.recentRejections.push({ ...r, time: f.time });
    }
    if (this.seenOnsets.size > 2000) this.seenOnsets = new Set([...this.seenOnsets].slice(-500));
    this.recentOnsets = this.recentOnsets.filter((o) => now - o.receivedAt < 8).slice(-40);
    this.recentRejections = this.recentRejections.filter((r) => now - r.time < 3).slice(-60);
    const last = m.frames[m.frames.length - 1];
    if (last) pushBounded(this.latency.pipeline, now - last.time, 200);
    pushBounded(this.latency.processMsPerFrame, m.processMs / Math.max(1, m.frames.length), 200);
    this.latency.queueSeconds = m.queueSeconds;
    this.latency.droppedChunks += m.dropped;
    if (evidence.length && this.preview.phase === 'idle') this.engine.addEvidence(evidence, now);
    this.notify();
  }

  private absorbFrame(f: DetectorFrame, now: number): void {
    this.sounding = f.sounding;
    this.soundingAt = now;
    this.peakHistory.push({ t: now, peak: f.peak, rms: f.rmsDb });
    while (this.peakHistory.length && this.peakHistory[0]!.t < now - 3) this.peakHistory.shift();
    const clipped = this.peakHistory.some((p) => p.peak >= 0.99);
    const loudest = this.peakHistory.reduce((m, p) => Math.max(m, p.rms), -200);
    this.levels = {
      rmsDb: f.rmsDb,
      peak: f.peak,
      clippedRecently: clipped,
      tooQuiet: this.peakHistory.length > 50 && loudest < -70,
      noiseDb: f.noiseDb,
      residual: f.residual,
    };
  }

  // ---------- setup helpers ----------

  async measureRoomNoise(seconds = 2.5): Promise<{ rmsDb: number; ok: boolean }> {
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const res = await this.audio.captureNoise();
    this.settings.noiseProfile = res.profile;
    this.settings.noiseRmsDb = res.rmsDb;
    this.audio.configure({}, res.profile);
    this.persist();
    return { rmsDb: res.rmsDb, ok: res.profile !== null };
  }

  measureNote(pitch: number, seconds = 2.5) {
    return this.audio.measureNote(pitch, seconds);
  }

  applyDetectorSettings(p: { tuningCents?: number; sensitivity?: number }): void {
    if (p.tuningCents !== undefined) this.settings.tuningCents = Math.max(-60, Math.min(60, p.tuningCents));
    if (p.sensitivity !== undefined) this.settings.sensitivity = Math.max(0.5, Math.min(2, p.sensitivity));
    this.audio.configure({ tuningCents: this.settings.tuningCents, sensitivity: this.settings.sensitivity });
    this.persist();
    this.notify(true);
  }

  dismissNotice(): void {
    this.notice = null;
    this.notify(true);
  }

  setNotice(message: string): void {
    this.notice = message;
    this.notify(true);
  }

  updateSettings(patch: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...patch };
    if ('noiseProfile' in patch) this.audio.configure({}, patch.noiseProfile ?? null);
    if (patch.matcher) this.engine.setMatcherSettings(this.settings.matcher);
    if (patch.playbackVolume !== undefined && this.sampler) this.sampler.volume = patch.playbackVolume;
    if (patch.accompaniment !== undefined) {
      this.scheduler?.reset(this.engine.transport.songTime);
      if (patch.accompaniment) {
        this.ensureAudio();
        void this.sampler!.load().catch(() => undefined);
      }
    }
    this.persist();
    this.notify(true);
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.engine.setMatcherSettings(this.settings.matcher);
    this.applyDetectorSettings({ tuningCents: 0, sensitivity: 1 });
    this.audio.configure({}, null);
    this.persist();
  }

  private savePos(): void {
    if (this.song) savePosition(this.song.id, this.engine.transport.songTime, this.engine.snapshot().loop);
  }

  private persist(): void {
    saveSettings(this.settings);
  }

  private recordSession(): void {
    if (!this.song || !this.sessionStart) return;
    const t = this.engine.snapshot().totals;
    const s0 = this.sessionStart.totals;
    addSession(this.song.id, {
      startedAt: this.sessionStart.at,
      endedAt: new Date().toISOString(),
      mode: this.settings.mode,
      part: this.effectivePart,
      tempo: this.settings.tempo,
      fromBar: this.sessionStart.bar,
      toBar: this.currentBar(),
      recognized: t.recognized - s0.recognized,
      withUncertainParts: t.withUncertainParts - s0.withUncertainParts,
      manual: t.manual - s0.manual,
    });
    this.sessionStart = null;
  }

  // ---------- clock loop ----------

  private loop(): void {
    const now = this.audio.now;
    if (this.preview.phase !== 'idle') this.previewStep(now);
    this.engine.tick(now);
    this.lastSeenSongTime = this.engine.transport.songTime;
    const snap = this.engine.snapshot();
    if (this.scheduler) {
      const which = snap.state === 'previewing' ? 'none' : this.settings.mode === 'listen' ? 'all' : this.settings.accompaniment ? 'others' : 'none';
      this.scheduler.pump({
        now,
        songTime: snap.songTime,
        rate: snap.rate,
        moving: snap.state === 'running',
        gateTime: snap.gate?.time ?? null,
        loopEnd: snap.loop?.b ?? null,
        which,
        part: this.partSelection(this.effectivePart),
      });
    }
    if (snap.state === 'completed' && this.snap.state !== 'completed') {
      this.recordSession();
      this.scheduler?.reset(snap.songTime);
    }
    this.notify(snap.state !== this.snap.state || snap.gateIndex !== this.snap.gateIndex);
  }

  keyAccidentalsAt(tick: number): number {
    let acc = 0;
    for (const k of this.song?.keys ?? []) if (k.tick <= tick) acc = k.accidentals;
    return acc;
  }

  /** Status line shown to the player, combining engine and microphone state. */
  statusText(): string {
    const s = this.snap;
    const learning = s.mode === 'learn' || s.mode === 'single';
    if (this.preview.phase === 'playing') return 'Playing the passage — matching paused';
    if (this.preview.phase === 'ringdown') return 'Waiting for the sound to fade before listening again…';
    if (this.audio.contextState === 'suspended' && (s.state === 'running' || s.state === 'waiting')) return 'Audio paused by the browser — click anywhere to resume';
    if (learning && s.state === 'waiting') {
      if (this.mic.kind !== 'on') return `${s.status} — microphone is off (press M, or use Space to continue manually)`;
      if (this.levels.tooQuiet) return `Microphone too quiet — ${s.status.toLowerCase()}`;
      if (this.levels.clippedRecently) return `Input clipping — move the laptop back a little. ${s.status}`;
    }
    if (learning && s.state === 'ready' && this.mic.kind !== 'on') return 'Ready — enable the microphone, then press Start';
    if (learning && this.mic.kind === 'on' && s.state === 'running') return `Listening · ${s.status}`;
    return s.status;
  }
}

function pushBounded(arr: number[], v: number, max: number): void {
  arr.push(v);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
}
