import { useControllerState } from '../useController';
import { Icon } from './Icon';

interface Props {
  onSetup: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onImport: () => void;
  onFullscreen: () => void;
  onToggleMic: () => void;
}

export function micSummary(c: ReturnType<typeof useControllerState>): { label: string; tone: 'off' | 'ok' | 'warn' | 'bad'; title: string } {
  const m = c.mic;
  if (m.kind === 'starting') return { label: 'Starting…', tone: 'warn', title: 'Waiting for microphone permission' };
  if (m.kind === 'error') return { label: 'Mic unavailable', tone: 'bad', title: `${m.error.message} ${m.error.help}` };
  if (m.kind === 'off') return { label: 'Mic off', tone: 'off', title: 'The microphone is off. Nothing is being captured.' };
  if (c.audio.contextState === 'suspended') return { label: 'Audio suspended', tone: 'warn', title: 'The browser suspended audio. Click anywhere to resume.' };
  if (c.levels.clippedRecently) return { label: 'Clipping', tone: 'warn', title: 'The input is overloading. Move the microphone away from the piano or lower the input gain.' };
  if (c.levels.tooQuiet) return { label: 'Too quiet', tone: 'warn', title: 'Almost no signal. Check the selected microphone and the system input level.' };
  return { label: 'Listening', tone: 'ok', title: `Listening on ${c.audio.input?.label ?? 'the microphone'}. Audio stays on this device and is not recorded.` };
}

export function Header({ onSetup, onSettings, onShortcuts, onImport, onFullscreen, onToggleMic }: Props) {
  const c = useControllerState();
  const song = c.song;
  const mic = micSummary(c);
  const level = Math.max(0, Math.min(1, (c.levels.rmsDb + 70) / 60));
  return (
    <header className="topbar">
      <div className="brand" aria-label="MOONLIGHT">
        <span className="moon" aria-hidden="true" />
        <span className="wordmark">MOONLIGHT</span>
      </div>
      <div className="piece" data-testid="piece-title">
        {song ? (
          <>
            <h1>{song.title}</h1>
            <span className="composer">
              {song.composer}
              {c.isBundled ? ' · Suite bergamasque' : ''}
            </span>
          </>
        ) : (
          <h1 className="muted">{c.songStatus.kind === 'loading' ? 'Loading…' : 'No piece loaded'}</h1>
        )}
      </div>
      <div className="top-actions">
        <button className={`mic-pill ${mic.tone}`} onClick={onToggleMic} title={mic.title} aria-label={`Microphone: ${mic.label}. ${mic.title} Press to ${c.mic.kind === 'on' ? 'turn off' : 'turn on'}.`} data-testid="mic-pill">
          <span className="dot" aria-hidden="true" />
          {mic.label}
          {c.mic.kind === 'on' && (
            <span className="meter" aria-hidden="true">
              <span style={{ width: `${level * 100}%` }} />
            </span>
          )}
        </button>
        <button className="btn ghost" onClick={onSetup}>
          Mic setup
        </button>
        <button className="btn ghost" onClick={onImport} title="Open a MIDI file (or drag one onto the page)">
          Open MIDI
        </button>
        <button className={`btn ghost ${c.settings.showDiagnostics ? 'active' : ''}`} aria-pressed={c.settings.showDiagnostics} onClick={() => c.updateSettings({ showDiagnostics: !c.settings.showDiagnostics })}>
          Diagnostics
        </button>
        <button className="icon-btn" onClick={onShortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Icon name="keyboard" size={18} />
        </button>
        <button className="icon-btn" onClick={onFullscreen} aria-label="Fullscreen" title="Fullscreen (F)">
          <Icon name="fullscreen" size={18} />
        </button>
        <button className="icon-btn" onClick={onSettings} aria-label="Settings" title="Settings">
          <Icon name="settings" size={18} />
        </button>
      </div>
    </header>
  );
}
