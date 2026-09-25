import { Midi } from '@tonejs/midi';
import { buildBars } from './meter';
import { keyName } from './spelling';
import { TempoMap } from './tempo';
import type { Hand, KeyPoint, MeterPoint, PedalEvent, Provenance, Song, SongNote, SongTrack, TextMark } from './types';

export const MAX_MIDI_BYTES = 8 * 1024 * 1024;
export const MAX_NOTES = 60_000;

/** Validated facts that travel next to a bundled MIDI file (public/songs/*.json). */
export interface SongSidecar {
  id: string;
  title: string;
  composer: string;
  midiFile: string;
  sha256: string;
  provenance: Provenance;
  anacrusisTicks: number;
  tracks: { index: number; label: string; staff: 'upper' | 'lower'; validation: string }[];
  textMarks: TextMark[];
  handMapping?: {
    method: string;
    /** [tick, pitch, 'R' | 'L'] for every note the mapping covers. */
    notes: [number, number, 'R' | 'L'][];
  };
}

export class MidiImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MidiImportError';
  }
}

const TONE_KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

export function checkMidiHeader(bytes: Uint8Array): void {
  if (bytes.byteLength < 14) throw new MidiImportError('File is too short to be a MIDI file.');
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag !== 'MThd') throw new MidiImportError('Not a standard MIDI file (missing "MThd" header).');
  const headerLen = (bytes[4]! << 24) | (bytes[5]! << 16) | (bytes[6]! << 8) | bytes[7]!;
  if (headerLen < 6) throw new MidiImportError('Corrupt MIDI header length.');
  const division = (bytes[12]! << 8) | bytes[13]!;
  if (division & 0x8000) throw new MidiImportError('SMPTE-timed MIDI files are not supported (need ticks per quarter note).');
  if (division === 0) throw new MidiImportError('MIDI header declares 0 ticks per quarter note.');
}

export interface ParseOptions {
  id?: string;
  title?: string;
  composer?: string;
  /** Only pass a sidecar whose sha256 matched the bytes. */
  sidecar?: SongSidecar;
}

