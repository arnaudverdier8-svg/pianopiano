import { useEffect, useRef } from 'react';
import { describeSelection } from '../../music/events';
import { noteName } from '../../music/spelling';
import type { PracticeController } from '../controller';
import { drawRoll, geometry, overviewPitchAt } from '../render';

interface Props {
  controller: PracticeController;
  view: [number, number];
  onPan: (centerPitch: number) => void;
}

/** Canvas piano roll. Reads live controller state every animation frame; React only supplies the view range. */
export function PianoRoll({ controller: c, view, onPan }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    let raf = 0;
    let size = { w: 0, h: 0, dpr: 1 };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size = { w: r.width, h: r.height, dpr };
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const song = c.song;
      if (!song || size.w < 10) return;
      const snap = c.engine.snapshot();
      const now = c.audio.now;
      const gate = snap.gate;
      let songTime = c.engine.transport.peek(now, gate?.time ?? null);
      if (snap.loop) songTime = Math.min(songTime, snap.loop.b);
      const accept = c.settings.matcher.acceptConfidence;
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      drawRoll(ctx, size.w, size.h, {
        song,
        part: c.partSelection(c.effectivePart),
        songTime,
        lookahead: c.settings.lookahead,
        view: viewRef.current,
        labels: c.settings.labels,
        colorBy: c.settings.colorBy,
        gateTime: gate?.time ?? null,
        gatePitches: gate?.pitches ?? [],
        tones: snap.tones,
        waiting: snap.state === 'waiting',
        extraNotes: snap.extraNotes,
        resolved: c.resolvedNotes,
        onsets: c.recentOnsets.map((o) => ({ pitch: o.pitch, age: now - o.receivedAt, accepted: o.confidence >= accept })),
        sounding: now - c.soundingAt < 0.3 ? c.sounding : [],
        loop: snap.loop,
        keyAccidentalsAt: (tick) => c.keyAccidentalsAt(tick),
        reducedMotion: c.settings.reducedMotion,
        now: performance.now() / 1000,
      });
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [c]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const g = geometry(r.width, r.height, viewRef.current);
    if (y <= g.overviewH) onPan(overviewPitchAt(e.clientX - r.left, r.width));
  };

  const snap = c.snap;
  const key = c.keyAccidentalsAt(snap.gate?.tick ?? 0);
  const label = c.song
    ? `Falling-note view of ${c.song.title}, ${c.song ? describeSelection(c.song, c.partSelection(c.effectivePart)) : ''}. ` +
      (snap.gate ? `Next notes: ${snap.gate.pitches.map((p) => noteName(p, key)).join(', ')}, bar ${snap.gate.bar}.` : '') +
      ` Keyboard shows ${noteName(view[0])} to ${noteName(view[1])}. Click the top strip to move the view.`
    : 'No piece loaded';

  return <canvas ref={canvasRef} className="roll" role="img" aria-label={label} onClick={onClick} data-testid="piano-roll" />;
}
