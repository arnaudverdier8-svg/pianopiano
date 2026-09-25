import { isSelected } from '../music/events';
import type { PartSelection, Song, SongNote } from '../music/types';
import type { PianoSampler } from './sampler';

export interface PumpInput {
  now: number;
  songTime: number;
  rate: number;
  /** Cursor moving (not paused, not frozen at a gate). */
  moving: boolean;
  /** Song time of the unresolved gate: nothing at or after it may be scheduled. */
  gateTime: number | null;
  loopEnd: number | null;
  /** Which notes to play: 'all' (Listen), 'others' (accompaniment), or 'none'. */
  which: 'all' | 'others' | 'none';
  part: PartSelection;
}

/**
 * Look-ahead scheduler that shares the practice transport: it converts song time to audio time using the
 * current cursor and rate, and never schedules a note at or beyond an unresolved gate — so accompaniment
 * cannot run ahead of the player and there is no second clock to drift.
 */
export class PlaybackScheduler {
  private scheduledUntil = 0;
  private cursor = 0; // index into song.notes
  private song: Song | null = null;
  lookahead = 0.25; // real seconds

  constructor(private readonly sampler: PianoSampler) {}

  setSong(song: Song | null): void {
    this.song = song;
    this.reset(0);
  }

  /** After seek/loop/pause/mode change: silence and restart scheduling from songTime. */
  reset(songTime: number): void {
    this.sampler.stopAll();
    this.scheduledUntil = songTime;
    this.cursor = this.song ? this.firstAtOrAfter(songTime) : 0;
  }

  private firstAtOrAfter(t: number): number {
    const notes = this.song!.notes;
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid]!.time < t - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  pump(p: PumpInput): void {
    const song = this.song;
    if (!song || !p.moving || p.which === 'none') {
      if (song) this.scheduledUntil = Math.max(this.scheduledUntil, p.songTime);
      return;
    }
    let horizon = p.songTime + this.lookahead * p.rate;
    if (p.gateTime !== null) horizon = Math.min(horizon, p.gateTime - 1e-6);
    if (p.loopEnd !== null) horizon = Math.min(horizon, p.loopEnd);
    if (horizon <= this.scheduledUntil) return;
    const notes = song.notes;
    // Skip notes that are already in the past (e.g. after the tab was hidden).
    while (this.cursor < notes.length && notes[this.cursor]!.time < Math.max(this.scheduledUntil, p.songTime - 0.05)) this.cursor++;
    while (this.cursor < notes.length && notes[this.cursor]!.time < horizon) {
      const n: SongNote = notes[this.cursor]!;
      this.cursor++;
      if (p.which === 'others' && isSelected(n, p.part)) continue;
      const when = p.now + (n.time - p.songTime) / p.rate;
      this.sampler.play(n.pitch, when, n.duration / p.rate, n.velocity);
    }
    this.scheduledUntil = horizon;
  }
}
