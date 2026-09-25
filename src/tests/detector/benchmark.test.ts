/**
 * Recognition benchmark through the real path: recorded piano (University of Iowa Steinway, independent of
 * the Salamander recordings the detector's templates were learned from) → 128-sample quanta at 44.1 kHz →
 * explicit resampling → PolyphonicDetector → the app's GateMatcher with default settings.
 *
 * The question asked for every case is the one the app asks: "would this gate advance, and when?"
 * Floors are set a little below the measured values so regressions fail loudly; the full numbers are
 * written to docs/benchmark-results.{json,md}.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { PolyphonicDetector } from '../../audio/detector/polyphonic';
import { noteName } from '../../music/spelling';
import { GateMatcher } from '../../practice/matcher';
import { DEFAULT_MATCHER, type MatcherSettings } from '../../practice/types';
import { add, mix, noise, primed, runDetector, uiowa, UIOWA_ONSET, type Clip } from './audio-utils';

const HAVE_FIXTURES = uiowa(60) !== null;
const RATE = 44100;
const DECISION_WINDOW = 1.0; // seconds after the attack in which the gate must advance

interface GateOutcome {
  satisfied: boolean;
  latency: number | null;
  kind: 'recognized' | 'uncertain-parts' | 'no';
  confidentExtras: number;
}

/** Runs a clip and asks, frame by frame, whether a gate with `pitches` (the cursor waiting at it) would be satisfied. */
function gate(clip: Clip, pitches: number[], attackAt: number, settings: Partial<MatcherSettings> = {}): GateOutcome {
  const run = runDetector(new PolyphonicDetector(), clip);
  const m = new GateMatcher({ ...DEFAULT_MATCHER, ...settings });
  const ev = { index: 0, tick: 0, time: 10, pitches: [...pitches].sort((a, b) => a - b), noteIds: [], bar: 1 };
  const ctx = (now: number) => ({ now, cursorAt: () => ({ song: 10, rate: 1 }), notBefore: 0 });
  for (const f of run.frames) {
    if (f.time > attackAt + DECISION_WINDOW) break;
    for (const o of f.onsets) {
      const e = { id: o.id, pitch: o.pitch, time: o.time, confidence: o.confidence, generation: 0 };
      m.add(o.harmonicOf !== undefined ? { ...e, harmonicOf: o.harmonicOf } : e);
    }
    const r = m.evaluate(ev, ctx(f.time));
    if (r.satisfied) {
      return {
        satisfied: true,
        latency: f.time - attackAt,
        kind: r.tones.every((t) => t.status === 'heard') ? 'recognized' : 'uncertain-parts',
        confidentExtras: r.extraNotes.length,
      };
    }
  }
  const extras = run.onsets.filter((o) => !pitches.includes(o.pitch) && o.confidence >= DEFAULT_MATCHER.acceptConfidence && o.harmonicOf === undefined).length;
  return { satisfied: false, latency: null, kind: 'no', confidentExtras: extras };
}

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A chord from recorded single notes with a small natural spread (≤ 20 ms) and varied balance. */
function chord(pitches: number[], seed: number, seconds = 2): Clip {
  const rnd = seeded(seed);
  return primed(mix(RATE, seconds, pitches.map((p) => ({ clip: uiowa(p)!, at: rnd() * 0.02, gain: 0.7 + 0.3 * rnd() }))));
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!;
};

const CHORDS: number[][] = [
  [65, 68], [77, 80], [73, 77], [72, 75], [61, 65, 68], [58, 61, 65], [66, 70, 73], [56, 60, 63, 68],
  [61, 73], [49, 61], [68, 80], [37, 56], [37, 49], [48, 52, 55], [60, 64, 67, 72], [41, 53, 60, 65],
  [70, 73, 77], [44, 56, 63], [54, 61, 66, 70], [63, 70, 75], [49, 56, 65], [39, 58, 63], [75, 78, 82], [80, 84, 87],
];

const report: Record<string, unknown> = {};

