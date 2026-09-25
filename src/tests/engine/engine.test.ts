import { describe, expect, it } from 'vitest';
import { PracticeEngine } from '../../practice/engine';
import { onsetFactory, songFromNotes } from '../helpers';

// 60 bpm → one quarter note = one second of song time. Audio clock starts at T0.
const T0 = 100;

function setup(notes: Parameters<typeof songFromNotes>[0], opts: Parameters<typeof songFromNotes>[1] = {}, matcher = {}) {
  const song = songFromNotes(notes, opts);
  const engine = new PracticeEngine(matcher);
  engine.load(song, { kind: 'all' }, T0);
  const onset = onsetFactory(() => engine.currentGeneration);
  return { song, engine, onset };
}

/** Starts playback at T0 and ticks until the cursor freezes at the first gate. */
function runToFirstGate(engine: PracticeEngine, gateSongTime: number) {
  engine.play(T0);
  engine.tick(T0 + gateSongTime + 0.01);
  expect(engine.currentState).toBe('waiting');
  expect(engine.transport.songTime).toBeCloseTo(gateSongTime, 9);
}

describe('wait-for-notes: single notes', () => {
  it('freezes exactly at the gate and advances on the correct note', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }, { pitch: 64, beat: 2 }]);
    engine.play(T0);
    engine.tick(T0 + 0.5);
    expect(engine.currentState).toBe('running');
    engine.tick(T0 + 5); // big frame jump: must stop exactly at the gate, not overshoot
    expect(engine.transport.songTime).toBe(1);
    expect(engine.currentState).toBe('waiting');
    engine.addEvidence([onset(60, T0 + 5.2)], T0 + 5.3);
    expect(engine.snapshot().gateIndex).toBe(1);
    expect(engine.currentState).toBe('running');
    // Resumes from the gate, never jumps ahead to make up for the wait.
    engine.tick(T0 + 5.8);
    expect(engine.transport.songTime).toBeCloseTo(1.5, 6);
  });

  it('does not advance on a wrong note or on silence', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }]);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(62, T0 + 1.5)], T0 + 1.6);
    engine.tick(T0 + 20);
    expect(engine.currentState).toBe('waiting');
    expect(engine.transport.songTime).toBe(1);
    expect(engine.snapshot().extraNotes).toEqual([]); // outside the chord window by now
    expect(engine.snapshot().results).toHaveLength(0);
  });

  it('allows correcting a wrong note without restarting', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }]);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(61, T0 + 1.2)], T0 + 1.3);
    expect(engine.currentState).toBe('waiting');
    engine.addEvidence([onset(60, T0 + 2.0)], T0 + 2.1);
    expect(engine.snapshot().results[0]!.kind).toBe('recognized');
  });

  it('shows low-confidence evidence as uncertain and does not advance', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }]);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.2, 0.4)], T0 + 1.3);
    expect(engine.currentState).toBe('waiting');
    expect(engine.snapshot().tones[0]!.status).toBe('uncertain');
    expect(engine.snapshot().status).toMatch(/uncertain/i);
  });
});

