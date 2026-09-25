import { describe, expect, test } from 'vitest';
import { estimateTuning, measureNote } from '../../audio/detector/calibration';
import { PolyphonicDetector } from '../../audio/detector/polyphonic';
import { FFT, hannWindow } from '../../audio/dsp/fft';
import { Resampler } from '../../audio/dsp/resampler';
import { midiToHz } from '../../music/spelling';
import { noise, primed, runDetector, type Clip } from '../detector/audio-utils';

const sine = (rate: number, hz: number, seconds: number, amp = 0.5) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

/** Decaying additive tone with slightly stretched partials, a crude stand-in for a piano string. */
function synthNote(rate: number, midi: number, seconds: number, cents = 0, amp = 0.25): Float32Array {
  const f0 = midiToHz(midi) * Math.pow(2, cents / 1200);
  const out = new Float32Array(Math.round(rate * seconds));
  for (let k = 1; k <= 10; k++) {
    const fk = f0 * k * Math.sqrt(1 + 0.0004 * k * k);
    if (fk > rate / 2 - 500) break;
    const a = amp / k;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + a * Math.exp((-i / rate) * (1.5 + k * 0.4)) * Math.sin((2 * Math.PI * fk * i) / rate);
  }
  return out;
}

describe('FFT', () => {
  test('rejects non-power-of-two sizes', () => {
    expect(() => new FFT(1000)).toThrow();
  });

  test('a bin-centred sinusoid reads its amplitude', () => {
    const n = 2048;
    const fft = new FFT(n);
    const out = new Float64Array(n / 2 + 1);
    const bin = 100;
    const x = Float64Array.from({ length: n }, (_, i) => 0.7 * Math.sin((2 * Math.PI * bin * i) / n));
    fft.magnitude(x, 0, hannWindow(n), out);
    expect(out[bin]!).toBeCloseTo(0.7, 2);
    let maxOther = 0;
    for (let i = 0; i < out.length; i++) if (Math.abs(i - bin) > 2) maxOther = Math.max(maxOther, out[i]!);
    expect(maxOther).toBeLessThan(0.001);
  });
});

describe('Resampler', () => {
  test('48 kHz → 22.05 kHz keeps frequency and amplitude', () => {
    const rs = new Resampler(48000, 22050);
    const y = rs.process(sine(48000, 1000, 1));
    expect(Math.abs(y.length - 22050)).toBeLessThanOrEqual(32);
    const mid = y.subarray(2000, 20000);
    let crossings = 0;
    let peak = 0;
    for (let i = 1; i < mid.length; i++) {
      if (mid[i - 1]! < 0 && mid[i]! >= 0) crossings++;
      peak = Math.max(peak, Math.abs(mid[i]!));
    }
    expect(crossings / (mid.length / 22050)).toBeCloseTo(1000, -1);
    expect(peak).toBeGreaterThan(0.49);
    expect(peak).toBeLessThan(0.51);
  });

  test('content above the new Nyquist is removed, not aliased', () => {
    const y = new Resampler(48000, 22050).process(sine(48000, 15000, 0.5));
    let peak = 0;
    for (let i = 500; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]!));
    expect(peak).toBeLessThan(0.01);
  });

  test('streaming in small chunks equals one pass', () => {
    const x = sine(44100, 440, 0.5);
    const whole = new Resampler(44100, 22050).process(x);
    const rs = new Resampler(44100, 22050);
    const parts: number[] = [];
    for (let i = 0; i < x.length; i += 128) parts.push(...rs.process(x.subarray(i, i + 128)));
    expect(parts.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(Math.abs(parts[i]! - whole[i]!)).toBeLessThan(1e-5);
  });

  test('timing: an impulse at input time t appears at output time t', () => {
    for (const rate of [44100, 48000]) {
      const x = new Float32Array(rate);
      const n = Math.round(0.3 * rate);
      x[n] = 1;
      const y = new Resampler(rate, 22050).process(x);
      let best = 0;
      for (let i = 1; i < y.length; i++) if (Math.abs(y[i]!) > Math.abs(y[best]!)) best = i;
      expect(Math.abs(best / 22050 - n / rate)).toBeLessThan(1.5 / 22050);
    }
  });
});

describe('detector on synthetic signals', () => {
  const clip = (data: Float32Array): Clip => ({ rate: 44100, data });

  test('near-silence (microphone self-noise): no onsets at all', () => {
    const r = runDetector(new PolyphonicDetector(), noise(44100, 4, -90, true, 11));
    expect(r.onsets).toHaveLength(0);
  });

  test('steady room noise: nothing confident enough to accept', () => {
    const r = runDetector(new PolyphonicDetector(), noise(44100, 4, -60, true, 11));
    expect(r.onsets.filter((o) => o.confidence >= 0.55)).toHaveLength(0);
  });

  test('a synthetic A4 tone is reported as A4 near its attack', () => {
    const r = runDetector(new PolyphonicDetector(), primed(clip(synthNote(44100, 69, 1.5))));
    const hit = r.onsets.find((o) => o.pitch === 69 && o.confidence >= 0.55);
    expect(hit).toBeDefined();
    expect(Math.abs(hit!.time - 0.5)).toBeLessThan(0.08);
  });

  test('timestamps follow the audio clock offset', () => {
    const r = runDetector(new PolyphonicDetector(), primed(clip(synthNote(44100, 64, 1.2))), 100);
    const hit = r.onsets.find((o) => o.pitch === 64);
    expect(hit).toBeDefined();
    expect(Math.abs(hit!.time - 100.5)).toBeLessThan(0.08);
  });

  test('tuning measurement recovers a detuned tone', () => {
    const ms = [57, 64, 69, 76].map((p) => measureNote(new Resampler(44100, 22050).process(synthNote(44100, p, 1, 18)), 22050, p)!);
    const t = estimateTuning(ms);
    expect(t).not.toBeNull();
    expect(Math.abs(t! - 18)).toBeLessThan(4);
  });
});
