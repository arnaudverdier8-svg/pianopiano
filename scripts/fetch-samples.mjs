// Fetches the Salamander Grand Piano samples (CC-BY 3.0, Alexander Holm) that Tone.js hosts,
// so playback works offline. Run: npm run fetch:samples
import { mkdir, writeFile, access } from 'node:fs/promises';
const BASE = 'https://tonejs.github.io/audio/salamander/';
const names = ['A0'];
for (let o = 1; o <= 7; o++) for (const n of ['C', 'Ds', 'Fs', 'A']) names.push(`${n}${o}`);
names.push('C8');
await mkdir('public/samples/salamander', { recursive: true });
for (const n of names) {
  const dest = `public/samples/salamander/${n}.mp3`;
  try { await access(dest); continue; } catch { /* download */ }
  const res = await fetch(BASE + n + '.mp3');
  if (!res.ok) throw new Error(`${n}: HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log('saved', dest);
}
console.log(`${names.length} samples present`);