describe('wait-for-notes: chords', () => {
  const chord = [{ pitch: 60, beat: 1 }, { pitch: 64, beat: 1 }, { pitch: 67, beat: 1 }, { pitch: 72, beat: 3 }];

  it('advances on a complete chord', () => {
    const { engine, onset } = setup(chord);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.5), onset(64, T0 + 1.51), onset(67, T0 + 1.52)], T0 + 1.6);
    expect(engine.snapshot().results[0]!.kind).toBe('recognized');
  });

  it('does not accept a partial chord', () => {
    const { engine, onset } = setup(chord);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.5), onset(67, T0 + 1.5)], T0 + 1.6);
    engine.tick(T0 + 3);
    expect(engine.currentState).toBe('waiting');
    const s = engine.snapshot();
    expect(s.tones.map((t) => t.status)).toEqual(['heard', 'expected', 'heard']);
    expect(s.status).toMatch(/waiting for E4/);
  });

  it('accepts a gently rolled chord inside the roll window', () => {
    const { engine, onset } = setup(chord, {}, { rollWindow: 0.4 });
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.5)], T0 + 1.55);
    engine.addEvidence([onset(64, T0 + 1.7)], T0 + 1.75);
    engine.addEvidence([onset(67, T0 + 1.88)], T0 + 1.95);
    expect(engine.snapshot().results).toHaveLength(1);
  });

  it('expires stale partial matches instead of combining notes seconds apart', () => {
    const { engine, onset } = setup(chord, {}, { rollWindow: 0.4 });
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.5), onset(64, T0 + 1.5)], T0 + 1.6);
    engine.addEvidence([onset(67, T0 + 4.0)], T0 + 4.1);
    expect(engine.currentState).toBe('waiting');
    expect(engine.snapshot().tones.filter((t) => t.status === 'stale').map((t) => t.pitch)).toEqual([60, 64]);
    // Replaying the stale tones together with the fresh one completes it.
    engine.addEvidence([onset(60, T0 + 4.2), onset(64, T0 + 4.25)], T0 + 4.3);
    expect(engine.snapshot().results).toHaveLength(1);
  });

  it('accepts a masked octave tone only when the lower note is clearly heard', () => {
    const notes = [{ pitch: 61, beat: 1 }, { pitch: 73, beat: 1 }];
    const a = setup(notes);
    runToFirstGate(a.engine, 1);
    a.engine.addEvidence([a.onset(61, T0 + 1.5), a.onset(73, T0 + 1.5, 0.4, { harmonicOf: 61 })], T0 + 1.6);
    expect(a.engine.snapshot().results[0]!.kind).toBe('recognized-uncertain-parts');
    expect(a.engine.snapshot().results[0]!.tones.map((t) => t.status)).toEqual(['heard', 'masked']);

    const b = setup(notes);
    runToFirstGate(b.engine, 1);
    // Lower note only weakly heard → the masked upper note cannot lean on it.
    b.engine.addEvidence([b.onset(61, T0 + 1.5, 0.4), b.onset(73, T0 + 1.5, 0.4, { harmonicOf: 61 })], T0 + 1.6);
    expect(b.engine.currentState).toBe('waiting');
  });

  it('treats evidence masked by a note outside the chord as uncertain (e.g. a wrong lower note)', () => {
    const { engine, onset } = setup([{ pitch: 76, beat: 1 }]);
    runToFirstGate(engine, 1);
    // E5 detected only as the 3rd partial of a (wrong) A3.
    engine.addEvidence([onset(57, T0 + 1.5), onset(76, T0 + 1.5, 0.7, { harmonicOf: 57 })], T0 + 1.6);
    expect(engine.currentState).toBe('waiting');
    expect(engine.snapshot().tones[0]!.status).toBe('uncertain');
  });

  it("'trust-lower' octave policy infers the doubling and records it as not heard", () => {
    const { engine, onset } = setup([{ pitch: 61, beat: 1 }, { pitch: 73, beat: 1 }], {}, { octavePolicy: 'trust-lower' });
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(61, T0 + 1.5)], T0 + 1.6);
    const r = engine.snapshot().results[0]!;
    expect(r.kind).toBe('recognized-uncertain-parts');
    expect(r.tones[1]!.status).toBe('inferred');
  });

  it('bass-octave tolerance is off by default and labelled when on', () => {
    const off = setup([{ pitch: 37, beat: 1 }]);
    runToFirstGate(off.engine, 1);
    off.engine.addEvidence([off.onset(49, T0 + 1.5)], T0 + 1.6);
    expect(off.engine.currentState).toBe('waiting');

    const on = setup([{ pitch: 37, beat: 1 }], {}, { bassOctaveBelow: 48 });
    runToFirstGate(on.engine, 1);
    on.engine.addEvidence([on.onset(49, T0 + 1.5)], T0 + 1.6);
    expect(on.engine.snapshot().results[0]!.tones[0]!.status).toBe('octave');
  });

  it('blocks when a cluster of other notes is played with the chord', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }], {}, { blockOnExtraNotes: 3 });
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.5), onset(62, T0 + 1.5), onset(65, T0 + 1.5), onset(69, T0 + 1.5)], T0 + 1.6);
    expect(engine.currentState).toBe('waiting');
    expect(engine.snapshot().status).toMatch(/Too many other notes/);
  });
});

