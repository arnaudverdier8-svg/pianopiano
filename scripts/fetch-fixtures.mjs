// Downloads independently recorded piano notes (University of Iowa Electronic Music Studios,
// Steinway model B, 2001 — "may be downloaded and used for any projects, without restrictions")
// and stores short mono excerpts used by the detector benchmark (src/tests/detector).
// Needs ffmpeg on PATH. Run: npm run fetch:fixtures
import { mkdir, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'https://theremin.music.uiowa.edu/sound%20files/MIS/Piano_Other/piano/';
const OUT = 'fixtures/audio/uiowa';
const RATE = 44100;
const SECONDS = 2.0;
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const nameOf = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

const jobs = [];
for (let m = 36; m <= 96; m++) jobs.push(['mf', m]); // C2..C7 at mezzo-forte
for (const m of [29, 31, 33, 34]) jobs.push(['mf', m]); // a few low bass notes (F1..Bb1)
for (const m of [48, 53, 56, 60, 61, 65, 68, 72, 77, 80]) jobs.push(['pp', m]); // quiet playing

function toWav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

async function one([dyn, midi]) {
  const file = `Piano.${dyn}.${nameOf(midi)}`;
  const dest = join(OUT, `${file}.wav`);
  try { await access(dest); return; } catch { /* fetch it */ }
  const res = await fetch(`${BASE}${file}.aiff`);
  if (!res.ok) { console.warn(`skip ${file}: HTTP ${res.status}`); return; }
  const tmp = join(tmpdir(), `${file}.aiff`);
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', tmp, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  let peak = 0; for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  // The recordings start with silence; cut from 30 ms before the first sample above 10% of peak.
  let onset = pcm.findIndex((v) => Math.abs(v) > peak * 0.1);
  onset = Math.max(0, onset - Math.round(0.03 * RATE));
  const excerpt = pcm.slice(onset, onset + Math.round(SECONDS * RATE));
  // Normalise quiet and loud files alike to a -12 dBFS peak; the dynamic still shows in the timbre.
  const gain = 0.25 / Math.max(1e-9, peak);
  await writeFile(dest, toWav(excerpt.map((v) => v * gain)));
  console.log('saved', dest);
}

await mkdir(OUT, { recursive: true });
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()); }));
console.log(`${jobs.length} fixture notes requested`);
