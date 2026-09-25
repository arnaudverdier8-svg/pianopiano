import { isSelected } from '../music/events';
import { isBlackKey, noteName } from '../music/spelling';
import type { PartSelection, Song, SongNote } from '../music/types';
import type { ResolutionKind, ToneState } from '../practice/types';
import { layoutKeyboard, PIANO_HIGH, PIANO_LOW, type KeyboardLayout } from './keyboard';

export const COLORS = {
  bg: '#141519',
  lane: '#18191e',
  laneBlack: '#121317',
  grid: 'rgba(236, 228, 210, 0.07)',
  gridStrong: 'rgba(236, 228, 210, 0.16)',
  text: '#e9e3d4',
  textDim: '#8d8a83',
  right: '#7fb3e8',
  left: '#b7a5ea',
  other: '#5c6070',
  ivory: '#f2ebdb',
  ivoryShade: '#d9d0bd',
  ebony: '#25262c',
  strike: '#f2ebdb',
  heard: '#f0c96a',
  warn: '#e8a15a',
  wrong: '#e6817f',
  loop: '#8fd4ae',
};

export function handColor(n: SongNote, colorBy: 'hand' | 'track'): string {
  if (colorBy === 'hand' && n.hand) return n.hand === 'right' ? COLORS.right : COLORS.left;
  return n.track % 2 === 0 ? COLORS.right : COLORS.left;
}

export interface RollInput {
  song: Song;
  part: PartSelection;
  songTime: number;
  lookahead: number;
  view: [number, number];
  labels: boolean;
  colorBy: 'hand' | 'track';
  /** Pitches of the current gate with their state (empty in Listen mode). */
  gateTime: number | null;
  gatePitches: number[];
  tones: ToneState[];
  waiting: boolean;
  extraNotes: number[];
  resolved: Map<number, ResolutionKind>;
  /** Recent microphone onsets: pitch, age in seconds, confidence, and whether it passed the accept threshold. */
  onsets: { pitch: number; age: number; accepted: boolean }[];
  sounding: { pitch: number; level: number }[];
  loop: { a: number; b: number } | null;
  keyAccidentalsAt: (tick: number) => number;
  reducedMotion: boolean;
  now: number;
}

export interface RollGeometry {
  overviewH: number;
  rollTop: number;
  strikeY: number;
  keyboardH: number;
  layout: KeyboardLayout;
}

export function geometry(width: number, height: number, view: [number, number]): RollGeometry {
  const overviewH = 28;
  const keyboardH = Math.round(Math.max(70, Math.min(130, height * 0.17)));
  const strikeY = height - keyboardH;
  return { overviewH, rollTop: overviewH + 2, strikeY, keyboardH, layout: layoutKeyboard(view[0], view[1], width) };
}

