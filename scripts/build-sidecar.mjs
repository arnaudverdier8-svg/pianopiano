// Builds public/songs/clair-de-lune.json: provenance, recorded facts, the validated staff mapping,
// and the hand mapping traced from the Mutopia LilyPond voices. Deterministic; run after fetch:song.
//   node scripts/build-sidecar.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import toneMidi from '@tonejs/midi';

const { Midi } = toneMidi;
const MIDI_PATH = 'public/songs/clair-de-lune.mid';
const VOICES_PATH = 'scripts/lilypond/clair-de-lune.voices.mid';
const OUT = 'public/songs/clair-de-lune.json';

const bytes = await readFile(MIDI_PATH);
if (bytes.subarray(0, 4).toString('latin1') !== 'MThd') throw new Error('Not a MIDI file');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const midi = new Midi(bytes);
const voices = new Midi(await readFile(VOICES_PATH));
const ppq = midi.header.ppq;

// ---- recorded facts (never invented: everything below is read from the file) ----
const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const name = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const all = midi.tracks.flatMap((t) => t.notes);
const pitches = all.map((n) => n.midi);
const endTick = Math.max(...all.map((n) => n.ticks + n.durationTicks));
const TONE_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
const MAJOR = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const keys = [];
for (const k of [...midi.header.keySignatures].sort((a, b) => a.ticks - b.ticks)) {
  const acc = TONE_KEYS.indexOf(k.key) - 7;
  const label = `${(k.scale === 'minor' ? MINOR : MAJOR)[acc + 7]} ${k.scale}`;
  if (!keys.some((x) => x.tick === k.ticks)) keys.push({ tick: k.ticks, accidentals: acc, mode: k.scale, name: label });
}
const [num, den] = midi.header.timeSignatures[0].timeSignature;
const barTicks = (ppq * 4 * num) / den;
const pedalEvents = midi.tracks.reduce((s, t) => s + (t.controlChanges[64]?.length ?? 0), 0);

// ---- staff mapping validation ----
// LilyPond 2.12 writes one MIDI track per Staff context; the source names them "upper" and "lower".
const trackNames = midi.tracks.map((t) => t.name);
if (trackNames[0] !== 'upper' || trackNames[1] !== 'lower') throw new Error(`Unexpected track names ${trackNames}`);
// Bar arithmetic check against the source's \barNumberCheck / \key commands: the C♯-minor section
// starts at \barNumberCheck#37 and D♭ major returns at \barNumberCheck#43.
const barOf = (tick) => tick / barTicks + 1;
if (barOf(keys[1].tick) !== 37 || barOf(keys[2].tick) !== 43) throw new Error('Key changes do not line up with bars 37/43');

// ---- hand mapping from the per-voice render ----
const handOfVoice = { red: 'R', green: 'R', blue: 'L', grey: 'L' };
const voiceNotes = new Map();
for (const t of voices.tracks) {
  const v = t.name.split(':')[0];
  for (const n of t.notes) {
    const k = `${n.ticks}:${n.midi}`;
    if (!voiceNotes.has(k)) voiceNotes.set(k, new Set());
    voiceNotes.get(k).add(handOfVoice[v]);
  }
}
const handNotes = [];
let shared = 0;
let missing = 0;
const seen = new Set();
for (const n of all) {
  const k = `${n.ticks}:${n.midi}`;
  if (seen.has(k)) continue;
  seen.add(k);
  const hands = voiceNotes.get(k);
  if (!hands) { missing++; continue; }
  if (hands.size > 1) { shared++; continue; }
  handNotes.push([n.ticks, n.midi, [...hands][0]]);
}
if (missing > 0) throw new Error(`${missing} MIDI notes have no counterpart in the voice render`);
handNotes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const crossStaff = midi.tracks.map((t, ti) => t.notes.filter((n) => {
  const h = voiceNotes.get(`${n.ticks}:${n.midi}`);
  return h && h.size === 1 && [...h][0] === (ti === 0 ? 'L' : 'R');
}).length);