describe('fresh evidence', () => {
  it('a repeated written note needs a fresh re-attack', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }, { pitch: 60, beat: 2 }]);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.2)], T0 + 1.3);
    engine.tick(T0 + 3);
    expect(engine.snapshot().gateIndex).toBe(1);
    expect(engine.currentState).toBe('waiting'); // sustained tone cannot satisfy the repeat
    engine.addEvidence([onset(60, T0 + 3.1)], T0 + 3.2);
    expect(engine.snapshot().gateIndex).toBe(2);
  });

  it('one onset satisfies only its own event even when the next gate is within early tolerance', () => {
    // Two C4 sixteenths 0.25 s apart: the second gate is inside the early window.
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }, { pitch: 60, beat: 1.25 }, { pitch: 64, beat: 3 }]);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.2)], T0 + 1.25);
    expect(engine.snapshot().gateIndex).toBe(1);
    engine.tick(T0 + 1.6);
    expect(engine.currentState).toBe('waiting');
    expect(engine.snapshot().results).toHaveLength(1);
  });

  it('an unrelated attack does not revalidate notes still ringing from the previous chord', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }, { pitch: 64, beat: 1 }, { pitch: 60, beat: 2 }, { pitch: 64, beat: 2 }]);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.2), onset(64, T0 + 1.2)], T0 + 1.3);
    engine.tick(T0 + 2.5);
    expect(engine.currentState).toBe('waiting');
    engine.addEvidence([onset(67, T0 + 2.6)], T0 + 2.7); // G4 attack while C4/E4 ring
    engine.tick(T0 + 4);
    expect(engine.snapshot().gateIndex).toBe(1);
  });

  it('separate arpeggio events stay separate and each consumes its own onset', () => {
    // Fast 32nd-note-like arpeggio (0.2 s apart): three events, never merged into a chord.
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }, { pitch: 64, beat: 1.2 }, { pitch: 67, beat: 1.4 }]);
    expect(engine.eventList.map((e) => e.pitches)).toEqual([[60], [64], [67]]);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.1), onset(64, T0 + 1.25), onset(67, T0 + 1.4)], T0 + 1.45);
    expect(engine.snapshot().results.map((r) => r.eventIndex)).toEqual([0, 1, 2]);
  });

  it('accepts slightly early playing but not notes played long before the strike line', () => {
    const a = setup([{ pitch: 60, beat: 2 }]);
    a.engine.play(T0);
    a.engine.tick(T0 + 1.7);
    a.engine.addEvidence([a.onset(60, T0 + 1.7)], T0 + 1.75); // 0.3 s early
    expect(a.engine.snapshot().results).toHaveLength(1);

    const b = setup([{ pitch: 60, beat: 3 }]);
    b.engine.play(T0);
    b.engine.tick(T0 + 1);
    b.engine.addEvidence([b.onset(60, T0 + 1)], T0 + 1.05); // 2 s early
    b.engine.tick(T0 + 3.01);
    expect(b.engine.currentState).toBe('waiting');
  });

  it("the app's own playback is never evidence", () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }]);
    engine.setSelfPlayedFilter((pitch) => pitch === 60);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.2)], T0 + 1.3);
    expect(engine.currentState).toBe('waiting');
  });
});

describe('sessions, seeking and stale work', () => {
  const notes = [0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ pitch: 60 + b, beat: b + 1 }));

  it('rejects delayed worker results from before a seek', () => {
    const { engine, onset } = setup(notes);
    runToFirstGate(engine, 1);
    const oldGen = engine.currentGeneration;
    const late = onset(60, T0 + 1.2);
    engine.seek(4, T0 + 2);
    expect(engine.currentGeneration).toBeGreaterThan(oldGen);
    engine.addEvidence([late], T0 + 2.1); // arrives after the seek, tagged with the old generation
    engine.tick(T0 + 2.05);
    expect(engine.snapshot().results).toHaveLength(0);
    // Even re-tagged with the new generation, evidence from before the seek time is ignored.
    engine.addEvidence([{ ...late, generation: engine.currentGeneration }], T0 + 2.1);
    expect(engine.snapshot().results).toHaveLength(0);
    expect(engine.snapshot().gate!.pitches).toEqual([63]);
  });

  it('pause and resume discard evidence captured while paused', () => {
    const { engine, onset } = setup(notes);
    runToFirstGate(engine, 1);
    engine.pause(T0 + 1.5);
    const e = onset(60, T0 + 1.6);
    engine.addEvidence([e], T0 + 1.7);
    engine.play(T0 + 2);
    engine.addEvidence([{ ...e, generation: engine.currentGeneration }], T0 + 2.1);
    engine.tick(T0 + 2.2);
    expect(engine.snapshot().results).toHaveLength(0);
    expect(engine.transport.songTime).toBe(1);
  });

  it('restart returns to the beginning (or loop start) and clears evidence', () => {
    const { engine, onset } = setup(notes);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.2)], T0 + 1.3);
    engine.tick(T0 + 2.4);
    engine.restart(T0 + 3);
    expect(engine.transport.songTime).toBe(0);
    expect(engine.snapshot().gateIndex).toBe(0);
  });

  it('changing the part rebuilds gates without moving the cursor', () => {
    const song = songFromNotes([{ pitch: 72, beat: 1, track: 0 }, { pitch: 48, beat: 1.5, track: 1 }, { pitch: 74, beat: 2, track: 0 }]);
    const engine = new PracticeEngine();
    engine.load(song, { kind: 'all' }, T0);
    expect(engine.eventList).toHaveLength(3);
    engine.play(T0);
    engine.tick(T0 + 0.5);
    engine.setPart({ kind: 'tracks', tracks: [1] }, T0 + 0.5);
    expect(engine.transport.songTime).toBeCloseTo(0.5, 9);
    expect(engine.eventList.map((e) => e.pitches)).toEqual([[48]]);
    engine.tick(T0 + 2);
    expect(engine.transport.songTime).toBe(1.5);
  });

  it('A-B loop wraps to A with a new generation and keeps waiting at gates inside it', () => {
    const { engine, onset } = setup(notes);
    engine.setLoop({ a: 0.5, b: 2.5 }, T0);
    expect(engine.transport.songTime).toBe(0.5);
    engine.play(T0);
    engine.tick(T0 + 0.51);
    engine.tick(T0 + 1);
    expect(engine.currentState).toBe('waiting');
    engine.addEvidence([onset(60, T0 + 1.1)], T0 + 1.15); // resumes from song time 1 at T0+1.15
    engine.tick(T0 + 2.3);
    expect(engine.currentState).toBe('waiting'); // gate at song time 2 (C♯4)
    engine.addEvidence([onset(61, T0 + 2.3)], T0 + 2.35);
    const gen = engine.currentGeneration;
    engine.tick(T0 + 2.9); // passes B = 2.5 → back to A
    expect(engine.transport.songTime).toBeCloseTo(0.5, 6);
    expect(engine.currentGeneration).toBeGreaterThan(gen);
    expect(engine.snapshot().gate!.pitches).toEqual([60]);
  });

  it('tempo changes scale cursor speed without corrupting its position', () => {
    const { engine } = setup([{ pitch: 60, beat: 10 }]);
    engine.setTempo(0.5, T0);
    engine.play(T0);
    engine.tick(T0 + 2);
    expect(engine.transport.songTime).toBeCloseTo(1, 9);
    engine.setTempo(1.5, T0 + 2);
    engine.tick(T0 + 4);
    expect(engine.transport.songTime).toBeCloseTo(4, 9);
    expect(engine.transport.at(T0 + 1).song).toBeCloseTo(0.5, 9); // history maps old timestamps correctly
  });

  it('completes at the end of the piece', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1, dur: 1 }]);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.2)], T0 + 1.3);
    engine.tick(T0 + 5);
    expect(engine.currentState).toBe('completed');
  });
});

