// Prints the facts of a MIDI file straight from the file (no app code), for checking song metadata.
// Run: npm run inspect:song [-- path/to/file.mid]   (default: the bundled Clair de lune)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import tonejsMidi from '@tonejs/midi';

const { Midi } = tonejsMidi;
const path = process.argv[2] ?? 'public/songs/clair-de-lune.mid';
const bytes = readFileSync(path);
const midi = new Midi(bytes);
const notes = midi.tracks.flatMap((t) => t.notes);
const pitches = notes.map((n) => n.midi);
const cc64 = midi.tracks.reduce((s, t) => s + (t.controlChanges[64]?.length ?? 0), 0);
const velocities = new Set(notes.map((n) => Math.round(n.velocity * 127)));
console.log(JSON.stringify({
  file: path,
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  ppq: midi.header.ppq,
  name: midi.header.name,
  durationSeconds: +midi.duration.toFixed(3),
  endTick: midi.durationTicks,
  notes: notes.length,
  pitchRange: [Math.min(...pitches), Math.max(...pitches)],
  tracks: midi.tracks.map((t, i) => ({ index: i, name: t.name, channel: t.channel, notes: t.notes.length })),
  tempos: midi.header.tempos.map((t) => ({ tick: t.ticks, bpm: +t.bpm.toFixed(3) })),
  timeSignatures: midi.header.timeSignatures.map((t) => ({ tick: t.ticks, meter: t.timeSignature.join('/') })),
  keySignatures: midi.header.keySignatures.map((k) => ({ tick: k.ticks, key: k.key, scale: k.scale, note: 'names from @tonejs/midi; minor keys may be mislabelled — the app recovers them from the accidental count' })),
  sustainPedalEvents: cc64,
  distinctVelocities: [...velocities].sort((a, b) => a - b),
}, null, 2));
