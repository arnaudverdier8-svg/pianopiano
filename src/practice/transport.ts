/**
 * Musical cursor driven by the audio clock. Song time is in score seconds at 100% tempo.
 * The cursor only moves inside `advance()`, never catches up after a freeze, and keeps a short
 * history so evidence can be mapped by its audio timestamp to where the cursor was at that moment.
 */
interface Segment {
  audio: number;
  song: number;
  rate: number;
  moving: boolean;
}

export class Transport {
  songTime = 0;
  rate = 1;
  /** Playing (moving or frozen at a gate) vs. paused by the user. */
  playing = false;
  /** True while held at an unresolved gate. */
  frozen = false;
  private lastNow: number | null = null;
  private history: Segment[] = [{ audio: -Infinity, song: 0, rate: 1, moving: false }];

  private mark(audio: number): void {
    const moving = this.playing && !this.frozen;
    const seg: Segment = { audio, song: this.songTime, rate: this.rate, moving };
    const last = this.history[this.history.length - 1]!;
    if (last.audio === audio) this.history[this.history.length - 1] = seg;
    else this.history.push(seg);
    // Keep ~60 s of history.
    while (this.history.length > 2 && this.history[1]!.audio < audio - 60) this.history.shift();
  }

  play(now: number): void {
    if (this.playing) return;
    this.playing = true;
    this.frozen = false;
    this.lastNow = now;
    this.mark(now);
  }

  pause(now: number): void {
    if (!this.playing) return;
    this.sync(now);
    this.playing = false;
    this.frozen = false;
    this.lastNow = null;
    this.mark(now);
  }

  seek(songTime: number, now: number): void {
    this.songTime = Math.max(0, songTime);
    this.frozen = false;
    this.lastNow = this.playing ? now : null;
    this.mark(now);
  }

  setRate(rate: number, now: number): void {
    this.sync(now);
    this.rate = rate;
    this.mark(now);
  }

  /** Brings songTime up to `now` without a gate (used before changing rate or pausing). */
  private sync(now: number): void {
    if (this.playing && !this.frozen && this.lastNow !== null) this.songTime += Math.max(0, now - this.lastNow) * this.rate;
    if (this.playing) this.lastNow = now;
  }

  /**
   * Moves the cursor to `now`, stopping exactly at `gateTime` (if given and not yet reached).
   * Returns true when the cursor is frozen at the gate.
   */
  advance(now: number, gateTime: number | null): boolean {
    if (!this.playing || this.lastNow === null) return false;
    if (this.frozen) {
      this.lastNow = now;
      return true;
    }
    const dt = Math.max(0, now - this.lastNow);
    const target = this.songTime + dt * this.rate;
    if (gateTime !== null && target >= gateTime - 1e-9 && this.songTime <= gateTime + 1e-9) {
      // Exact audio time at which the cursor met the gate, for evidence mapping.
      const tGate = this.lastNow + (gateTime - this.songTime) / this.rate;
      this.songTime = gateTime;
      this.frozen = true;
      this.mark(Math.min(now, Math.max(this.lastNow, tGate)));
      this.lastNow = now;
      return true;
    }
    this.songTime = target;
    this.lastNow = now;
    return false;
  }

  /** Where the cursor would be at `now` (smooth drawing between engine ticks). Never passes the gate. */
  peek(now: number, gateTime: number | null): number {
    if (!this.playing || this.frozen || this.lastNow === null) return this.songTime;
    const t = this.songTime + Math.max(0, now - this.lastNow) * this.rate;
    return gateTime !== null && this.songTime <= gateTime + 1e-9 ? Math.min(t, gateTime) : t;
  }

  /** Releases a gate freeze: continues from the gate position at `now` (no catch-up). */
  release(now: number): void {
    if (!this.frozen) return;
    this.frozen = false;
    this.lastNow = now;
    this.mark(now);
  }

  /** Where the cursor was (song seconds) at audio time t, and the tempo rate then. */
  at(t: number): { song: number; rate: number } {
    let seg = this.history[0]!;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.audio <= t) {
        seg = this.history[i]!;
        break;
      }
    }
    if (!Number.isFinite(seg.audio)) return { song: seg.song, rate: this.rate };
    const song = seg.moving ? seg.song + Math.max(0, t - seg.audio) * seg.rate : seg.song;
    return { song, rate: seg.rate };
  }

  /** Forget history before a seek boundary so old timestamps cannot map into the new position. */
  resetHistory(now: number): void {
    this.history = [{ audio: -Infinity, song: this.songTime, rate: this.rate, moving: false }];
    this.mark(now);
  }
}
