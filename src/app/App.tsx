import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PracticeController } from './controller';
import { normalizeRange, pieceRange, PIANO_HIGH, PIANO_LOW, shiftRange } from './keyboard';
import { ControllerContext, useControllerState } from './useController';
import { Header } from './components/Header';
import { PianoRoll } from './components/PianoRoll';
import { TransportBar } from './components/TransportBar';
import { StatusBar } from './components/StatusBar';
import { SetupFlow } from './components/SetupFlow';
import { SettingsDialog } from './components/SettingsDialog';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { WelcomeCard } from './components/WelcomeCard';
import { SongState } from './components/SongState';
import type { PracticeMode } from '../practice/types';

export type Dialog = 'none' | 'setup' | 'settings' | 'shortcuts';

export function App() {
  const controller = useMemo(() => new PracticeController(), []);
  useEffect(() => {
    // Development builds expose the controller for debugging and browser tests.
    if (import.meta.env.DEV) (window as unknown as { __moonlight?: PracticeController }).__moonlight = controller;
    controller.start();
    return () => void controller.stop();
  }, [controller]);
  return (
    <ControllerContext.Provider value={controller}>
      <Shell />
    </ControllerContext.Provider>
  );
}

const MODES: PracticeMode[] = ['learn', 'listen', 'single', 'manual'];

