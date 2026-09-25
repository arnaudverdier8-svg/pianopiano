import { useEffect, useState } from 'react';
import { AudioSystem, type InputInfo } from '../../audio/capture';
import { estimateTuning, type NoteMeasurement } from '../../audio/detector/calibration';
import { noteName } from '../../music/spelling';
import { useControllerState } from '../useController';
import { Modal } from './Modal';

type Step = 'mic' | 'noise' | 'notes' | 'done';

interface NoteResult {
  pitch: number;
  peakDb: number;
  clipped: boolean;
  measurement: NoteMeasurement | null;
  bestConfidence: number | null;
  octaveConfusion: number | null;
}

const SUGGESTED = [56, 65, 73, 37]; // A♭3, F4, D♭5 from the opening; D♭2 to check the bass

function db(v: number): number {
  return 20 * Math.log10(Math.max(1e-6, v));
}

export function SetupFlow({ onClose }: { onClose: () => void }) {
  const c = useControllerState();
  const [step, setStep] = useState<Step>(c.mic.kind === 'on' ? 'noise' : 'mic');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>(c.settings.deviceId ?? '');
  const [info, setInfo] = useState<InputInfo | null>(c.audio.input);
  const [noise, setNoise] = useState<{ rmsDb: number } | null>(c.settings.noiseRmsDb !== null ? { rmsDb: c.settings.noiseRmsDb } : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<NoteResult[]>([]);
  const unsupported = AudioSystem.supportCheck();
  const key = -5; // spell suggestions in D♭ major

  const refreshDevices = async () => setDevices(await c.audio.listDevices().catch(() => []));
  useEffect(() => {
    void refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const h = () => void refreshDevices();
    md.addEventListener('devicechange', h);
    return () => md.removeEventListener('devicechange', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enable = async () => {
    setBusy('Waiting for permission…');
    const i = await c.enableMic(deviceId || null);
    setBusy(null);
    if (i) {
      setInfo(i);
      setDeviceId(i.deviceId);
      await refreshDevices();
    }
  };

  const measureNoise = async () => {
    setBusy('Measuring the room — please stay quiet…');
    const r = await c.measureRoomNoise(3);
    setNoise({ rmsDb: r.rmsDb });
    setBusy(null);
  };

  const testNote = async (pitch: number) => {
    setBusy(`Play ${noteName(pitch, key)} now, once, and let it ring…`);
    const startedAt = c.audio.now;
    const r = await c.measureNote(pitch, 2.5);
    // Give the analysis pipeline a moment to report the onset.
    await new Promise((res) => setTimeout(res, 300));
    const onsets = c.recentOnsets.filter((o) => o.time >= startedAt - 0.05);
    const hits = onsets.filter((o) => o.pitch === pitch);
    const oct = onsets.filter((o) => Math.abs(o.pitch - pitch) === 12 && !hits.length);
    setResults((prev) => [
      ...prev.filter((p) => p.pitch !== pitch),
      {
        pitch,
        peakDb: db(r.peak),
        clipped: r.peak >= 0.99,
        measurement: r.result,
        bestConfidence: hits.length ? Math.max(...hits.map((h) => h.confidence)) : null,
        octaveConfusion: oct[0]?.pitch ?? null,
      },
    ]);
    setBusy(null);
  };

  const tuning = estimateTuning(results.map((r) => r.measurement).filter((m): m is NoteMeasurement => m !== null));
  const finish = () => {
    c.updateSettings({ setupDone: true });
    onClose();
  };

  const processingWarnings = info?.processing.filter((p) => p.applied === true) ?? [];
  const noiseVerdict = noise ? (noise.rmsDb < -60 ? 'Quiet room — good.' : noise.rmsDb < -45 ? 'Some background noise. Recognition should work; quieter is better.' : 'Noisy. Fans, voices or music will cause missed and false notes.') : null;

  return (
    <Modal
      title="Microphone setup"
      onClose={onClose}
      wide
      footer={
        <>
          <ol className="steps" aria-label="Setup steps">
            {(['mic', 'noise', 'notes', 'done'] as Step[]).map((s, i) => (
              <li key={s} className={s === step ? 'on' : ''} aria-current={s === step ? 'step' : undefined}>
                {i + 1}. {s === 'mic' ? 'Microphone' : s === 'noise' ? 'Room noise' : s === 'notes' ? 'Test notes' : 'Done'}
              </li>
            ))}
          </ol>
          <button className="btn ghost" onClick={finish}>
            {step === 'done' ? 'Close' : 'Skip setup'}
          </button>
        </>
      }
    >
      <LiveMeter />
      {busy && (
        <p className="busy" role="status">
          {busy}
        </p>
      )}
      {step === 'mic' && (
        <section>
          <p>MOONLIGHT listens to your acoustic piano through the microphone. The audio is analysed on this computer and is never recorded or uploaded. The microphone stops when you turn it off or close the tab.</p>
          {unsupported ? (
            <div className="callout bad" role="alert">
              <strong>{unsupported.message}</strong> {unsupported.help}
            </div>
          ) : (
            <>
              <label className="field block">
                <span>Microphone</span>
                <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} data-testid="device-select">
                  <option value="">System default</option>
                  {devices
                    .filter((d) => d.deviceId && d.deviceId !== 'default')
                    .map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${i + 1} (names appear after permission)`}
                      </option>
                    ))}
                </select>
              </label>
              <p className="hint">Place the laptop on the music stand or a nearby table, screen facing you. Avoid putting it on the piano lid, which exaggerates the bass and rattles.</p>
              {c.mic.kind === 'error' && (
                <div className="callout bad" role="alert" data-testid="mic-error">
                  <strong>{c.mic.error.message}</strong> {c.mic.error.help}
                </div>
              )}
              <div className="actions">
                <button className="btn primary" onClick={() => void enable()} disabled={busy !== null} data-testid="enable-mic">
                  {c.mic.kind === 'on' ? 'Restart microphone' : 'Enable microphone'}
                </button>
                {c.mic.kind === 'on' && (
                  <button className="btn" onClick={() => setStep('noise')}>
                    Next: room noise →
                  </button>
                )}
              </div>
              {info && <InputDetails info={info} />}
              {processingWarnings.length > 0 && (
                <div className="callout warn">The browser kept {processingWarnings.map((p) => p.name.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')} switched on even though MOONLIGHT asked to turn it off. Piano notes may be dulled or cut short. Try another browser or microphone if recognition is poor.</div>
              )}
            </>
          )}
        </section>
      )}
      {step === 'noise' && (
        <section>
          <p>Stay quiet for three seconds so MOONLIGHT can learn the room’s background sound (fans, hum). This sets the noise floor the detector subtracts.</p>
          <div className="actions">
            <button className="btn primary" onClick={() => void measureNoise()} disabled={busy !== null || c.mic.kind !== 'on'} data-testid="measure-noise">
              {noise ? 'Measure again' : 'Measure room noise'}
            </button>
            <button className="btn" onClick={() => setStep('notes')} disabled={busy !== null}>
              Next: test notes →
            </button>
          </div>
          {c.mic.kind !== 'on' && <p className="hint">The microphone is off. Go back to step 1.</p>}
          {noise && (
            <p data-testid="noise-result">
              Background level: <strong>{noise.rmsDb.toFixed(0)} dBFS</strong>. {noiseVerdict}
            </p>
          )}
        </section>
      )}
      {step === 'notes' && (
        <section>
          <p>Play each note once at a normal volume and let it ring. MOONLIGHT reports how strongly it heard the note, whether the recognizer identified it, and how far your piano is from standard pitch.</p>
          <div className="note-tests">
            {SUGGESTED.map((p) => {
              const r = results.find((x) => x.pitch === p);
              return (
                <div key={p} className="note-test">
                  <button className="btn" onClick={() => void testNote(p)} disabled={busy !== null || c.mic.kind !== 'on'}>
                    Test {noteName(p, key)}
                  </button>
                  {r ? (
                    <span className="result">
                      Strength {r.peakDb.toFixed(0)} dBFS{r.clipped ? ' · clipping — move the microphone back' : r.peakDb < -40 ? ' · weak' : ''} ·{' '}
                      {r.bestConfidence !== null ? (
                        <>
                          <span className="sym ok">✓</span> recognized (confidence {(r.bestConfidence * 100).toFixed(0)}%)
                        </>
                      ) : r.octaveConfusion !== null ? (
                        <>
                          <span className="sym warn">?</span> heard as {noteName(r.octaveConfusion, key)} (octave confusion)
                        </>
                      ) : (
                        <>
                          <span className="sym warn">?</span> not recognized
                        </>
                      )}
                      {r.measurement && r.measurement.harmonicity > 0.3 && <> · {r.measurement.cents >= 0 ? '+' : ''}{r.measurement.cents.toFixed(0)} cents</>}
                    </span>
                  ) : (
                    <span className="result muted">{p < 48 ? 'Bass check — laptop microphones often capture low notes weakly.' : 'Not tested yet'}</span>
                  )}
                </div>
              );
            })}
          </div>
          {tuning !== null && (
            <p>
              Tuning estimate: your piano is about <strong>{tuning >= 0 ? '+' : ''}{tuning.toFixed(0)} cents</strong> from A = 440 Hz.{' '}
              {Math.abs(tuning - c.settings.tuningCents) >= 3 ? (
                <button className="btn small" onClick={() => c.applyDetectorSettings({ tuningCents: Math.round(tuning) })}>
                  Use {tuning >= 0 ? '+' : ''}{Math.round(tuning)} cents
                </button>
              ) : (
                <span className="muted">(already applied)</span>
              )}
            </p>
          )}
          <div className="actions">
            <button className="btn primary" onClick={() => setStep('done')}>
              Next →
            </button>
          </div>
        </section>
      )}
      {step === 'done' && (
        <section>
          <p>You’re set. In <strong>Learn</strong> mode the notes stop at the line and wait until the microphone hears you play them. If a note is hard to recognize, press <kbd>Space</kbd> to continue. That chord is recorded as manual.</p>
          <ul className="plain">
            <li>Practice sound is silent by default, so the app never hears itself.</li>
            <li>“Hear passage” plays the next two bars, then waits for the sound to fade before listening again.</li>
            <li>Octave doublings and very low bass notes are the hardest for a single microphone. The status line says so when it can’t tell.</li>
          </ul>
          <div className="actions">
            <button className="btn primary" onClick={finish} data-testid="setup-finish">
              Start practising
            </button>
          </div>
        </section>
      )}
    </Modal>
  );
}

function InputDetails({ info }: { info: InputInfo }) {
  return (
    <dl className="kv" data-testid="input-details">
      <dt>Device</dt>
      <dd>{info.label}</dd>
      <dt>Sample rate</dt>
      <dd>{info.contextRate} Hz (resampled to 22 050 Hz for analysis)</dd>
      <dt>Channels</dt>
      <dd>{info.channelCount ?? 'not reported'} (mono used)</dd>
      {info.processing.map((p) => (
        <FragmentRow key={p.name} name={p.name} applied={p.applied} />
      ))}
      <dt>Output latency</dt>
      <dd>{(info.baseLatency * 1000).toFixed(0)} ms (base)</dd>
    </dl>
  );
}

function FragmentRow({ name, applied }: { name: string; applied: boolean | undefined }) {
  const label = name.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase());
  return (
    <>
      <dt>{label}</dt>
      <dd>
        requested off · {applied === undefined ? 'browser did not report' : applied ? <strong className="warn-text">still on</strong> : 'off'}
      </dd>
    </>
  );
}

export function LiveMeter() {
  const c = useControllerState();
  if (c.mic.kind !== 'on') return null;
  const rms = c.levels.rmsDb;
  const pct = Math.max(0, Math.min(100, ((rms + 80) / 80) * 100));
  const peakPct = Math.max(0, Math.min(100, ((20 * Math.log10(Math.max(1e-5, c.levels.peak)) + 80) / 80) * 100));
  return (
    <div className="live-meter" aria-label={`Input level ${rms.toFixed(0)} dBFS`}>
      <div className="bar">
        <span className="fill" style={{ width: `${pct}%` }} />
        <span className="peak" style={{ left: `${peakPct}%` }} />
      </div>
      <span className="val">
        {rms.toFixed(0)} dBFS{c.levels.clippedRecently ? ' · CLIPPING' : ''}
      </span>
      <span className="heard">
        Hearing:{' '}
        {c.sounding.length
          ? c.sounding
              .filter((x) => x.level > 0.08)
              .slice(0, 6)
              .map((x) => noteName(x.pitch, -5))
              .join(' ')
          : '—'}
      </span>
    </div>
  );
}
