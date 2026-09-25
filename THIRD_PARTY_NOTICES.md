# Third-party material

## Music: Clair de lune (Claude Debussy)

- File: `public/songs/clair-de-lune.mid`
- Source: The Mutopia Project, piece 1778 (Mutopia-2010/12/21-1778)
  - Catalogue: https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1778
  - File: https://www.mutopiaproject.org/ftp/DebussyC/L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.mid
- Edition: E. Fromont (1905), plate E. 1404 F. Typeset by Keith OHara.
- Licence: **Public Domain** (as stated by the Mutopia Project).
- SHA-256: `4eee9a1546ffde1ff74cb9824ba0e57cbc821185a15185bfea9faed97820bf8c`
- The MIDI file is bundled unmodified. `npm run fetch:song` re-downloads it and checks this hash.
- `scripts/lilypond/debussy_Ste_Bergamesq_Clair.ly` is the Mutopia LilyPond source of the same piece (Public Domain). `scripts/lilypond/clair-de-lune.voices.mid` was rendered from it with LilyPond 2.24 (one track per voice). It is used only to derive the hand mapping in `public/songs/clair-de-lune.json`.

## Music: practice library (49 pieces)

- Files: `public/songs/library/*.mid`, listed with checksums in `public/songs/library.json` (built by `scripts/build-library.mjs`).
- All from the Mutopia Project. Each piece keeps the licence its typesetter chose. Files are bundled unmodified.
- Creative Commons pieces are credited to the Mutopia Project and its contributors; each catalogue page names the typesetter.

