import type { Bar, MeterPoint } from './types';
import type { TempoMap } from './tempo';

/**
 * Derives bar lines from the meter map. Each time-signature event starts a new bar.
 * `anacrusisTicks` (from a sidecar) declares a pickup: the first bar is that short and is numbered 0.
 */
export function buildBars(
  meters: MeterPoint[],
  ppq: number,
  endTick: number,
  tempo: TempoMap,
  anacrusisTicks = 0,
): Bar[] {
  const points = meters.length > 0 ? [...meters].sort((a, b) => a.tick - b.tick) : [];
  if (points.length === 0 || points[0]!.tick > 0) points.unshift({ tick: 0, numerator: 4, denominator: 4 });
  const bars: Bar[] = [];
  let number = anacrusisTicks > 0 ? 0 : 1;
  let tick = 0;
  if (anacrusisTicks > 0) {
    const m = points[0]!;
    bars.push({ number: 0, tick: 0, time: 0, numerator: m.numerator, denominator: m.denominator, lengthTicks: anacrusisTicks });
    tick = anacrusisTicks;
    number = 1;
  }
  for (let i = 0; i < points.length; i++) {
    const m = points[i]!;
    const next = points[i + 1]?.tick ?? Number.POSITIVE_INFINITY;
    const barLen = Math.round((ppq * 4 * m.numerator) / m.denominator);
    if (barLen <= 0) continue;
    if (tick < m.tick) tick = m.tick;
    while (tick < next && tick < endTick) {
      const lengthTicks = Math.min(barLen, next - tick);
      bars.push({ number, tick, time: tempo.tickToSeconds(tick), numerator: m.numerator, denominator: m.denominator, lengthTicks });
      number++;
      tick += lengthTicks;
    }
  }
  if (bars.length === 0) bars.push({ number: 1, tick: 0, time: 0, numerator: 4, denominator: 4, lengthTicks: ppq * 4 });
  return bars;
}

/** Bar containing the tick (binary search). */
export function barAtTick(bars: Bar[], tick: number): Bar {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid]!.tick <= tick) lo = mid;
    else hi = mid - 1;
  }
  return bars[lo]!;
}