function Shell() {
  const c = useControllerState();
  const [dialog, setDialog] = useState<Dialog>('none');
  const [dragging, setDragging] = useState(false);
  const [customView, setCustomView] = useState<[number, number] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const song = c.song;

  const baseView = useMemo<[number, number]>(() => {
    if (!song) return [36, 96];
    if (c.settings.keyRange === 'full') return [PIANO_LOW, PIANO_HIGH];
    if (c.settings.keyRange === 'custom') return normalizeRange(c.settings.customRange[0], c.settings.customRange[1]);
    const pitches = song.notes.map((n) => n.pitch);
    return pieceRange(Math.min(...pitches), Math.max(...pitches));
  }, [song, c.settings.keyRange, c.settings.customRange]);
  const view = customView ?? baseView;
  useEffect(() => setCustomView(null), [baseView]);

  const shiftView = useCallback(
    (semitones: number) => {
      const [lo, hi] = customView ?? baseView;
      if (hi - lo >= PIANO_HIGH - PIANO_LOW) return;
      setCustomView(shiftRange(lo, hi, semitones));
    },
    [customView, baseView],
  );
  const panTo = useCallback(
    (center: number) => {
      const [lo, hi] = customView ?? baseView;
      const half = Math.round((hi - lo) / 2);
      setCustomView(shiftRange(lo, hi, center - half - lo));
    },
    [customView, baseView],
  );
  const zoomView = useCallback(
    (delta: number) => {
      const [lo, hi] = customView ?? baseView;
      const width = Math.max(24, Math.min(PIANO_HIGH - PIANO_LOW, hi - lo + delta));
      const mid = Math.round((lo + hi) / 2);
      setCustomView(normalizeRange(Math.max(PIANO_LOW, mid - Math.round(width / 2)), Math.min(PIANO_HIGH, mid + Math.round(width / 2))));
    },
    [customView, baseView],
  );

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenEnabled) {
      c.setNotice('Fullscreen is not available in this browser window.');
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => c.setNotice('The browser refused fullscreen.'));
  }, [c]);

  const toggleMic = useCallback(() => {
    if (c.mic.kind === 'on') c.disableMic();
    else if (!c.settings.setupDone) setDialog('setup');
    else void c.enableMic();
  }, [c]);

  // Keyboard shortcuts (ignored while typing in a field or when a dialog is open, except Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDialog('none');
        return;
      }
      if (dialog !== 'none' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const textEntry = t instanceof HTMLInputElement ? !['range', 'checkbox', 'radio', 'button'].includes(t.type) : false;
      if (t && (textEntry || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const snap = c.snap;
      const k = e.key;
      let handled = true;
      if (k === ' ') {
        // Space always drives practice, even when a button has focus after a click (Enter still presses buttons).
        if (snap.state === 'waiting' || (snap.state === 'running' && snap.mode !== 'listen')) c.manualAdvance();
        else c.togglePlay();
      } else if (k === 'k' || k === 'p') c.togglePlay();
      else if (k === 'Enter' && t?.tagName !== 'BUTTON' && t?.tagName !== 'A') c.togglePlay();
      else if (k === 'r') c.restart();
      else if (k === 'ArrowLeft' && e.shiftKey) shiftView(-12);
      else if (k === 'ArrowRight' && e.shiftKey) shiftView(12);
      else if (k === 'ArrowLeft') c.seekBars(-1);
      else if (k === 'ArrowRight') c.seekBars(1);
      else if (k === 'ArrowUp') c.setTempo(c.settings.tempo + 0.05);
      else if (k === 'ArrowDown') c.setTempo(c.settings.tempo - 0.05);
      else if (k === 'a') c.setLoopPoint('a');
      else if (k === 'b') c.setLoopPoint('b');
      else if (k === 'x') c.clearLoop();
      else if (k === 'h') void c.hearPassage();
      else if (k === 'm') toggleMic();
      else if (k === 'n') c.updateSettings({ labels: !c.settings.labels });
      else if (k === 'f') toggleFullscreen();
      else if (k === 'd') c.updateSettings({ showDiagnostics: !c.settings.showDiagnostics });
      else if (k === '?') setDialog('shortcuts');
      else if (k === '+' || k === '=') zoomView(-12);
      else if (k === '-') zoomView(12);
      else if (k >= '1' && k <= '4') c.setMode(MODES[Number(k) - 1]!);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c, dialog, shiftView, toggleFullscreen, toggleMic, zoomView]);

  // Resume a context the browser suspended (autoplay policy, device change) on the next gesture.
  useEffect(() => {
    const resume = () => {
      if (c.audio.ctx && c.audio.ctx.state === 'suspended') void c.audio.ctx.resume();
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, [c]);

  // MIDI drag-and-drop anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void c.importFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [c]);

  const openImport = () => fileInput.current?.click();
  const showWelcome = !c.settings.setupDone && dialog === 'none' && c.songStatus.kind === 'ready';

  return (
    <div className={`app ${c.settings.showDiagnostics ? 'with-diag' : ''}`}>
      <Header onSetup={() => setDialog('setup')} onSettings={() => setDialog('settings')} onShortcuts={() => setDialog('shortcuts')} onImport={openImport} onFullscreen={toggleFullscreen} onToggleMic={toggleMic} />
      <main className="stage">
        {c.songStatus.kind === 'ready' && song ? (
          <PianoRoll controller={c} view={view} onPan={panTo} />
        ) : (
          <SongState onImport={openImport} />
        )}
        {showWelcome && <WelcomeCard onSetup={() => setDialog('setup')} />}
        {dragging && (
          <div className="drop-overlay" aria-hidden="true">
            <div>Drop a MIDI file (.mid) to practise it</div>
          </div>
        )}
      </main>
      {c.settings.showDiagnostics && <DiagnosticsPanel onClose={() => c.updateSettings({ showDiagnostics: false })} />}
      <StatusBar />
      <TransportBar view={view} onShiftView={shiftView} onZoomView={zoomView} onResetView={() => setCustomView(null)} viewIsCustom={customView !== null} />
      <input
        ref={fileInput}
        type="file"
        accept=".mid,.midi,audio/midi,audio/x-midi"
        hidden
        data-testid="midi-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void c.importFile(f);
          e.target.value = '';
        }}
      />
      {dialog === 'setup' && <SetupFlow onClose={() => setDialog('none')} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog('none')} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog('none')} />}
    </div>
  );
}
