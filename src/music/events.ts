import { barAtTick } from './meter';
import type { PartSelection, PracticeEvent, Song, SongNote } from './types';

/**
 * Onsets closer than this are one chord. It is deliberately tiny (1/48 of a quarter note, at least 2 ticks):
 * quantized files put chord tones on the same tick, and an arpeggio of 16ths or 32nds stays separate events.
 * A human-performed MIDI whose chord tones are spread wider simply becomes consecutive events, which the
 * matcher's early-input tolerance lets the player satisfy with one chord.
 */
export function chordToleranceTicks(ppq: number): number {
  return Math.max(2, Math.round(ppq / 48));
}

export function isSelected(note: SongNote, sel: PartSelection): boolean {
  switch (sel.kind) {
    case 'all':
      return true;
    case 'tracks':
      return sel.tracks.includes(note.track);
    case 'hand':
      return note.hand === sel.hand;
  }
}

export function describeSelection(song: Song, sel: PartSelection): string {
  switch (sel.kind) {
    case 'all':
      return 'Both hands';
    case 'hand':
      return sel.hand === 'right' ? 'Right hand' : 'Left hand';
    case 'tracks':
      return sel.tracks.map((t) => song.tracks[t]?.label ?? `Track ${t + 1}`).join(' + ') || 'No track';
  }
}

/** Groups the selected notes into gates. Rests are gaps between events; nothing is merged across them. */
export function buildEvents(song: Song, sel: PartSelection): PracticeEvent[] {
  const tol = chordToleranceTicks(song.ppq);
  const notes = song.notes.filter((n) => isSelected(n, sel));
  const events: PracticeEvent[] = [];
  let current: { tick: number; notes: SongNote[] } | null = null;
  const flush = () => {
    if (!current) return;
    const pitches = [...new Set(current.notes.map((n) => n.pitch))].sort((a, b) => a - b);
    events.push({
      index: events.length,
      tick: current.tick,
      time: current.notes[0]!.time,
      pitches,
      noteIds: current.notes.map((n) => n.id),
      bar: barAtTick(song.bars, current.tick).number,
    });
  };
  for (const n of notes) {
    // Compare against the group's first onset, never the previous note, so a fast run cannot chain into one chord.
    if (current && n.tick - current.tick <= tol) current.notes.push(n);
    else {
      flush();
      current = { tick: n.tick, notes: [n] };
    }
  }
  flush();
  return events;
}

/** First event whose time is >= t (binary search); events.length when past the end. */
export function eventIndexAtOrAfter(events: PracticeEvent[], time: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.time < time - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
