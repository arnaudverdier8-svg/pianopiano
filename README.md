# MOONLIGHT

Piano practice that listens. Notes fall towards a line. In Learn mode they stop there and wait until the microphone hears you play them on your own acoustic piano. It ships with Debussy's *Clair de lune* (Mutopia Project #1778, public domain) and a library of 49 more piano pieces from the Mutopia Project (Beethoven, Chopin, Bach, Satie, Joplin…), chosen from the piece picker in the header. Library pieces have no validated hand mapping, so practise them by track or with both hands.

Everything runs locally in the browser. There are no accounts, servers or uploads, and nothing is recorded. The microphone is analysed in a Web Worker on your computer and released when you turn it off or close the tab.

## Start

Needs Node.js 20+ and Chrome or Edge.

```bash
npm install
npm run dev
```

Open http://localhost:5173 in its own tab. An embedded preview may block the microphone. Click **Set up the microphone** and follow the four steps. Or click **Try without a microphone** to practise in Manual mode, where Space advances each chord.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 5173 |
| `npm test` | Unit, engine and recognition-benchmark tests (Vitest) |
| `npm run test:e2e` | Browser tests in Chromium with a fake microphone (Playwright; muted) |
| `npm run build` / `npm run preview` | Type-check, production build, serve the build locally |
| `npm run bench:detector` | Recognition benchmark only; rewrites `docs/benchmark-results.{json,md}` |
| `npm run inspect:song [-- file.mid]` | Print a MIDI file's facts straight from the file |
| `npm run fetch:song` / `fetch:samples` / `fetch:fixtures` | Re-download the bundled piece (hash-checked), the playback samples, or the test recordings (needs ffmpeg) |

For the browser tests, Playwright uses `/usr/bin/chromium` when present, or `MOONLIGHT_CHROMIUM=/path`. Otherwise run `npx playwright install chromium` once.

## Using it

- **Modes**:
  - **Learn**: waits at each chord for every note.
  - **Listen**: the app plays and nothing is scored.
  - **Single note**: a labelled practice aid that waits only for the top note of each chord.
  - **Manual**: no listening. Space advances, and each chord is recorded as *manual*.
- **Part**: right hand, left hand, both, upper or lower staff, or any MIDI track. Notes that aren't yours stay visible, drawn dimmed.
- **Transport**: start/pause, restart, bar-by-bar seek, a position slider, tempo 25–150%, an A–B loop (set at the cursor or by bar numbers), and **Hear passage** (plays the next two bars).
- **Feedback** never relies on colour alone:
  - Gate notes are hollow until heard.
  - ✓ means heard clearly, ~ means it overlaps another note's overtones, ≈ means an octave was accepted on the lower note, ? means uncertain, ↺ means played too early.
  - Wrong notes appear as a rose dot on the key. The status line says what is missing, for example "Heard F5 · waiting for D♭5".
- **Keyboard view**: piece range or all 88 keys. Pan by octave and zoom. The strip at the top always shows all 88 keys. Notes outside the view are counted at the edge ("◀ 3 below view · E♭1"), never silently dropped.
- **Shortcuts**: press `?`. Space continues past the chord at the line. K starts and pauses. ←/→ move by bar, ↑/↓ change tempo, A/B/X set or clear the loop, H plays the passage, M toggles the mic, 1–4 pick the mode.
- **Open MIDI** or drag a `.mid` file onto the window (8 MB limit). Imported files have no validated hand mapping, so choose tracks instead.
- **Diagnostics** (D) shows engine state, tone-by-tone evidence, the negotiated microphone processing, levels, measured timing and the detector's stated limits.

Settings, the position in each piece, the loop and a short practice history (what was played and how each chord was resolved, not a score) are kept in this browser's localStorage.

## What works, what is experimental

**Works and is tested**:
- MIDI parsing with tempo map, meters, bars, keys and key-aware spelling.
- The hand/staff mapping of the bundled piece, derived from the LilyPond voices. 10 shared noteheads are left unassigned and are never guessed.
- The wait-for-notes engine: exact freeze at the gate, no catch-up, rolled-chord window, fresh re-attack for repeated notes, stale-evidence expiry, generation IDs across seek/loop/pause.
- Manual mode, loops, tempo, persistence, MIDI import and errors, and the missing-song state.
- Microphone errors: unsupported, insecure, denied, no device, busy, iframe-blocked.
- The whole capture path in Chromium: AudioWorklet → worker → resampler → detector → engine.

**Experimental**: polyphonic recognition from a single microphone. Measured on independently recorded piano notes mixed in software (`docs/benchmark-results.md`):

| Case | Result |
| --- | --- |
| Single notes (75, mf and pp, F1–C7) | 74 advance their gate. Attack → decision median 97 ms, p90 143 ms |
| Chords (24) | 15 advance, 12 of them with every tone clearly heard. The misses are mostly octave doublings and bass tones inside dense chords |
| Partial chords (a tone missing, 67) | 4 wrongly accepted, all involving an octave doubling |
| Wrong notes (semitone off) / octave errors | 0 of 24 / 0 of 22 wrongly accepted |
| Repeated notes, new note over a held one, silence, room noise | All pass their checks |

Known limits, also shown in the app:
- The upper note of an octave cannot be reliably told apart from the lower note's second partial. Settings → *Octave doublings* can accept it on the lower note, marked ≈ (inferred, not heard).
- Laptop microphones capture bass fundamentals weakly. Settings → *Bass octave tolerance* is off by default.
- Loud rooms, voices and other instruments produce false evidence.

