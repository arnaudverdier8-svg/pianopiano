/**
 * Minimal sampled piano on the app's AudioContext: Salamander Grand Piano samples (CC-BY 3.0, bundled in
 * public/samples/salamander) recorded every minor third, pitch-shifted to the nearest note.
 */
const SAMPLE_NAMES: [string, number][] = (() => {
  const out: [string, number][] = [['A0', 21]];
  const pcs: [string, number][] = [['C', 0], ['Ds', 3], ['Fs', 6], ['A', 9]];
  for (let o = 1; o <= 7; o++) for (const [n, pc] of pcs) out.push([`${n}${o}`, 12 * (o + 1) + pc]);
  out.push(['C8', 108]);
  return out;
})();

interface Voice {
  pitch: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
  end: number;
}

export class PianoSampler {
  private buffers = new Map<number, AudioBuffer>();
  private voices: Voice[] = [];
  private out: GainNode;
  private loading: Promise<void> | null = null;
  /** Recent notes the app itself started (pitch, audio start time) — used to reject self-hearing. */
  readonly played: { pitch: number; time: number }[] = [];
  loaded = false;
  loadError: string | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly baseUrl = `${import.meta.env.BASE_URL}samples/salamander/`,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(ctx.destination);
  }

  load(): Promise<void> {
    if (!this.loading) {
      this.loading = Promise.all(
        SAMPLE_NAMES.map(async ([name, midi]) => {
          const res = await fetch(`${this.baseUrl}${name}.mp3`);
          if (!res.ok) throw new Error(`${name}.mp3: HTTP ${res.status}`);
          this.buffers.set(midi, await this.ctx.decodeAudioData(await res.arrayBuffer()));
        }),
      ).then(
        () => {
          this.loaded = true;
        },
        (e: unknown) => {
          this.loadError = e instanceof Error ? e.message : String(e);
          this.loading = null;
          throw e;
        },
      );
    }
    return this.loading;
  }

  set volume(v: number) {
    this.out.gain.value = v;
  }

  /** Schedules a note at audio time `when` for `duration` seconds. */
  play(pitch: number, when: number, duration: number, velocity = 0.7): void {
    if (!this.loaded) return;
    let best = SAMPLE_NAMES[0]![1];
    for (const [, m] of SAMPLE_NAMES) if (Math.abs(m - pitch) < Math.abs(best - pitch)) best = m;
    const buffer = this.buffers.get(best);
    if (!buffer) return;
    const t = Math.max(when, this.ctx.currentTime);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.pow(2, (pitch - best) / 12);
    const gain = this.ctx.createGain();
    const level = 0.15 + 0.85 * velocity * velocity;
    const release = 0.35;
    const end = t + Math.max(0.08, duration);
    gain.gain.setValueAtTime(level, t);
    gain.gain.setValueAtTime(level, end);
    gain.gain.exponentialRampToValueAtTime(0.0005, end + release);
    src.connect(gain).connect(this.out);
    src.start(t);
    src.stop(end + release + 0.05);
    const voice: Voice = { pitch, src, gain, start: t, end: end + release };
    src.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      gain.disconnect();
    };
    this.voices.push(voice);
    this.played.push({ pitch, time: t });
    if (this.played.length > 400) this.played.splice(0, this.played.length - 400);
    // Bound polyphony: steal the oldest voices.
    while (this.voices.length > 64) this.fade(this.voices.shift()!, 0.03);
  }

  private fade(v: Voice, seconds: number): void {
    const now = this.ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + seconds);
      v.src.stop(now + seconds + 0.01);
    } catch {
      /* already stopped */
    }
  }

  /** Silences everything, including notes scheduled in the future (no stuck notes after seek/pause). */
  stopAll(fadeSeconds = 0.05): void {
    for (const v of this.voices) this.fade(v, fadeSeconds);
    this.voices = [];
  }

  /** Audio time at which the last scheduled note finishes ringing (for the ring-down check). */
  get busyUntil(): number {
    return this.voices.reduce((m, v) => Math.max(m, v.end), 0);
  }

  /** Did the app itself start this pitch (or a note whose partial it is) near audio time t? */
  playedNear(pitch: number, t: number, window = 0.25): boolean {
    for (let i = this.played.length - 1; i >= 0; i--) {
      const p = this.played[i]!;
      if (p.time < t - 2) break;
      const d = pitch - p.pitch;
      if (Math.abs(p.time - t) <= window && (d === 0 || d === 12 || d === 19 || d === 24)) return true;
    }
    return false;
  }
}