describe.skipIf(!HAVE_FIXTURES)('recognition benchmark (recorded piano → detector → matcher)', () => {
  afterAll(() => {
    report.generatedAt = new Date().toISOString();
    report.detector = new PolyphonicDetector().capabilities.id;
    report.matcher = DEFAULT_MATCHER;
    report.source = 'University of Iowa Musical Instrument Samples, Steinway B (mf and pp), mono 44.1 kHz. Independent of the Salamander samples used to learn the detector templates.';
    const dir = join(process.cwd(), 'docs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'benchmark-results.json'), JSON.stringify(report, null, 2) + '\n');
    writeFileSync(join(dir, 'benchmark-results.md'), toMarkdown(report));
  });

  test('single notes advance their gate', () => {
    const rows: { note: string; dyn: string; ok: boolean; latency: number | null; extras: number }[] = [];
    for (const dyn of ['mf', 'pp'] as const) {
      for (let p = 21; p <= 108; p++) {
        const c = uiowa(p, dyn);
        if (!c) continue;
        const r = gate(primed(c), [p], UIOWA_ONSET);
        rows.push({ note: noteName(p), dyn, ok: r.satisfied, latency: r.latency, extras: r.confidentExtras });
      }
    }
    const hits = rows.filter((r) => r.ok);
    const lat = hits.map((r) => r.latency!);
    report.singleNotes = {
      cases: rows.length,
      advanced: hits.length,
      rate: hits.length / rows.length,
      latencyMedianMs: Math.round(quantile(lat, 0.5)! * 1000),
      latencyP90Ms: Math.round(quantile(lat, 0.9)! * 1000),
      misses: rows.filter((r) => !r.ok).map((r) => `${r.note} ${r.dyn}`),
    };
    expect(rows.length).toBeGreaterThan(60);
    expect(hits.length / rows.length).toBeGreaterThanOrEqual(0.9);
    expect(quantile(lat, 0.5)!).toBeLessThan(0.2);
    expect(quantile(lat, 0.9)!).toBeLessThan(0.3);
  });

  test('chords advance, partial chords do not', () => {
    let full = 0;
    let fullClear = 0;
    const lat: number[] = [];
    let partialN = 0;
    let partialFalse = 0;
    const falseCases: string[] = [];
    const missed: string[] = [];
    for (const [i, ch] of CHORDS.entries()) {
      const r = gate(chord(ch, i + 1), ch, UIOWA_ONSET);
      if (r.satisfied) {
        full++;
        if (r.kind === 'recognized') fullClear++;
        lat.push(r.latency!);
      } else missed.push(ch.map((p) => noteName(p)).join('+'));
      for (const drop of ch) {
        const rest = ch.filter((p) => p !== drop);
        partialN++;
        const pr = gate(chord(rest, i + 101), ch, UIOWA_ONSET);
        if (pr.satisfied) {
          partialFalse++;
          falseCases.push(`${rest.map((p) => noteName(p)).join('+')} accepted for ${ch.map((p) => noteName(p)).join('+')}`);
        }
      }
    }
    report.chords = {
      cases: CHORDS.length,
      advanced: full,
      advancedAllTonesClearlyHeard: fullClear,
      latencyMedianMs: Math.round((quantile(lat, 0.5) ?? 0) * 1000),
      latencyP90Ms: Math.round((quantile(lat, 0.9) ?? 0) * 1000),
      notAdvanced: missed,
    };
    report.partialChords = { cases: partialN, falselyAccepted: partialFalse, rate: partialFalse / partialN, falseCases };
    expect(full / CHORDS.length).toBeGreaterThanOrEqual(0.55);
    expect(partialFalse / partialN).toBeLessThanOrEqual(0.12);
  });

  test('wrong notes and octave errors do not advance', () => {
    let wrongN = 0;
    let wrongFalse = 0;
    let octN = 0;
    let octFalse = 0;
    const octCases: string[] = [];
    for (let p = 40; p <= 84; p += 4) {
      // A semitone neighbour instead of the expected note.
      for (const d of [-1, 1]) {
        if (!uiowa(p + d)) continue;
        wrongN++;
        if (gate(primed(uiowa(p + d)!), [p], UIOWA_ONSET).satisfied) wrongFalse++;
      }
      // The octave above / below instead of the expected note.
      for (const d of [-12, 12]) {
        if (!uiowa(p + d)) continue;
        octN++;
        if (gate(primed(uiowa(p + d)!), [p], UIOWA_ONSET).satisfied) {
          octFalse++;
          octCases.push(`${noteName(p + d)} accepted for ${noteName(p)}`);
        }
      }
    }
    report.wrongNotes = { cases: wrongN, falselyAccepted: wrongFalse };
    report.octaveErrors = { cases: octN, falselyAccepted: octFalse, falseCases: octCases };
    expect(wrongFalse / wrongN).toBeLessThanOrEqual(0.05);
    expect(octFalse / octN).toBeLessThanOrEqual(0.15);
  });

  test('repeated notes need a fresh attack', () => {
    const cases = [60, 65, 73, 77];
    let secondOk = 0;
    let sustainFalse = 0;
    for (const p of cases) {
      const n = uiowa(p)!;
      // Two strikes 0.6 s apart: both gates must advance, on different onsets.
      const twice = primed(mix(RATE, 2.2, [{ clip: n, at: 0 }, { clip: n, at: 0.6, gain: 0.9 }]));
      const run = runDetector(new PolyphonicDetector(), twice);
      const m = new GateMatcher();
      const ctx = (now: number) => ({ now, cursorAt: () => ({ song: 10, rate: 1 }), notBefore: 0 });
      const g1 = { index: 0, tick: 0, time: 10, pitches: [p], noteIds: [], bar: 1 };
      let resolved1 = false;
      let resolved2 = false;
      let notBefore = 0;
      for (const f of run.frames) {
        for (const o of f.onsets) m.add({ id: o.id, pitch: o.pitch, time: o.time, confidence: o.confidence, generation: 0 });
        if (!resolved1) {
          const r = m.evaluate(g1, ctx(f.time));
          if (r.satisfied) {
            m.consume(r.used);
            resolved1 = true;
            notBefore = 0;
          }
        } else if (!resolved2) {
          const r = m.evaluate({ ...g1, index: 1 }, { ...ctx(f.time), notBefore });
          if (r.satisfied) resolved2 = f.time > UIOWA_ONSET + 0.55;
        }
      }
      if (resolved1 && resolved2) secondOk++;
      // A single sustained strike must not satisfy the second gate.
      const once = runDetector(new PolyphonicDetector(), primed(mix(RATE, 2.2, [{ clip: n, at: 0 }])));
      const m2 = new GateMatcher();
      let r1 = false;
      let falseSecond = false;
      for (const f of once.frames) {
        for (const o of f.onsets) m2.add({ id: o.id, pitch: o.pitch, time: o.time, confidence: o.confidence, generation: 0 });
        const r = m2.evaluate(r1 ? { ...g1, index: 1 } : g1, ctx(f.time));
        if (r.satisfied && !r1) {
          m2.consume(r.used);
          r1 = true;
        } else if (r.satisfied && r1) falseSecond = true;
      }
      if (falseSecond) sustainFalse++;
    }
    report.repeatedNotes = { cases: cases.length, bothStrikesAdvance: secondOk, sustainFalselyAdvancesSecond: sustainFalse };
    expect(secondOk).toBeGreaterThanOrEqual(cases.length - 1);
    expect(sustainFalse).toBe(0);
  });

  test('a new note over a sustained one is heard', () => {
    const pairs: [number, number][] = [[49, 65], [56, 73], [61, 68], [44, 77], [60, 64]];
    let ok = 0;
    for (const [held, next] of pairs) {
      const clip = primed(mix(RATE, 2.5, [{ clip: uiowa(held)!, at: 0 }, { clip: uiowa(next)!, at: 0.8 }]));
      if (gate(clip, [next], UIOWA_ONSET + 0.8).satisfied) ok++;
    }
    report.sustainPlusNew = { cases: pairs.length, advanced: ok };
    expect(ok).toBeGreaterThanOrEqual(pairs.length - 1);
  });

  test('silence and room noise produce no confident notes', () => {
    const count = (clip: Clip) => runDetector(new PolyphonicDetector(), clip).onsets.filter((o) => o.confidence >= DEFAULT_MATCHER.acceptConfidence).length;
    const silence = count(noise(RATE, 10, -85, true, 3));
    const pink45 = count(noise(RATE, 10, -45, true, 5));
    const white50 = count(noise(RATE, 10, -50, false, 9));
    report.noise = { silence10s: silence, pinkMinus45dB10s: pink45, whiteMinus50dB10s: white50 };
    expect(silence).toBe(0);
    expect(pink45).toBeLessThanOrEqual(1);
    expect(white50).toBeLessThanOrEqual(1);
  });

  test('notes in room noise still advance', () => {
    let n = 0;
    let ok = 0;
    for (let p = 40; p <= 88; p += 3) {
      const c = uiowa(p);
      if (!c) continue;
      n++;
      const clip = add(primed(c), noise(RATE, 3, -45, true, p));
      if (gate(clip, [p], UIOWA_ONSET).satisfied) ok++;
    }
    report.notesInNoise = { cases: n, advanced: ok, noise: 'pink, −45 dBFS RMS (notes peak at −12 dBFS)' };
    expect(ok / n).toBeGreaterThanOrEqual(0.85);
  });
});

function toMarkdown(r: Record<string, unknown>): string {
  const j = (k: string) => (r[k] ? '```json\n' + JSON.stringify(r[k], null, 2) + '\n```\n' : '_not run_\n');
  return `# Recognition benchmark

Generated ${String(r.generatedAt)} by \`npm run bench:detector\` (\`src/tests/detector/benchmark.test.ts\`).

Detector \`${String(r.detector)}\` with the app's default matcher settings. Every case asks the question the app asks: *would this gate advance within ${DECISION_WINDOW} s of the attack?* Audio passes through the real path: 128-sample quanta at 44.1 kHz, explicit resampling to 22.05 kHz, the detector, then the GateMatcher.

Source: ${String(r.source)}

Latency is measured from the attack in the recording to the analysis frame that satisfies the gate. It does **not** include the microphone/driver input latency or the display frame; these add roughly 10–40 ms on typical hardware and cannot be measured from inside the browser.

These are recorded single notes mixed in software, not a live room. Real-room performance with a laptop microphone has **not** been measured. See the human checklist in the README.

## Single notes
${j('singleNotes')}
## Chords
${j('chords')}
## Partial chords (a tone missing, must not advance)
${j('partialChords')}
## Wrong notes (semitone neighbour, must not advance)
${j('wrongNotes')}
## Octave errors (octave above/below, must not advance)
${j('octaveErrors')}
## Repeated notes
${j('repeatedNotes')}
## New note over a sustained note
${j('sustainPlusNew')}
## Silence and noise (confident onsets)
${j('noise')}
## Notes in room noise
${j('notesInNoise')}`;
}