describe('modes', () => {
  it('Listen mode never freezes and never grants credit', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }, { pitch: 62, beat: 2 }]);
    engine.setMode('listen', T0);
    engine.play(T0);
    engine.addEvidence([onset(60, T0 + 0.9)], T0 + 0.95);
    engine.tick(T0 + 1.5);
    expect(engine.currentState).toBe('running');
    expect(engine.transport.songTime).toBeCloseTo(1.5, 9);
    expect(engine.snapshot().results).toHaveLength(0);
  });

  it('Manual mode ignores the microphone; Space advances and is recorded as manual', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }, { pitch: 62, beat: 2 }]);
    engine.setMode('manual', T0);
    runToFirstGate(engine, 1);
    engine.addEvidence([onset(60, T0 + 1.2)], T0 + 1.3);
    expect(engine.currentState).toBe('waiting');
    expect(engine.manualAdvance(T0 + 1.4)).toBe(true);
    const s = engine.snapshot();
    expect(s.results[0]!.kind).toBe('manual');
    expect(s.totals).toEqual({ recognized: 0, withUncertainParts: 0, manual: 1 });
  });

  it('manual skips in Learn mode stay separate from recognitions', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }, { pitch: 62, beat: 2 }]);
    runToFirstGate(engine, 1);
    engine.manualAdvance(T0 + 1.5);
    engine.tick(T0 + 2.6);
    engine.addEvidence([onset(62, T0 + 2.7)], T0 + 2.8);
    expect(engine.snapshot().totals).toEqual({ recognized: 1, withUncertainParts: 0, manual: 1 });
  });

  it('Single-note mode gates on the highest note of each onset only', () => {
    const { engine } = setup([{ pitch: 60, beat: 1 }, { pitch: 64, beat: 1 }, { pitch: 67, beat: 1 }, { pitch: 65, beat: 2 }]);
    engine.setMode('single', T0);
    expect(engine.eventList.map((e) => e.pitches)).toEqual([[67], [65]]);
  });

  it('preview pauses matching and resumes with a fresh generation', () => {
    const { engine, onset } = setup([{ pitch: 60, beat: 1 }]);
    runToFirstGate(engine, 1);
    const pre = onset(60, T0 + 1.2);
    expect(engine.beginPreview(T0 + 1.1)).toBe(true);
    engine.addEvidence([pre], T0 + 1.3); // the app's own example playing
    expect(engine.currentState).toBe('previewing');
    engine.endPreview(T0 + 4);
    engine.addEvidence([{ ...pre, generation: engine.currentGeneration }], T0 + 4.1);
    engine.tick(T0 + 4.2);
    expect(engine.snapshot().results).toHaveLength(0);
    expect(engine.currentState).toBe('waiting');
  });
});
