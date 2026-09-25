import type { TempoPoint } from './types';

/** Piecewise-constant tempo map. Converts between ticks and seconds (100% tempo). */
export class TempoMap {
  readonly points: TempoPoint[];

  constructor(
    readonly ppq: number,
    raw: { tick: number; bpm: number }[],
  ) {
    const sorted = [...raw].filter((p) => p.bpm > 0 && Number.isFinite(p.bpm)).sort((a, b) => a.tick - b.tick);
    // MIDI default is 120 qpm until the first tempo event.
    if (sorted.length === 0 || sorted[0]!.tick > 0) sorted.unshift({ tick: 0, bpm: 120 });
    const points: TempoPoint[] = [];
    let time = 0;
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i]!;
      const prev = points[points.length - 1];
      if (prev) time = prev.time + ((p.tick - prev.tick) / ppq) * (60 / prev.bpm);
      // A later event at the same tick replaces the earlier one.
      if (prev && prev.tick === p.tick) points[points.length - 1] = { tick: p.tick, time: prev.time, bpm: p.bpm };
      else points.push({ tick: p.tick, time, bpm: p.bpm });
    }
    this.points = points;
  }

  private indexAtTick(tick: number): number {
    let lo = 0;
    let hi = this.points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.points[mid]!.tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private indexAtTime(time: number): number {
    let lo = 0;
    let hi = this.points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.points[mid]!.time <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  tickToSeconds(tick: number): number {
    const p = this.points[this.indexAtTick(tick)]!;
    return p.time + ((tick - p.tick) / this.ppq) * (60 / p.bpm);
  }

  secondsToTick(seconds: number): number {
    const p = this.points[this.indexAtTime(seconds)]!;
    return p.tick + ((seconds - p.time) * p.bpm * this.ppq) / 60;
  }

  bpmAtTick(tick: number): number {
    return this.points[this.indexAtTick(tick)]!.bpm;
  }
}
