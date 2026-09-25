import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildEvents, chordToleranceTicks } from '../../music/events';
import { barAtTick } from '../../music/meter';
import { MidiImportError, parseMidi, type SongSidecar } from '../../music/parse';
import { keyName, noteName } from '../../music/spelling';
import { songFromNotes } from '../helpers';

const bytes = readFileSync('public/songs/clair-de-lune.mid');
const sidecar = JSON.parse(readFileSync('public/songs/clair-de-lune.json', 'utf8')) as SongSidecar & { facts: Record<string, unknown> };
const song = parseMidi(bytes, { sidecar });

describe('bundled Clair de lune (Mutopia #1778)', () => {
  it('is the verified Mutopia file', () => {
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('MThd');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sidecar.sha256);
    expect(sidecar.provenance.license).toBe('Public Domain');
    expect(sidecar.provenance.maintainer).toBe('Keith OHara');
  });

  it('parses the complete piece', () => {
    expect(song.notes).toHaveLength(1468);
    expect(song.ppq).toBe(384);
    expect(song.duration).toBeCloseTo(322.5, 3);
    expect(Math.min(...song.notes.map((n) => n.pitch))).toBe(27); // E♭1
    expect(Math.max(...song.notes.map((n) => n.pitch))).toBe(97); // D♭7
    expect(song.tracks.map((t) => [t.name, t.noteCount, t.label])).toEqual([
      ['upper', 743, 'Upper staff'],
      ['lower', 725, 'Lower staff'],
    ]);
    expect(song.tracksValidated).toBe(true);
  });

  it('keeps the tempo map, meter, keys and bars exactly as in the file', () => {
    expect(song.tempos).toEqual([{ tick: 0, time: 0, bpm: 60 }]);
    expect(song.meters).toEqual([{ tick: 0, numerator: 9, denominator: 8 }]);
    expect(song.keys.map((k) => [k.tick, k.name])).toEqual([
      [0, 'D♭ major'],
      [62208, 'C♯ minor'],
      [72576, 'D♭ major'],
    ]);
    // Bar numbers agree with \barNumberCheck in the LilyPond source.
    expect(barAtTick(song.bars, 62208).number).toBe(37);
    expect(barAtTick(song.bars, 72576).number).toBe(43);
    expect(song.bars[0]).toMatchObject({ number: 1, tick: 0, lengthTicks: 1728 });
    expect(song.bars.at(-1)!.number).toBe(72);
    expect(song.pedal).toEqual([]); // the file has no CC64; nothing is invented
  });

  it('preserves onsets, durations and velocities of the opening', () => {
    const opening = song.notes.filter((n) => n.tick < 1728).map((n) => [noteName(n.pitch, -5), n.tick, n.durationTicks, n.track]);
    expect(opening).toEqual([
      ['F4', 192, 1536, 1],
      ['A♭4', 192, 1536, 1],
      ['F5', 384, 768, 0],
      ['A♭5', 384, 768, 0],
      ['D♭5', 1152, 768, 0],
      ['F5', 1152, 768, 0],
    ]);
    expect(new Set(song.notes.map((n) => Math.round(n.velocity * 127)))).toEqual(new Set([90]));
  });

  it('applies the hand mapping traced from the LilyPond voices', () => {
    expect(song.handMapping?.unassigned).toBe(10);
    const upperLeft = song.notes.filter((n) => n.track === 0 && n.hand === 'left');
    expect(upperLeft).toHaveLength(105); // left-hand arpeggios written on the upper staff (bars 27–42, 66–72)
    expect(barAtTick(song.bars, upperLeft[0]!.tick).number).toBe(27);
    // Opening: the held F4–A♭4 dyad is the left hand; F5–A♭5 the right hand.
    expect(song.notes.filter((n) => n.tick === 384).every((n) => n.hand === 'right')).toBe(true);
  });

  it('groups only genuinely simultaneous onsets', () => {
    const all = buildEvents(song, { kind: 'all' });
    expect(all.slice(0, 3).map((e) => e.pitches)).toEqual([
      [65, 68],
      [77, 80],
      [73, 77],
    ]);
    // Bar 27: left-hand sixteenth arpeggio D♭2 A♭2 D♭3 F3 ... stays one event per note.
    const bar27 = all.filter((e) => e.bar === 27);
    const ticks27 = new Set(song.notes.filter((n) => barAtTick(song.bars, n.tick).number === 27).map((n) => n.tick));
    expect(bar27.length).toBe(ticks27.size); // every distinct onset tick is its own event
    expect(bar27.length).toBeGreaterThanOrEqual(16);
    expect(bar27.slice(0, 4).map((e) => e.pitches)).toEqual([[37, 65, 68], [44], [49], [53]]);
    expect(chordToleranceTicks(384)).toBe(8);
    // No note is lost by grouping.
    expect(all.reduce((s, e) => s + e.noteIds.length, 0)).toBe(1468);
    // Right-hand selection never includes unassigned or left-hand notes.
    const rh = buildEvents(song, { kind: 'hand', hand: 'right' });
    const rhIds = new Set(rh.flatMap((e) => e.noteIds));
    expect(song.notes.filter((n) => rhIds.has(n.id)).every((n) => n.hand === 'right')).toBe(true);
  });
});

describe('import of tempo maps, meters, rests and durations', () => {
  const s = songFromNotes(
    [
      { pitch: 60, beat: 0, dur: 1 },
      { pitch: 62, beat: 2, dur: 0.5 }, // after a quarter rest
      { pitch: 64, beat: 4, dur: 2 },
      { pitch: 65, beat: 10, dur: 1 },
    ],
    { tempos: [{ beat: 0, bpm: 60 }, { beat: 4, bpm: 120 }], meters: [{ beat: 0, ts: [4, 4] }, { beat: 8, ts: [3, 4] }] },
  );

  it('converts ticks to seconds through tempo changes', () => {
    expect(s.notes.map((n) => n.time)).toEqual([0, 2, 4, 7]);
    expect(s.notes.map((n) => +n.duration.toFixed(6))).toEqual([1, 0.5, 1, 0.5]);
  });

  it('derives bars across a meter change', () => {
    expect(s.bars.slice(0, 4).map((b) => [b.number, b.tick / s.ppq, b.numerator])).toEqual([
      [1, 0, 4],
      [2, 4, 4],
      [3, 8, 3],
    ]);
    expect(s.bars.at(-1)!.lengthTicks / s.ppq).toBe(3);
  });

  it('preserves rests as gaps between events', () => {
    const ev = buildEvents(s, { kind: 'all' });
    expect(ev.map((e) => e.time)).toEqual([0, 2, 4, 7]);
  });
});

describe('malformed input', () => {
  it('rejects non-MIDI data with a clear message', () => {
    expect(() => parseMidi(new TextEncoder().encode('this is not midi at all'))).toThrow(MidiImportError);
    expect(() => parseMidi(new Uint8Array(4))).toThrow(/too short/);
  });

  it('rejects a truncated file without crashing', () => {
    expect(() => parseMidi(bytes.subarray(0, 40))).toThrow(MidiImportError);
  });

  it('rejects oversized files', () => {
    const big = new Uint8Array(9 * 1024 * 1024);
    big.set(bytes.subarray(0, 14));
    expect(() => parseMidi(big)).toThrow(/limit/);
  });
});

describe('spelling', () => {
  it('spells by key signature', () => {
    expect(noteName(61, -5)).toBe('D♭4');
    expect(noteName(61, 4)).toBe('C♯4');
    expect(keyName(4, 'minor')).toBe('C♯ minor');
    expect(keyName(-5, 'major')).toBe('D♭ major');
  });
});
