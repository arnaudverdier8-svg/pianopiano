import { useState } from 'react';
import { clearProgress, loadProgress } from '../../storage/progress';
import { useControllerState } from '../useController';
import { Modal } from './Modal';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const c = useControllerState();
  const st = c.settings;
  const m = st.matcher;
  const [headphones, setHeadphones] = useState(st.accompanimentAcknowledged);
  const setMatcher = (patch: Partial<typeof m>) => c.updateSettings({ matcher: { ...m, ...patch } });
  const progress = c.song ? loadProgress(c.song.id) : null;

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings-grid">
        <section>
          <h3>Recognition</h3>
          <Slider label="Sensitivity" min={0.5} max={2} step={0.05} value={st.sensitivity} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => c.applyDetectorSettings({ sensitivity: v })} hint="Higher catches softer notes but adds false ones." />
          <Slider label="Piano tuning" min={-60} max={60} step={1} value={st.tuningCents} fmt={(v) => `${v >= 0 ? '+' : ''}${v} cents`} onChange={(v) => c.applyDetectorSettings({ tuningCents: v })} hint="Set automatically by the test notes in Mic setup." />
          <Slider label="Required confidence" min={0.35} max={0.85} step={0.05} value={m.acceptConfidence} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setMatcher({ acceptConfidence: v })} hint="Evidence below this shows as uncertain (?) and does not advance." />
          <Slider label="Rolled-chord window" min={0.15} max={0.8} step={0.05} value={m.rollWindow} fmt={(v) => `${Math.round(v * 1000)} ms`} onChange={(v) => setMatcher({ rollWindow: v })} hint="How far apart the notes of one chord may be played." />
          <Slider label="Early tolerance" min={0.1} max={0.8} step={0.05} value={m.earlyTolerance} fmt={(v) => `${Math.round(v * 1000)} ms`} onChange={(v) => setMatcher({ earlyTolerance: v })} hint="How early, before the line, a note still counts." />
          <label className="field block">
            <span>Octave doublings</span>
            <select value={m.octavePolicy} onChange={(e) => setMatcher({ octavePolicy: e.target.value as 'verify' | 'trust-lower' })}>
              <option value="verify">Verify the upper note (strict)</option>
              <option value="trust-lower">Accept on the lower note (marked ≈ inferred, not heard)</option>
            </select>
          </label>
          <label className="field block">
            <span>Bass octave tolerance</span>
            <select value={m.bassOctaveBelow} onChange={(e) => setMatcher({ bassOctaveBelow: Number(e.target.value) })}>
              <option value={0}>Off (strict)</option>
              <option value={36}>Below C2: an octave-displaced detection counts</option>
              <option value={48}>Below C3: an octave-displaced detection counts</option>
            </select>
          </label>
          <label className="field block">
            <span>Wrong notes block the chord</span>
            <select value={m.blockOnExtraNotes} onChange={(e) => setMatcher({ blockOnExtraNotes: Number(e.target.value) })}>
              <option value={0}>Never</option>
              <option value={2}>2 or more clear wrong notes</option>
              <option value={3}>3 or more clear wrong notes</option>
              <option value={5}>5 or more clear wrong notes</option>
            </select>
          </label>
        </section>
        <section>
          <h3>Display</h3>
          <Check label="Note names on notes and keys (N)" checked={st.labels} onChange={(v) => c.updateSettings({ labels: v })} />
          <label className="field block">
            <span>Colour notes by</span>
            <select value={st.colorBy} onChange={(e) => c.updateSettings({ colorBy: e.target.value as 'hand' | 'track' })}>
              <option value="hand">Hand (blue right, lavender left)</option>
              <option value="track">Staff / track</option>
            </select>
          </label>
          <Slider label="Look-ahead" min={3} max={12} step={0.5} value={st.lookahead} fmt={(v) => `${v} s`} onChange={(v) => c.updateSettings({ lookahead: v })} hint="Seconds of music visible above the line." />
          <Check label="Reduce motion (no pulsing)" checked={st.reducedMotion} onChange={(v) => c.updateSettings({ reducedMotion: v })} />

          <h3>Sound</h3>
          <p className="hint">Practice is silent by default so the microphone only hears your piano. “Hear passage” and Listen mode pause recognition while they play.</p>
          <Check label="I am using headphones" checked={headphones} onChange={(v) => {
            setHeadphones(v);
            c.updateSettings({ accompanimentAcknowledged: v, ...(v ? {} : { accompaniment: false }) });
          }} />
          <Check
            label="Accompaniment: play the other part while I practise"
            checked={st.accompaniment}
            disabled={!headphones}
            onChange={(v) => c.updateSettings({ accompaniment: v })}
          />
          {!headphones && <p className="hint">Accompaniment needs headphones. Through speakers the microphone would hear it. The app ignores its own notes, but not perfectly.</p>}
          <Slider label="Playback volume" min={0} max={1} step={0.05} value={st.playbackVolume} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => c.updateSettings({ playbackVolume: v })} />

          <h3>Data on this computer</h3>
          <p className="hint">Settings and practice history are kept in this browser only (localStorage). No account, no uploads.</p>
          {progress && progress.sessions.length > 0 && (
            <details>
              <summary>Practice history ({progress.sessions.length} sessions)</summary>
              <ul className="history">
                {progress.sessions
                  .slice(-12)
                  .reverse()
                  .map((s) => (
                    <li key={s.startedAt}>
                      {new Date(s.startedAt).toLocaleString()}: bars {s.fromBar}–{s.toBar}, {s.part} hand, {s.mode}, {Math.round(s.tempo * 100)}%. ✓ {s.recognized} · ~ {s.withUncertainParts} · › {s.manual}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <div className="actions">
            <button className="btn small" onClick={() => c.song && clearProgress(c.song.id)}>
              Clear history for this piece
            </button>
            <button className="btn small" onClick={() => c.updateSettings({ noiseProfile: null, noiseRmsDb: null })}>
              Forget room noise
            </button>
            <button className="btn small" onClick={() => c.resetSettings()}>
              Reset all settings
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function Slider(p: { label: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="field block slider">
      <span>
        {p.label} <output>{p.fmt(p.value)}</output>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} aria-valuetext={p.fmt(p.value)} />
      {p.hint && <small>{p.hint}</small>}
    </label>
  );
}

function Check(p: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`check ${p.disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onChange(e.target.checked)} />
      <span>{p.label}</span>
    </label>
  );
}