| Composer | Piece | Licence | Source |
| --- | --- | --- | --- |
| L. V. Beethoven | Für Elise | Public Domain | [Mutopia Project, piece 931](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931) |
| L. V. Beethoven | Sonata No. 8 “Pathétique” (1st Movement: Grave, Allegro molto e con brio) | Public Domain | [Mutopia Project, piece 299](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=299) |
| L. V. Beethoven | Sonata No. 8 “Pathétique” (2nd Movement: Adagio cantabile) | Public Domain | [Mutopia Project, piece 295](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=295) |
| L. V. Beethoven | Sonata No. 23 “Appassionata” (2nd Movement: Andante con moto) | Public Domain | [Mutopia Project, piece 288](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=288) |
| L. V. Beethoven | Sonata No. 1 (1st Movement: Allegro) | Public Domain | [Mutopia Project, piece 1211](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1211) |
| L. V. Beethoven | Symphony no. 5, Piano reduction | Public Domain | [Mutopia Project, piece 497](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=497) |
| L. V. Beethoven | Rondo A Capriccio | Public Domain | [Mutopia Project, piece 498](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=498) |
| C. Debussy | Deuxième Arabesque | Creative Commons Attribution-ShareAlike 4.0 | [Mutopia Project, piece 1994](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1994) |
| C. Debussy | Première Arabesque | Public Domain | [Mutopia Project, piece 1777](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1777) |
| E. Satie | Gymnopédie No. 1 | Public Domain | [Mutopia Project, piece 37](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=37) |
| E. Satie | Gymnopédie No. 2 | Public Domain | [Mutopia Project, piece 38](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=38) |
| E. Satie | Gymnopédie No. 3 | Public Domain | [Mutopia Project, piece 39](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=39) |
| F. F. Chopin | Fantaisie-Impromptu | Public Domain | [Mutopia Project, piece 1693](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1693) |
| F. F. Chopin | Valse Op. 64, No. 1 ('Minute Waltz') | Public Domain | [Mutopia Project, piece 483](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=483) |
| F. F. Chopin | Nocturne No. 1 in B-flat minor | Creative Commons Attribution-ShareAlike 2.5 | [Mutopia Project, piece 582](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=582) |
| F. F. Chopin | Nocturne No. 19 in E minor | Creative Commons Attribution-ShareAlike 4.0 | [Mutopia Project, piece 509](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=509) |
| F. F. Chopin | Nocturne 8 in Db Major | Creative Commons Attribution-ShareAlike 3.0 | [Mutopia Project, piece 486](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=486) |
| F. F. Chopin | Prelude: Op. 28, No. 4 ('Suffocation') | Public Domain | [Mutopia Project, piece 468](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=468) |
| F. F. Chopin | Prelude: Op. 28, No. 15 | Public Domain | [Mutopia Project, piece 471](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=471) |
| F. F. Chopin | Prelude: Op. 28, No. 20 | Public Domain | [Mutopia Project, piece 472](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=472) |
| F. F. Chopin | Prelude: Op. 28, No. 7 | Public Domain | [Mutopia Project, piece 470](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=470) |
| F. F. Chopin | Mazurka: Op.33, No.1 | Creative Commons Attribution 3.0 | [Mutopia Project, piece 1682](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1682) |
| F. F. Chopin | Trois Nouvelles Etudes, No. 1 F Minor | Public Domain | [Mutopia Project, piece 1895](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1895) |
| W. A. Mozart | Sonate Opus KV 331 - Rondo Alla Turca | Public Domain | [Mutopia Project, piece 108](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=108) |
| W. A. Mozart | Fugue in G Minor KV 401/375e | Public Domain | [Mutopia Project, piece 446](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=446) |
| F. Schubert | Ave Maria (Ellens dritter Gesang) | Public Domain | [Mutopia Project, piece 1054](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1054) |
| S. Rachmaninoff | Prelude in C# minor | Creative Commons Attribution-ShareAlike 4.0 | [Mutopia Project, piece 2033](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2033) |
| S. Rachmaninoff | Prelude Op. 23, No. 5 | Creative Commons Attribution-ShareAlike 4.0 | [Mutopia Project, piece 2001](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2001) |
| S. Rachmaninoff | Prelude Op. 23, No. 2 | Creative Commons Attribution-ShareAlike 4.0 | [Mutopia Project, piece 1960](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1960) |
| S. Joplin | Maple Leaf Rag | Public Domain | [Mutopia Project, piece 23](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=23) |
| S. Joplin | The Entertainer | Public Domain | [Mutopia Project, piece 263](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=263) |
| S. Joplin | Solace | Public Domain | [Mutopia Project, piece 482](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=482) |
| J. Strauss Jr. | The Blue Danube Waltz (main theme) | Creative Commons Attribution-ShareAlike 4.0 | [Mutopia Project, piece 519](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=519) |
| A. Scriabin | Prelude | Public Domain | [Mutopia Project, piece 445](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=445) |
| C. Gounod | Ave Maria: Meditation on the First Prelude in C by J. S. Bach | Public Domain | [Mutopia Project, piece 2167](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2167) |
| E. Grieg | Wedding-day at Troldhaugen | Public Domain | [Mutopia Project, piece 781](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=781) |
| F. Liszt | Consolation, S.172 No.3 | Creative Commons Attribution 3.0 | [Mutopia Project, piece 1647](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1647) |
| F. Liszt | Consolation, S.172 No.4 | Creative Commons Attribution 3.0 | [Mutopia Project, piece 1650](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1650) |
| J. S. Bach | Das Wohltemperierte Clavier I, Praeludium I | Public Domain | [Mutopia Project, piece 5](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5) |
| J. S. Bach | Das Wohltemperierte Clavier I, Fuga I | Public Domain | [Mutopia Project, piece 4](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=4) |
| J. S. Bach | Das Wohltemperierte Clavier I, Praeludium II | Public Domain | [Mutopia Project, piece 550](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=550) |
| J. S. Bach | Invention 1 | Creative Commons Attribution-ShareAlike 3.0 | [Mutopia Project, piece 40](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=40) |
| J. S. Bach | Invention 8 | Public Domain | [Mutopia Project, piece 61](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=61) |
| J. S. Bach | Invention 13 | Public Domain | [Mutopia Project, piece 59](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=59) |
| J. S. Bach | Minuet in A minor | Public Domain | [Mutopia Project, piece 1612](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1612) |
| J. Brahms | Waltz No. 15 | Public Domain | [Mutopia Project, piece 794](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=794) |
| J. Brahms | Waltz No. 10 | Public Domain | [Mutopia Project, piece 2164](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2164) |
| R. Schumann | Album pour la jeunesse - 14.Petite Etude | Creative Commons Attribution-ShareAlike 2.5 | [Mutopia Project, piece 786](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=786) |
| G. F. Handel | Toccata | Public Domain | [Mutopia Project, piece 152](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=152) |

## Playback samples: Salamander Grand Piano

- Files: `public/samples/salamander/*.mp3` (30 samples, every minor third)
- Author: Alexander Holm. Licence: **Creative Commons Attribution 3.0** (https://creativecommons.org/licenses/by/3.0/)
- Obtained from the copies hosted by the Tone.js project (https://tonejs.github.io/audio/salamander/) via `npm run fetch:samples`.
- The same recordings were used, offline, to learn the detector's partial-amplitude profiles (`src/audio/detector/partial-profiles.ts`, generated by `scripts/learn-profiles.mjs`).

## Test recordings: University of Iowa Musical Instrument Samples

- Files: `fixtures/audio/uiowa/*.wav` (75 notes, Steinway model B, mf and pp). These are short mono excerpts, trimmed and normalised by `scripts/fetch-fixtures.mjs`.
- Source: University of Iowa Electronic Music Studios, https://theremin.music.uiowa.edu/MIS.html
- Terms: the site states the samples “may be downloaded and used for any projects, without restrictions”.
- Used only for tests and benchmarks. They are not shipped in the app bundle.

## Software

Runtime dependencies (installed through npm, see `package-lock.json`):

- React and React DOM: MIT licence
- @tonejs/midi: MIT licence

Development dependencies (Vite, TypeScript, Vitest, Playwright and others) keep their own licences in `node_modules`.
