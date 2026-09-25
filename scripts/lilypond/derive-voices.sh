#!/usr/bin/env bash
# Re-renders the Mutopia LilyPond source with one MIDI track per *voice* instead of per staff,
# so every note of the bundled MIDI can be traced to the edition's voices
# (rhUpRed, rhDownGreen = right hand; lhUpBlue, lhDownGrey = left hand).
# Output: scripts/lilypond/clair-de-lune.voices.mid (committed, so this only needs re-running to audit).
# Needs LilyPond 2.24 (https://lilypond.org/download.html): LILYPOND=/path/to/bin ./derive-voices.sh
set -euo pipefail
cd "$(dirname "$0")"
BIN="${LILYPOND:-$(dirname "$(command -v lilypond)")}"
work="$(mktemp -d)"
cp debussy_Ste_Bergamesq_Clair.ly "$work/voice.ly"
"$BIN/convert-ly" -e "$work/voice.ly" >/dev/null 2>&1
python3 - "$work/voice.ly" <<'PY'
import sys
p = sys.argv[1]; src = open(p).read()
i = src.index('\\midi'); j = src.index('{', i)
src = src[:j+1] + '\n    \\context { \\Staff \\remove "Staff_performer" }\n    \\context { \\Voice \\consists "Staff_performer" }\n' + src[j+1:]
open(p, 'w').write(src)
PY
(cd "$work" && "$BIN/lilypond" -dno-print-pages -s voice.ly)
cp "$work/voice.midi" clair-de-lune.voices.mid
echo "wrote scripts/lilypond/clair-de-lune.voices.mid"
