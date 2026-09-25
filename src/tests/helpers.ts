import { Midi } from '@tonejs/midi';
import { parseMidi } from '../music/parse';
import type { Song } from '../music/types';

export interface NoteSpec {
  pitch: number;
  /** In quarter notes. */
  beat: number;
  /** In quarter notes. */
  dur?: number;
  track?: number;
}

/** Builds a real MIDI file with @tonejs/midi and imports it through the app's parser. */
export function songFromNotes(
  notes: NoteSpec[],
  opts: { bpm?: number; tempos?: { beat: number; bpm: number }[]; meters?: { beat: number; ts: [number, number] }[]; ppq?: number } = {},
): Song {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  const tempos = opts.tempos ?? [{ beat: 0, bpm: opts.bpm ?? 60 }];
  for (const t of tempos) midi.header.tempos.push({ ticks: Math.round(t.beat * ppq), bpm: t.bpm });
  for (const m of opts.meters ?? [{ beat: 0, ts: [4, 4] }]) midi.header.timeSignatures.push({ ticks: Math.round(m.beat * ppq), timeSignature: m.ts });
  midi.header.update();
  const trackCount = Math.max(1, ...notes.map((n) => (n.track ?? 0) + 1));
  const tracks = Array.from({ length: trackCount }, (_, i) => {
    const t = midi.addTrack();
    t.name = `Track ${i + 1}`;
    t.channel = i;
    return t;
  });
  for (const n of notes) tracks[n.track ?? 0]!.addNote({ midi: n.pitch, ticks: Math.round(n.beat * ppq), durationTicks: Math.round((n.dur ?? 1) * ppq), velocity: 0.7 });
  return parseMidi(midi.toArray(), { title: 'Test', composer: 'Test' });
}

/** Deterministic onset factory for engine tests (these stand in for detector output). */
export function onsetFactory(generation: () => number) {
  let id = 1000;
  return (pitch: number, time: number, confidence = 0.9, extra: { harmonicOf?: number; id?: number } = {}) => {
    const e: { id: number; pitch: number; time: number; confidence: number; generation: number; harmonicOf?: number } = {
      id: extra.id ?? id++,
      pitch,
      time,
      confidence,
      generation: generation(),
    };
    if (extra.harmonicOf !== undefined) e.harmonicOf = extra.harmonicOf;
    return e;
  };
}
