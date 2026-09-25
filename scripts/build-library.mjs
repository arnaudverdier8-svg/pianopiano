// Builds the practice library: copies the chosen Mutopia MIDI files into public/songs/library/,
// records each piece's licence and catalogue page (re-read from Mutopia's piano listing, politely),
// and writes public/songs/library.json with a SHA-256 per file.
// Source files come from a local download (default ~/Music/mutopia-piano-midi, see manifest.json there).
// Run: node scripts/build-library.mjs [sourceDir]
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const SRC = process.argv[2] ?? join(process.env.HOME, 'Music', 'mutopia-piano-midi');
const OUT = 'public/songs/library';
const FILES = [
  'fur_Elise_WoO59.mid', 'pathetique-1.mid', 'pathetique-2.mid', 'LVB_Sonate_57_2.mid', 'LVB_Sonate_02no1_1.mid',
  'beethoven_fifth_op67.mid', 'beethoven_rondo_op129.mid', 'debussy_Arabesque_2.mid', 'debussy_Arabesque_1.mid',
  'gymnopedie_1.mid', 'gymnopedie_2.mid', 'gymnopedie_3.mid', 'chopin_fantaisie-impromptu.mid', 'chopin_valse_op64_no1.mid',
  'nocturne_in_b-flat_minor.mid', 'nocturne_in_e_minor.mid', 'chopin-nocturne-8.mid', 'Chop-28-4.mid', 'Chop-28-15.mid',
  'Chop-28-20.mid', 'Chop-28-7.mid', 'Mazurka-Op33-No1.mid', 'TroisNouvellesEtudes_Chopin_n1.mid', 'KV331_3_RondoAllaTurca.mid',
  'k453a.mid', 'SchubertF-D839_AveMaria.mid', 'rach-prelude-op3-no2.mid', 'rach-prelude23-05.mid', 'rach-prelude23-02.mid',
  'maple.mid', 'entertainer.mid', 'solace.mid', 'blue_danube.mid', 'prelude.mid', 'AveMaria-PianoViolin.mid', 'troldhaugen.mid',
  'liszt-consolation-no3.mid', 'liszt-consolation-no4.mid', 'wtk1-prelude1.mid', 'wtk1-fugue1.mid', 'bwv847a.mid',
  'bach-invention-01.mid', 'bach-invention-08.mid', 'bach-invention-13.mid', 'BWV-120.mid', 'waltz-op39-15.mid',
  'waltz-op39-10.mid', 'schumann-op68-14-petite-etude.mid', '04-toccata.mid',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();

// Licence and catalogue id per .mid URL, from the piano listing.
async function scanLicences() {
  const out = new Map();
  for (let start = 0; ; start += 10) {
    const url = `https://www.mutopiaproject.org/cgibin/make-table.cgi?startat=${start}&searchingfor=&Composer=&Instrument=Piano&Style=&collection=&id=&solo=&recent=&timelength=&timeunit=&lilyversion=&preview=`;
    const html = await (await fetch(url, { headers: { 'User-Agent': 'moonlight-library-builder/1.0' } })).text();
    for (const block of html.split('<table class="table-bordered result-table">').slice(1)) {
      const mid = block.match(/href="(https:\/\/www\.mutopiaproject\.org\/ftp\/[^"]+\.mid)"/)?.[1];
      const id = block.match(/piece-info\.cgi\?id=(\d+)/)?.[1];
      const lic = block.match(/<a href="[^"]*legal\.html[^"]*">([^<]+)<\/a>/)?.[1];
      if (mid) out.set(mid, { id, license: lic ? decode(lic) : null });
    }
    if (!/Next 10<\/a>/.test(html)) break;
    await sleep(500);
  }
  return out;
}

const manifest = JSON.parse(await readFile(join(SRC, 'manifest.json'), 'utf8'));
const byFile = new Map(manifest.map((m) => [m.localFile, m]));
const licences = await scanLicences();
await mkdir(OUT, { recursive: true });
const entries = [];
for (const f of FILES) {
  const m = byFile.get(f);
  if (!m || m.status !== 'ok') throw new Error(`${f}: not in the local download`);
  const bytes = await readFile(join(SRC, f));
  const info = licences.get(m.midUrl);
  if (!info?.license) throw new Error(`${f}: licence not found on Mutopia`);
  await copyFile(join(SRC, f), join(OUT, f));
  const composer = m.composer.replace(/\s*\(.*\)\s*$/, '');
  entries.push({
    id: `mutopia-${info.id}`,
    title: m.title,
    composer,
    composerFull: m.composer,
    file: `library/${f}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: `Mutopia Project, piece ${info.id}`,
    catalogUrl: `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${info.id}`,
    fileUrl: m.midUrl,
    license: info.license,
  });
}
await writeFile('public/songs/library.json', JSON.stringify(entries, null, 1) + '\n');
console.log(`${entries.length} pieces written. Licences:`, [...new Set(entries.map((e) => e.license))]);
