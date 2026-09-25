# Recognition benchmark

Generated 2026-09-25T01:18:28.110Z by `npm run bench:detector` (`src/tests/detector/benchmark.test.ts`).

Detector `nnls-harmonic-v1` with the app's default matcher settings. Every case asks the question the app asks: *would this gate advance within 1 s of the attack?* Audio passes through the real path: 128-sample quanta at 44.1 kHz, explicit resampling to 22.05 kHz, the detector, then the GateMatcher.

Source: University of Iowa Musical Instrument Samples, Steinway B (mf and pp), mono 44.1 kHz. Independent of the Salamander samples used to learn the detector templates.

Latency is measured from the attack in the recording to the analysis frame that satisfies the gate. It does **not** include the microphone/driver input latency or the display frame; these add roughly 10–40 ms on typical hardware and cannot be measured from inside the browser.

These are recorded single notes mixed in software, not a live room. Real-room performance with a laptop microphone has **not** been measured. See the human checklist in the README.

## Single notes
```json
{
  "cases": 75,
  "advanced": 74,
  "rate": 0.9866666666666667,
  "latencyMedianMs": 97,
  "latencyP90Ms": 143,
  "misses": [
    "B2 mf"
  ]
}
```

## Chords
```json
{
  "cases": 24,
  "advanced": 15,
  "advancedAllTonesClearlyHeard": 12,
  "latencyMedianMs": 143,
  "latencyP90Ms": 190,
  "notAdvanced": [
    "A♭3+C4+E♭4+A♭4",
    "C♯4+C♯5",
    "C♯2+C♯3",
    "C3+E3+G3",
    "C4+E4+G4+C5",
    "F♯3+C♯4+F♯4+B♭4",
    "E♭4+B♭4+E♭5",
    "C♯3+A♭3+F4",
    "E♭2+B♭3+E♭4"
  ]
}
```

## Partial chords (a tone missing, must not advance)
```json
{
  "cases": 67,
  "falselyAccepted": 4,
  "rate": 0.05970149253731343,
  "falseCases": [
    "C♯3 accepted for C♯3+C♯4",
    "A♭4 accepted for A♭4+A♭5",
    "F2+F3+C4 accepted for F2+F3+C4+F4",
    "E♭4+B♭4 accepted for E♭4+B♭4+E♭5"
  ]
}
```

## Wrong notes (semitone neighbour, must not advance)
```json
{
  "cases": 24,
  "falselyAccepted": 0
}
```

## Octave errors (octave above/below, must not advance)
```json
{
  "cases": 22,
  "falselyAccepted": 0,
  "falseCases": []
}
```

## Repeated notes
```json
{
  "cases": 4,
  "bothStrikesAdvance": 4,
  "sustainFalselyAdvancesSecond": 0
}
```

## New note over a sustained note
```json
{
  "cases": 5,
  "advanced": 5
}
```

## Silence and noise (confident onsets)
```json
{
  "silence10s": 0,
  "pinkMinus45dB10s": 1,
  "whiteMinus50dB10s": 0
}
```

## Notes in room noise
```json
{
  "cases": 17,
  "advanced": 17,
  "noise": "pink, −45 dBFS RMS (notes peak at −12 dBFS)"
}
```