When recognition is unsure, the chord does not advance. The status line asks you to play again or press Space. It never pretends.

**Latency**: the benchmark numbers run from the attack in the recording to the analysis frame that satisfies the gate. In headless Chromium with a fake device, the Diagnostics panel showed a median of about 110 ms from attack to decision (4 samples). Real microphone and driver input latency comes on top. It cannot be measured from inside the browser and was not measured on real hardware.

## The app must not hear itself

- Practice is silent by default.
- Listen mode turns matching off.
- **Hear passage** pauses matching, plays, stops, clears the evidence queue, then waits until the input falls back to the room's noise level (up to 6 s) before listening again.
- **Accompaniment** is opt-in and requires ticking "I am using headphones". The app's own notes are also filtered out by pitch and time, and internal playback never counts as evidence.

## Microphone privacy and setup

Permission is requested only after you click. MOONLIGHT asks for mono audio with echo cancellation, noise suppression and automatic gain control **off**. It shows what the browser actually applied, and warns if a setting stayed on.

Audio is resampled explicitly to 22 050 Hz in the worker. The setup flow measures room noise, listens to a few suggested notes (A♭3, F4, D♭5, D♭2), reports strength, clipping and whether each note was recognised, and estimates your piano's tuning offset in cents.

## Recognition design, and why not Basic Pitch

The detector (`src/audio/detector/`) sits behind a small replaceable interface (`Detector`) and never sees the score. How it works:
- It builds a log-frequency spectrum at two FFT resolutions.
- It holds a dictionary of 88 piano-note templates. The partial balance was learned from the Salamander recordings, with stiff-string inharmonicity.
- A sparse non-negative fit runs twice per 23 ms frame: once on what is sounding, once on the new energy (the attack).
- Each candidate gets a leave-one-out uniqueness test, a relative-to-level gate, a broadband-transient check, confirmation two frames later, and an explicit harmonic-parent flag.

The score is used only afterwards, by the matcher (`src/practice/matcher.ts`). It decides which of the *expected* notes the evidence supports. It compares octave, harmonic and wrong-note alternatives, and has an *uncertain* outcome.

[Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Spotify, Apache-2.0) was evaluated from its source and documentation. It was **not** benchmarked on these fixtures. Reasons it was not adopted:
- It analyses 2-second windows (43 844 samples at 22 050 Hz) and trims 15 of 30 overlapping frames on each side. A note therefore needs about 170 ms of audio *after* it before it is reported, plus hop and inference time. That leaves little room in a 300 ms budget.
- Streaming it means re-running the network on overlapping 2 s windows continuously, on TensorFlow.js 3 in the browser.
- It outputs score-agnostic notes, so the same octave and partial problems would still have to be solved in the matcher.

Plugging it in would take one new `Detector` implementation, measured with the existing benchmark.

## Human checklist (needs your piano)

None of these have been performed. They need a real piano, a real microphone and a person.

- [ ] **Not performed**: grant microphone permission in Chrome and in Edge. The pill shows *Listening* and the level meter moves when you play.
- [ ] **Not performed**: Setup, room noise: the measured level matches the room (quiet room below −60 dBFS).
- [ ] **Not performed**: Setup, test notes: A♭3, F4 and D♭5 are recognised. Note the D♭2 result and the tuning estimate.
- [ ] **Not performed**: Learn, right hand, bars 1–4 at 60%: each chord advances when played, and not before.
- [ ] **Not performed**: playing a wrong note keeps the gate closed, and the status names the missing note.
- [ ] **Not performed**: play a chord slowly rolled (under 0.4 s) and one clearly broken: the first advances, the second shows ↺.
- [ ] **Not performed**: a repeated note needs a second key press, and holding the key is not enough.
- [ ] **Not performed**: the octave passages (from bar 15) behave as documented, with *Octave doublings* set to strict and to lenient.
- [ ] **Not performed**: left hand and both hands, including the low D♭s: try *Bass octave tolerance* if the bass is missed.
- [ ] **Not performed**: Hear passage through laptop speakers: no chord advances by itself during or after playback.
- [ ] **Not performed**: accompaniment with headphones: the other hand plays and only your playing advances the gates.
- [ ] **Not performed**: perceived delay between key press and the note turning ✓. Compare with the Diagnostics timing.
- [ ] **Not performed**: unplug a USB microphone mid-session: the mic pill turns to *Mic unavailable* and explains what happened.
- [ ] **Not performed**: a noisy room (fan, conversation): count false advances over one minute.

## Project layout

```
src/music/       MIDI parsing, tempo/meter/bars, key-aware spelling, practice events
src/practice/    transport, gate matcher, practice engine (pure, deterministic)
src/audio/       capture worklet, analysis worker, resampler, FFT, detector
src/playback/    sampled piano and look-ahead scheduler (same clock as the transport)
src/app/         controller, canvas renderer, React components
src/storage/     settings and practice history (localStorage)
src/tests/       Vitest suites and Playwright specs (src/tests/e2e)
scripts/         fetch scripts, sidecar builder, LilyPond voice derivation
docs/            benchmark results
```

This app is for local use and is not deployed anywhere. Third-party material and licences: see `THIRD_PARTY_NOTICES.md`.
