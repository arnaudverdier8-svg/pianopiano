// Re-downloads the bundled Clair de lune MIDI from Mutopia and verifies it against the recorded SHA-256.
// The app never downloads it at runtime; this exists so the asset is reproducible.
//   npm run fetch:song
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const URL = 'https://www.mutopiaproject.org/ftp/DebussyC/L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.mid';
const DEST = 'public/songs/clair-de-lune.mid';
const EXPECTED = JSON.parse(await readFile('public/songs/clair-de-lune.json', 'utf8').catch(() => '{}')).sha256;

let res;
try {
  res = await fetch(URL);
} catch (e) {
  console.error(`Download blocked: ${e.message}\nDownload ${URL} manually and save it as ${DEST}.`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status} from ${URL}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
if (buf.subarray(0, 4).toString('latin1') !== 'MThd') {
  console.error('Downloaded file is not a MIDI file (no MThd header). Not saved.');
  process.exit(1);
}
const sha = createHash('sha256').update(buf).digest('hex');
if (EXPECTED && sha !== EXPECTED) {
  console.error(`SHA-256 mismatch: got ${sha}, expected ${EXPECTED}. The upstream file changed; not overwriting.`);
  process.exit(1);
}
await writeFile(DEST, buf);
console.log(`saved ${DEST} (${buf.length} bytes, sha256 ${sha})`);
