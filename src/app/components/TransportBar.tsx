import { useState } from 'react';
import { noteName } from '../../music/spelling';
import type { PracticeMode } from '../../practice/types';
import type { PartChoice } from '../../storage/settings';
import { useControllerState } from '../useController';
import { Icon } from './Icon';

interface Props {
  view: [number, number];
  viewIsCustom: boolean;
  onShiftView: (semitones: number) => void;
  onZoomView: (delta: number) => void;
  onResetView: () => void;
}

const MODE_INFO: { mode: PracticeMode; label: string; hint: string }[] = [
  { mode: 'learn', label: 'Learn', hint: 'Waits at each chord until the microphone hears every note.' },
  { mode: 'listen', label: 'Listen', hint: 'The app plays the piece. Nothing is scored.' },
  { mode: 'single', label: 'Single note', hint: 'Practice aid: waits only for the top note of each chord. Not full-score practice.' },
  { mode: 'manual', label: 'Manual', hint: 'No listening. Space advances each chord. Recorded as manual.' },
];

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TransportBar({ view, viewIsCustom, onShiftView, onZoomView, onResetView }: Props) {
  const c = useControllerState();
  const s = c.snap;
  const song = c.song;
  const [loopFrom, setLoopFrom] = useState('');
  const [loopTo, setLoopTo] = useState('');
  const disabled = !song;
  const playing = s.state === 'running' || s.state === 'waiting';
  const bars = song?.bars.length ?? 0;
  const bar = c.currentBar();
  const previewing = c.preview.phase !== 'idle';
  const canContinue = c.canManualAdvance();
  const loopBars = s.loop && song ? { a: barAt(song.bars, s.loop.a), b: barAt(song.bars, s.loop.b - 0.001) } : null;

  const parts: { value: PartChoice; label: string }[] = [
    { value: 'right', label: 'Right hand' },
    { value: 'left', label: 'Left hand' },
    { value: 'both', label: 'Both hands' },
    { value: 'upper', label: 'Upper staff' },
    { value: 'lower', label: 'Lower staff' },
    ...(song?.tracks ?? []).filter((t) => t.noteCount > 0).map((t) => ({ value: `track:${t.index}` as PartChoice, label: `Track ${t.index + 1}: ${t.name || 'unnamed'} (${t.noteCount})` })),
  ];
  const partAvailability = (p: PartChoice): string | null => {
    if (!song) return 'No piece loaded';
    if (c.partAvailable(p)) return null;
    if (p === 'right' || p === 'left') return 'No validated hand mapping for this file';
    return 'Staff mapping not validated for this file';
  };

  return (
    <section className="transport" aria-label="Practice controls">
      <div className="row">
        <button className="btn primary play" onClick={() => c.togglePlay()} disabled={disabled || previewing} aria-label={playing ? 'Pause (K)' : 'Start (K)'} data-testid="play">
          <Icon name={playing ? 'pause' : 'play'} /> {playing ? 'Pause' : s.state === 'completed' ? 'Again' : 'Start'}
        </button>
        <button className="btn" onClick={() => c.restart()} disabled={disabled} title="Back to the start or loop A (R)">
          <Icon name="restart" /> Restart
        </button>
        <button className="icon-btn" onClick={() => c.seekBars(-1)} disabled={disabled} aria-label="Previous bar (←)">
          <Icon name="prev" />
        </button>
        <button className="icon-btn" onClick={() => c.seekBars(1)} disabled={disabled} aria-label="Next bar (→)">
          <Icon name="next" />
        </button>
        <label className="seek">
          <span className="sr-only">Position</span>
          <input
            type="range"
            min={0}
            max={song?.duration ?? 1}
            step={0.1}
            value={Math.min(s.songTime, song?.duration ?? 0)}
            disabled={disabled}
            onChange={(e) => c.seek(Number(e.target.value))}
            aria-valuetext={`Bar ${bar} of ${bars}, ${fmt(s.songTime)}`}
            data-testid="seek"
          />
        </label>
        <span className="pos" data-testid="position">
          Bar {bar}/{bars} · {fmt(s.songTime)} / {fmt(song?.duration ?? 0)}
        </span>
        <button className="btn continue" onClick={() => c.manualAdvance()} disabled={!canContinue} title="Advance past this chord without recognition. Recorded as manual. (Space)" data-testid="continue">
          Continue ␣
        </button>
      </div>
      <div className="row wrap">
        <div className="seg" role="radiogroup" aria-label="Mode">
          {MODE_INFO.map((m, i) => (
            <button key={m.mode} role="radio" aria-checked={s.mode === m.mode} className={s.mode === m.mode ? 'on' : ''} onClick={() => c.setMode(m.mode)} title={`${m.hint} (${i + 1})`} disabled={disabled}>
              {m.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Part</span>
          <select value={c.effectivePart} onChange={(e) => c.setPart(e.target.value as PartChoice)} disabled={disabled} data-testid="part">
            {parts.map((p) => {
              const why = partAvailability(p.value);
              return (
                <option key={p.value} value={p.value} disabled={why !== null}>
                  {p.label}
                  {why ? ` — ${why}` : ''}
                </option>
              );
            })}
          </select>
        </label>
        <label className="field tempo">
          <span>Tempo</span>
          <input type="range" min={25} max={150} step={5} value={Math.round(c.settings.tempo * 100)} onChange={(e) => c.setTempo(Number(e.target.value) / 100)} disabled={disabled} aria-valuetext={`${Math.round(c.settings.tempo * 100)} percent`} data-testid="tempo" />
          <output>{Math.round(c.settings.tempo * 100)}%</output>
        </label>
        <div className="group" role="group" aria-label="Loop">
          <span className="group-label">Loop</span>
          <button className="btn small" onClick={() => c.setLoopPoint('a')} disabled={disabled} title="Set loop start here (A)">
            A
          </button>
          <button className="btn small" onClick={() => c.setLoopPoint('b')} disabled={disabled} title="Set loop end here (B)">
            B
          </button>
          <form
            className="loop-bars"
            onSubmit={(e) => {
              e.preventDefault();
              const a = Number(loopFrom);
              const b = Number(loopTo || loopFrom);
              if (a >= 1 && b >= a && b <= bars) c.setLoopBars(a, b);
            }}
          >
            <input aria-label="Loop from bar" inputMode="numeric" placeholder={loopBars ? String(loopBars.a) : 'bar'} value={loopFrom} onChange={(e) => setLoopFrom(e.target.value.replace(/\D/g, ''))} disabled={disabled} />
            <span>–</span>
            <input aria-label="Loop to bar" inputMode="numeric" placeholder={loopBars ? String(loopBars.b) : 'bar'} value={loopTo} onChange={(e) => setLoopTo(e.target.value.replace(/\D/g, ''))} disabled={disabled} />
            <button className="btn small" type="submit" disabled={disabled || !loopFrom}>
              Set
            </button>
          </form>
          {s.loop && (
            <button className="btn small ghost" onClick={() => c.clearLoop()} title="Clear loop (X)" data-testid="clear-loop">
              Clear{loopBars ? ` (bars ${loopBars.a}–${loopBars.b})` : ''}
            </button>
          )}
        </div>
        <button className="btn" onClick={() => (previewing ? c.stopPreview() : void c.hearPassage())} disabled={disabled} title="Play the next two bars through the speakers. Listening pauses until the sound fades. (H)">
          <Icon name={previewing ? 'stop' : 'speaker'} /> {previewing ? 'Stop' : 'Hear passage'}
        </button>
        <div className="group" role="group" aria-label="Keyboard view">
          <span className="group-label">View</span>
          <button className="icon-btn" onClick={() => onShiftView(-12)} disabled={disabled} aria-label="Move view down an octave (Shift+←)">
            <Icon name="prev" />
          </button>
          <span className="view-range">
            {noteName(view[0])}–{noteName(view[1])}
          </span>
          <button className="icon-btn" onClick={() => onShiftView(12)} disabled={disabled} aria-label="Move view up an octave (Shift+→)">
            <Icon name="next" />
          </button>
          <button className="icon-btn" onClick={() => onZoomView(-12)} disabled={disabled} aria-label="Zoom in (+)">
            +
          </button>
          <button className="icon-btn" onClick={() => onZoomView(12)} disabled={disabled} aria-label="Zoom out (−)">
            −
          </button>
          <select aria-label="Key range" value={c.settings.keyRange} onChange={(e) => c.updateSettings({ keyRange: e.target.value as 'piece' | 'full' | 'custom' })} disabled={disabled}>
            <option value="piece">Piece range</option>
            <option value="full">All 88 keys</option>
          </select>
          {viewIsCustom && (
            <button className="btn small ghost" onClick={onResetView}>
              Reset
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function barAt(bars: { number: number; time: number }[], t: number): number {
  let n = 1;
  for (const b of bars) if (b.time <= t + 1e-6) n = b.number;
  return n;
}