export function parseMidi(input: ArrayBuffer | Uint8Array, opts: ParseOptions = {}): Song {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_MIDI_BYTES) throw new MidiImportError(`File is ${(bytes.byteLength / 1e6).toFixed(1)} MB; the limit is ${MAX_MIDI_BYTES / 1e6} MB.`);
  checkMidiHeader(bytes);
  let midi: Midi;
  try {
    midi = new Midi(bytes);
  } catch (e) {
    throw new MidiImportError(`Could not parse MIDI data: ${e instanceof Error ? e.message : String(e)}`);
  }
  const warnings: string[] = [];
  const ppq = midi.header.ppq;
  const tempo = new TempoMap(
    ppq,
    midi.header.tempos.map((t) => ({ tick: t.ticks, bpm: t.bpm })),
  );
  if (midi.header.tempos.length === 0) warnings.push('No tempo events; MIDI default of 120 quarter notes per minute used.');

  const sidecar = opts.sidecar;
  const handByKey = new Map<string, Hand>();
  if (sidecar?.handMapping) {
    for (const [tick, pitch, h] of sidecar.handMapping.notes) handByKey.set(`${tick}:${pitch}`, h === 'R' ? 'right' : 'left');
  }

  const raw: Omit<SongNote, 'id'>[] = [];
  const tracks: SongTrack[] = [];
  midi.tracks.forEach((t, trackIndex) => {
    let min = 127;
    let max = 0;
    for (const n of t.notes) {
      if (n.durationTicks < 0 || n.midi < 0 || n.midi > 127) continue;
      min = Math.min(min, n.midi);
      max = Math.max(max, n.midi);
      raw.push({
        pitch: n.midi,
        tick: n.ticks,
        durationTicks: Math.max(1, n.durationTicks),
        time: tempo.tickToSeconds(n.ticks),
        duration: Math.max(0.001, tempo.tickToSeconds(n.ticks + n.durationTicks) - tempo.tickToSeconds(n.ticks)),
        velocity: n.velocity,
        track: trackIndex,
        channel: t.channel,
      });
    }
    const side = sidecar?.tracks.find((s) => s.index === trackIndex);
    tracks.push({
      index: trackIndex,
      name: t.name,
      channel: t.channel,
      noteCount: t.notes.length,
      minPitch: t.notes.length ? min : 0,
      maxPitch: t.notes.length ? max : 0,
      label: side?.label ?? (t.name.trim() || `Track ${trackIndex + 1}`),
    });
  });
  if (raw.length === 0) throw new MidiImportError('The file contains no notes.');
  if (raw.length > MAX_NOTES) throw new MidiImportError(`The file has ${raw.length} notes; the limit is ${MAX_NOTES}.`);

  raw.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch || a.track - b.track);
  let unassigned = 0;
  const notes: SongNote[] = raw.map((n, id) => {
    const note: SongNote = { ...n, id };
    if (sidecar?.handMapping) {
      const hand = handByKey.get(`${n.tick}:${n.pitch}`);
      if (hand) note.hand = hand;
      else unassigned++;
    }
    return note;
  });

  const endTick = notes.reduce((m, n) => Math.max(m, n.tick + n.durationTicks), 0);

  // Deduplicate meta events that type-1 files repeat on every track.
  const meters: MeterPoint[] = [];
  for (const ts of midi.header.timeSignatures) {
    const [numerator, denominator] = ts.timeSignature as [number, number];
    if (!numerator || !denominator) continue;
    const prev = meters[meters.length - 1];
    if (prev && prev.tick === ts.ticks) meters[meters.length - 1] = { tick: ts.ticks, numerator, denominator };
    else if (!prev || prev.numerator !== numerator || prev.denominator !== denominator) meters.push({ tick: ts.ticks, numerator, denominator });
  }
  if (meters.length === 0) warnings.push('No time signature; 4/4 assumed for bar lines.');

  // @tonejs/midi names every key signature after its *major* tonic (4 sharps minor → "E minor").
  // Recover the accidental count and name the key correctly.
  const keys: KeyPoint[] = [];
  for (const k of [...midi.header.keySignatures].sort((a, b) => a.ticks - b.ticks)) {
    const idx = TONE_KEY_NAMES.indexOf(k.key);
    if (idx < 0) continue;
    const accidentals = idx - 7;
    const mode = k.scale === 'minor' ? 'minor' : 'major';
    const prev = keys[keys.length - 1];
    if (prev && prev.accidentals === accidentals && prev.mode === mode) continue;
    keys.push({ tick: k.ticks, accidentals, mode, name: keyName(accidentals, mode) });
  }

  const pedal: PedalEvent[] = [];
  for (const t of midi.tracks) {
    for (const cc of t.controlChanges[64] ?? []) pedal.push({ tick: cc.ticks, time: tempo.tickToSeconds(cc.ticks), value: Math.round(cc.value * 127) });
  }
  pedal.sort((a, b) => a.tick - b.tick);

  const bars = buildBars(meters, ppq, endTick, tempo, sidecar?.anacrusisTicks ?? 0);

  const song: Song = {
    id: opts.id ?? sidecar?.id ?? 'imported',
    title: opts.title ?? sidecar?.title ?? (midi.header.name.trim() || 'Untitled'),
    composer: opts.composer ?? sidecar?.composer ?? 'Unknown composer',
    ppq,
    durationTicks: endTick,
    duration: tempo.tickToSeconds(endTick),
    notes,
    tracks,
    tempos: tempo.points,
    meters: meters.length ? meters : [{ tick: 0, numerator: 4, denominator: 4 }],
    keys,
    bars,
    pedal,
    textMarks: sidecar?.textMarks ?? [],
    tracksValidated: Boolean(sidecar),
    warnings,
  };
  if (sidecar?.provenance) song.provenance = sidecar.provenance;
  if (sidecar?.handMapping) song.handMapping = { method: sidecar.handMapping.method, unassigned };
  return song;
}

/** Tempo map rebuilt from a parsed song (the Song only stores plain data). */
export function tempoMapOf(song: Song): TempoMap {
  return new TempoMap(song.ppq, song.tempos.map((t) => ({ tick: t.tick, bpm: t.bpm })));
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