/** First note index with time ≥ t − maxDuration window (notes are sorted by time). */
function firstIndexFrom(notes: SongNote[], t: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const TONE_SYMBOL: Record<ToneState['status'], string> = {
  expected: '',
  heard: '✓',
  masked: '~',
  octave: '≈',
  inferred: '≈',
  uncertain: '?',
  stale: '↺',
};

export function drawRoll(ctx: CanvasRenderingContext2D, width: number, height: number, s: RollInput): RollGeometry {
  const g = geometry(width, height, s.view);
  const { layout, strikeY, rollTop } = g;
  const rollH = strikeY - rollTop;
  const pps = rollH / Math.max(1, s.lookahead);
  const t = s.songTime;
  const yOf = (time: number) => strikeY - (time - t) * pps;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  // Lanes: darker columns under black keys.
  for (const k of layout.keys.values()) {
    if (!k.black) continue;
    ctx.fillStyle = COLORS.laneBlack;
    ctx.fillRect(k.x, rollTop, k.w, rollH);
  }
  // Octave guides at every C.
  ctx.fillStyle = COLORS.grid;
  for (const k of layout.keys.values()) if (k.pitch % 12 === 0) ctx.fillRect(Math.round(k.x), rollTop, 1, rollH);

  // Bars, key changes and printed text marks.
  const tEnd = t + s.lookahead;
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  for (const b of s.song.bars) {
    if (b.time < t - 0.5 || b.time > tEnd) continue;
    const y = Math.round(yOf(b.time)) + 0.5;
    if (y < rollTop || y > strikeY) continue;
    ctx.fillStyle = b.number % 4 === 1 ? COLORS.gridStrong : COLORS.grid;
    ctx.fillRect(0, y, width, 1);
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(`${b.number}`, 6, y - 2);
    const mark = s.song.textMarks.find((m) => m.bar === b.number);
    const key = s.song.keys.find((k) => k.tick === b.tick && k.tick > 0);
    const label = [key?.name, mark?.text].filter(Boolean).join(' · ');
    if (label) {
      ctx.fillStyle = COLORS.text;
      ctx.fillText(label, 28, y - 2);
    }
  }

  // Loop boundaries.
  if (s.loop) {
    for (const [name, time] of [['A', s.loop.a], ['B', s.loop.b]] as const) {
      const y = yOf(time);
      if (y < rollTop || y > strikeY + 1) continue;
      ctx.fillStyle = COLORS.loop;
      ctx.fillRect(0, Math.round(y) - 1, width, 2);
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillText(`${name}`, width - 16, y - 3);
    }
    const yb = yOf(s.loop.b);
    if (yb > rollTop) {
      ctx.fillStyle = 'rgba(20,21,25,0.55)';
      ctx.fillRect(0, rollTop, width, Math.min(yb, strikeY) - rollTop);
    }
  }

  // Notes.
  const notes = s.song.notes;
  const gateSet = new Set(s.gatePitches);
  const toneByPitch = new Map(s.tones.map((x) => [x.pitch, x]));
  let offLeft = 0;
  let offRight = 0;
  let offLeftPitch = PIANO_HIGH;
  let offRightPitch = PIANO_LOW;
  const start = firstIndexFrom(notes, t - 12);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, rollTop, width, rollH);
  ctx.clip();
  for (let i = start; i < notes.length; i++) {
    const n = notes[i]!;
    if (n.time > tEnd) break;
    const end = n.time + n.duration;
    if (end < t - 0.05) continue;
    const selected = isSelected(n, s.part);
    const key = layout.keys.get(n.pitch);
    if (!key) {
      if (selected && n.time >= t - 0.01) {
        if (n.pitch < layout.lo) {
          offLeft++;
          offLeftPitch = Math.min(offLeftPitch, n.pitch);
        } else {
          offRight++;
          offRightPitch = Math.max(offRightPitch, n.pitch);
        }
      }
      continue;
    }
    const yBottom = yOf(n.time);
    const yTop = yOf(end);
    const pad = key.black ? 1 : 2;
    const x = key.x + pad;
    const w = key.w - pad * 2;
    const h = Math.max(4, yBottom - yTop - 1);
    const passed = n.time < t - 0.01;
    const atGate = selected && s.gateTime !== null && Math.abs(n.time - s.gateTime) < 1e-6 && gateSet.has(n.pitch);
    const base = selected ? handColor(n, s.colorBy) : COLORS.other;
    const resolved = s.resolved.get(n.id);
    ctx.globalAlpha = selected ? (passed ? 0.45 : 1) : passed ? 0.18 : 0.38;
    roundRect(ctx, x, yTop, w, h, Math.min(5, w / 3));
    if (atGate) {
      const tone = toneByPitch.get(n.pitch);
      const st = tone?.status ?? 'expected';
      const pulse = s.reducedMotion || !s.waiting ? 1 : 0.75 + 0.25 * Math.sin(s.now * 6);
      if (st === 'heard' || st === 'octave' || st === 'inferred' || st === 'masked') {
        ctx.fillStyle = base;
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(20,21,25,0.6)`;
        ctx.fill();
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = st === 'uncertain' || st === 'stale' ? COLORS.warn : base;
      ctx.setLineDash(st === 'uncertain' || st === 'stale' ? [4, 3] : []);
      ctx.globalAlpha = pulse;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const sym = TONE_SYMBOL[st];
      if (sym && w >= 10) {
        ctx.fillStyle = st === 'uncertain' || st === 'stale' ? COLORS.warn : '#101114';
        ctx.font = `700 ${Math.min(14, w * 0.8)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(sym, x + w / 2, yBottom - 3);
        ctx.textAlign = 'left';
      }
    } else if (selected) {
      ctx.fillStyle = base;
      ctx.fill();
      if (passed && resolved) {
        // Passed notes keep a mark of how they were resolved: ✓ recognized, ~ with uncertain parts, ⏭ manual.
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#101114';
        ctx.font = `700 ${Math.min(12, w * 0.8)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const sym = resolved === 'recognized' ? '✓' : resolved === 'manual' ? '›' : '~';
        if (w >= 9 && h >= 12) ctx.fillText(sym, x + w / 2, Math.min(yBottom, strikeY) - 2);
        ctx.textAlign = 'left';
      }
    } else {
      ctx.strokeStyle = COLORS.other;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (s.labels && selected && w >= 13 && h >= 16 && !passed) {
      const label = noteName(n.pitch, s.keyAccidentalsAt(n.tick)).replace(/-?\d+$/, '');
      ctx.fillStyle = atGate ? COLORS.text : '#101114';
      ctx.font = `600 ${Math.min(11, w * 0.5)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      if (yTop + 3 > rollTop || h > 30) ctx.fillText(label, x + w / 2, Math.max(yTop, rollTop) + 3);
      ctx.textAlign = 'left';
    }
  }
  ctx.restore();

  // Off-view indicators: never silently omit notes.
  const pill = (text: string, side: 'left' | 'right') => {
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 16;
    const x = side === 'left' ? 8 : width - tw - 8;
    const y = rollTop + 10;
    ctx.fillStyle = 'rgba(232,161,90,0.18)';
    roundRect(ctx, x, y, tw, 22, 11);
    ctx.fill();
    ctx.strokeStyle = COLORS.warn;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLORS.warn;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8, y + 11);
  };
  if (offLeft) pill(`◀ ${offLeft} below view · ${noteName(offLeftPitch)}`, 'left');
  if (offRight) pill(`${offRight} above view · ${noteName(offRightPitch)} ▶`, 'right');

  // Strike line.
  ctx.fillStyle = COLORS.strike;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(0, strikeY - 1, width, 2);
  ctx.globalAlpha = 0.12;
  ctx.fillRect(0, strikeY - 6, width, 5);
  ctx.globalAlpha = 1;

  drawKeyboard(ctx, g, s);
  drawOverview(ctx, width, g, s);
  return g;
}

function drawKeyboard(ctx: CanvasRenderingContext2D, g: RollGeometry, s: RollInput): void {
  const { layout, strikeY, keyboardH } = g;
  const top = strikeY + 1;
  const whiteH = keyboardH - 1;
  const blackH = Math.round(whiteH * 0.62);
  const toneByPitch = new Map(s.tones.map((x) => [x.pitch, x]));
  const gateColor = new Map<number, string>();
  if (s.gateTime !== null) {
    for (const n of s.song.notes) {
      if (Math.abs(n.time - s.gateTime) < 1e-6 && s.gatePitches.includes(n.pitch) && isSelected(n, s.part)) gateColor.set(n.pitch, handColor(n, s.colorBy));
      if (n.time > s.gateTime + 0.01) break;
    }
  }
  const soundingLevel = new Map(s.sounding.map((x) => [x.pitch, x.level]));
  const recent = new Map<number, { age: number; accepted: boolean }>();
  for (const o of s.onsets) {
    const cur = recent.get(o.pitch);
    if (!cur || o.age < cur.age) recent.set(o.pitch, { age: o.age, accepted: o.accepted });
  }
  const extra = new Set(s.extraNotes);

  const drawKey = (black: boolean) => {
    for (const k of layout.keys.values()) {
      if (k.black !== black) continue;
      const h = black ? blackH : whiteH;
      const x = k.x + (black ? 0 : 0.5);
      const w = k.w - (black ? 0 : 1);
      roundRect(ctx, x, top, w, h, black ? 2 : 3);
      ctx.fillStyle = black ? COLORS.ebony : COLORS.ivory;
      ctx.fill();
      const gc = gateColor.get(k.pitch);
      const tone = toneByPitch.get(k.pitch);
      if (gc) {
        const accepted = tone && (tone.status === 'heard' || tone.status === 'octave' || tone.status === 'inferred' || tone.status === 'masked');
        ctx.globalAlpha = accepted ? 0.95 : 0.4;
        ctx.fillStyle = gc;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = tone && (tone.status === 'uncertain' || tone.status === 'stale') ? COLORS.warn : gc;
        ctx.setLineDash(tone && (tone.status === 'uncertain' || tone.status === 'stale') ? [3, 2] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        const sym = tone ? TONE_SYMBOL[tone.status] : '';
        ctx.fillStyle = black ? COLORS.ivory : COLORS.ebony;
        ctx.font = `700 ${Math.min(13, w * 0.7)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(sym || '●', x + w / 2, top + 4);
        ctx.textAlign = 'left';
      } else if (!black) {
        ctx.strokeStyle = COLORS.ivoryShade;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // What the microphone hears: a thin bar for sustained energy, a dot for fresh onsets.
      const lvl = soundingLevel.get(k.pitch);
      if (lvl !== undefined && lvl > 0.06) {
        ctx.globalAlpha = Math.min(0.9, 0.25 + lvl * 1.5);
        ctx.fillStyle = COLORS.heard;
        ctx.fillRect(x + 2, top, w - 4, 3);
        ctx.globalAlpha = 1;
      }
      const r = recent.get(k.pitch);
      if (r && r.age < 1.2) {
        const cx = x + w / 2;
        const cy = top + h - Math.min(10, w * 0.45) - 2;
        const rad = Math.min(5, w * 0.3);
        ctx.globalAlpha = Math.max(0.15, 1 - r.age / 1.2);
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        const wrong = extra.has(k.pitch) && !gc;
        if (r.accepted) {
          ctx.fillStyle = wrong ? COLORS.wrong : COLORS.heard;
          ctx.fill();
        } else {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = COLORS.warn;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (!black && s.labels && k.pitch % 12 === 0 && w >= 12) {
        ctx.fillStyle = COLORS.textDim;
        ctx.font = `${Math.min(10, w * 0.5)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(noteName(k.pitch), x + w / 2, top + h - 3);
        ctx.textAlign = 'left';
      }
    }
  };
  drawKey(false);
  drawKey(true);
}

/** All 88 keys: the visible window, every upcoming note of the selected part, and the current gate. */
function drawOverview(ctx: CanvasRenderingContext2D, width: number, g: RollGeometry, s: RollInput): void {
  const h = g.overviewH;
  const full = layoutKeyboard(PIANO_LOW, PIANO_HIGH, width);
  ctx.fillStyle = '#0f1013';
  ctx.fillRect(0, 0, width, h);
  for (const k of full.keys.values()) {
    ctx.fillStyle = k.black ? '#2a2b31' : '#3a3b42';
    const kh = k.black ? h * 0.55 : h - 2;
    ctx.fillRect(k.x + 0.5, 1, Math.max(1, k.w - 1), kh);
  }
  const lo = full.keys.get(g.layout.lo)!;
  const hi = full.keys.get(g.layout.hi)!;
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(lo.x + 0.5, 0.75, hi.x + hi.w - lo.x - 1, h - 1.5);
  const start = firstIndexFrom(s.song.notes, s.songTime - 0.01);
  for (let i = start; i < s.song.notes.length; i++) {
    const n = s.song.notes[i]!;
    if (n.time > s.songTime + s.lookahead) break;
    if (!isSelected(n, s.part)) continue;
    const k = full.keys.get(n.pitch);
    if (!k) continue;
    const outside = n.pitch < g.layout.lo || n.pitch > g.layout.hi;
    ctx.fillStyle = outside ? COLORS.warn : handColor(n, s.colorBy);
    const kh = isBlackKey(n.pitch) ? h * 0.55 : h - 2;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(k.x + 0.5, 1, Math.max(2, k.w - 1), kh);
    ctx.globalAlpha = 1;
  }
  for (const p of s.gatePitches) {
    const k = full.keys.get(p);
    if (!k) continue;
    ctx.fillStyle = COLORS.text;
    ctx.fillRect(k.x, h - 4, Math.max(3, k.w), 3);
  }
}

/** Maps a canvas x coordinate on the overview strip to a MIDI pitch (for click-to-pan). */
export function overviewPitchAt(x: number, width: number): number {
  const full = layoutKeyboard(PIANO_LOW, PIANO_HIGH, width);
  let best = PIANO_LOW;
  let bestD = Infinity;
  for (const k of full.keys.values()) {
    const d = Math.abs(k.x + k.w / 2 - x);
    if (d < bestD) {
      bestD = d;
      best = k.pitch;
    }
  }
  return best;
}