const sidecar = {
  id: 'clair-de-lune',
  title: 'Clair de lune',
  subtitle: 'Suite bergamasque, L. 75, No. 3',
  composer: 'Claude Debussy',
  midiFile: 'clair-de-lune.mid',
  sha256,
  provenance: {
    source: 'Mutopia Project, piece 1778 (Mutopia-2010/12/21-1778)',
    catalogUrl: 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1778',
    fileUrl: 'https://www.mutopiaproject.org/ftp/DebussyC/L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.mid',
    license: 'Public Domain',
    edition: 'E. Fromont (1905), plate E. 1404 F.',
    maintainer: 'Keith OHara',
    sha256,
  },
  facts: {
    fileBytes: bytes.length,
    format: 1,
    ppq,
    midiTracks: 'control track + 2 note tracks (@tonejs/midi exposes the 2 note tracks)',
    noteCount: all.length,
    noteCountPerTrack: midi.tracks.map((t) => ({ name: t.name, channel: t.channel + 1, notes: t.notes.length })),
    durationSeconds: midi.duration,
    endTick,
    bars: endTick / barTicks,
    pitchRange: { low: Math.min(...pitches), high: Math.max(...pitches), lowName: name(Math.min(...pitches)), highName: name(Math.max(...pitches)) },
    tempoMap: midi.header.tempos.map((t) => ({ tick: t.ticks, bpm: t.bpm })),
    tempoNote: 'The file has a single tempo event (quarter = 60, i.e. dotted quarter = 40). The textual tempo and rubato markings of the score are not encoded in the MIDI.',
    timeSignatures: midi.header.timeSignatures.map((t) => ({ tick: t.ticks, value: `${t.timeSignature[0]}/${t.timeSignature[1]}` })),
    keySignatures: keys,
    anacrusis: 'none (the piece opens with an eighth rest inside bar 1; bar arithmetic matches \\barNumberCheck in the source)',
    pedal: pedalEvents === 0 ? 'No sustain-pedal (CC64) events in the file; the LilyPond source defines pedal shortcuts but never uses them.' : `${pedalEvents} CC64 events`,
    velocities: [...new Set(all.map((n) => Math.round(n.velocity * 127)))],
  },
  anacrusisTicks: 0,
  tracks: [
    { index: 0, label: 'Upper staff', staff: 'upper', validation: `MIDI track "upper" = LilyPond Staff "upper". ${crossStaff[0]} of its notes belong to left-hand voices written on the upper staff.` },
    { index: 1, label: 'Lower staff', staff: 'lower', validation: `MIDI track "lower" = LilyPond Staff "lower". ${crossStaff[1]} of its notes belong to right-hand voices written on the lower staff.` },
  ],
  textMarks: [
    { bar: 1, text: 'Andante très expressif' },
    { bar: 15, text: 'Tempo rubato' },
    { bar: 19, text: 'peu à peu cresc. et animé' },
    { bar: 27, text: 'Un poco mosso' },
    { bar: 37, text: 'En animant' },
    { bar: 43, text: 'Calmato' },
    { bar: 51, text: 'a Tempo 1º' },
    { bar: 66, text: "morendo jusqu'à la fin" },
  ].map((m) => ({ ...m, tick: (m.bar - 1) * barTicks })),
  handMapping: {
    method: `Traced from the Mutopia LilyPond source: the edition's voices are named rhUp/rhDown (right hand) and lhUp/lhDown (left hand). The source was re-rendered with one MIDI track per voice (scripts/lilypond) and every note of the bundled MIDI was matched by tick and pitch. ${shared} notes are written in both a right- and a left-hand voice (shared noteheads) and are left unassigned. This is the typesetter's voice layout, not fingering.`,
    notes: handNotes,
  },
};

await writeFile(OUT, JSON.stringify(sidecar, null, 1) + '\n');
console.log(`wrote ${OUT}: ${all.length} notes, ${handNotes.length} hand-mapped, ${shared} shared, sha256 ${sha256}`);
