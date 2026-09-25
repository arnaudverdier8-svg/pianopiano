import { noteName } from '../../music/spelling';
import { percentile } from '../controller';
import { useControllerState } from '../useController';
import { Icon } from './Icon';

const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v * 1000)} ms`);

export function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const c = useControllerState();
  const s = c.snap;
  const key = c.keyAccidentalsAt(s.gate?.tick ?? 0);
  const n = (p: number) => noteName(p, key);
  const info = c.audio.input;
  const cap = c.capabilities;
  const accept = c.settings.matcher.acceptConfidence;
  const rejectCounts = new Map<string, number>();
  for (const r of c.recentRejections) rejectCounts.set(r.reason, (rejectCounts.get(r.reason) ?? 0) + 1);
  const ctx = c.audio.ctx;
  return (
    <aside className="diag" aria-label="Diagnostics">
      <header>
        <h2>Diagnostics</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close diagnostics">
          <Icon name="close" />
        </button>
      </header>
      <section>
        <h3>Engine</h3>
        <dl className="kv">
          <dt>State</dt>
          <dd data-testid="diag-state">{s.state}</dd>
          <dt>Mode</dt>
          <dd>{s.mode}</dd>
          <dt>Generation</dt>
          <dd>{s.generation}</dd>
          <dt>Gate</dt>
          <dd>{s.gate ? `#${s.gate.index + 1}/${c.engine.eventList.length} · bar ${s.gate.bar} · ${s.gate.pitches.map(n).join(' ')}` : '—'}</dd>
          <dt>Song time</dt>
          <dd>
            {s.songTime.toFixed(2)} s at {Math.round(s.rate * 100)}%
          </dd>
        </dl>
        {s.tones.length > 0 && (
          <table className="mini">
            <thead>
              <tr>
                <th>Note</th>
                <th>Status</th>
                <th>Conf.</th>
              </tr>
            </thead>
            <tbody>
              {s.tones.map((t) => (
                <tr key={t.pitch}>
                  <td>{n(t.pitch)}</td>
                  <td>
                    {t.status}
                    {t.maskedBy !== undefined ? ` (overlaps ${n(t.maskedBy)})` : ''}
                  </td>
                  <td>{t.confidence ? t.confidence.toFixed(2) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {s.extraNotes.length > 0 && <p>Other notes heard: {s.extraNotes.map(n).join(', ')}</p>}
        {c.lastResult && (
          <p>
            Last gate: {c.lastResult.kind} after {c.lastResult.waited.toFixed(2)} s waiting
          </p>
        )}
      </section>
      <section>
        <h3>Input</h3>
        {info ? (
          <dl className="kv">
            <dt>Device</dt>
            <dd>{info.label}</dd>
            <dt>Context</dt>
            <dd>
              {info.contextRate} Hz, {c.audio.contextState}
            </dd>
            <dt>Detector rate</dt>
            <dd>{cap?.sampleRate ?? '—'} Hz</dd>
            {info.processing.map((p) => (
              <FragRow key={p.name} k={p.name} v={p.applied === undefined ? 'not reported' : p.applied ? 'ON (requested off)' : 'off'} />
            ))}
            <dt>Latency</dt>
            <dd>
              base {Math.round(info.baseLatency * 1000)} ms · output {ctx && 'outputLatency' in ctx ? Math.round((ctx.outputLatency || 0) * 1000) : '—'} ms
            </dd>
            <dt>Level</dt>
            <dd>
              {c.levels.rmsDb.toFixed(1)} dBFS rms · peak {(20 * Math.log10(Math.max(1e-6, c.levels.peak))).toFixed(1)} dBFS
            </dd>
            <dt>Noise floor</dt>
            <dd>
              {c.settings.noiseRmsDb !== null ? `${c.settings.noiseRmsDb.toFixed(0)} dBFS (measured)` : 'adaptive (not measured)'} · spectral {c.levels.noiseDb.toFixed(0)} dB
            </dd>
            <dt>Unexplained</dt>
            <dd title="Share of the spectrum the piano model cannot explain: noise, voice, other instruments">{Math.round(c.levels.residual * 100)}%</dd>
          </dl>
        ) : (
          <p className="muted">Microphone off.</p>
        )}
      </section>
      <section>
        <h3>Timing (measured)</h3>
        <dl className="kv">
          <dt>Key press → decision</dt>
          <dd>
            median {ms(percentile(c.latency.decision, 0.5))} · p90 {ms(percentile(c.latency.decision, 0.9))} (n={c.latency.decision.length})
          </dd>
          <dt>Newest sample → app</dt>
          <dd>
            median {ms(percentile(c.latency.pipeline, 0.5))} · p90 {ms(percentile(c.latency.pipeline, 0.9))}
          </dd>
          <dt>Worker per frame</dt>
          <dd>{(percentile(c.latency.processMsPerFrame, 0.5) ?? 0).toFixed(1)} ms</dd>
          <dt>Queue / dropped</dt>
          <dd>
            {Math.round(c.latency.queueSeconds * 1000)} ms · {c.latency.droppedChunks} chunks
          </dd>
        </dl>
        <p className="hint">“Key press → decision” runs from the estimated attack time in the audio to the result reaching the app. Add your system’s input latency (not measurable from the browser) and one display frame.</p>
      </section>
      <section>
        <h3>Recent onsets</h3>
        {c.recentOnsets.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <table className="mini" data-testid="diag-onsets">
            <thead>
              <tr>
                <th>Note</th>
                <th>Conf.</th>
                <th>Uniq.</th>
                <th>Rel.</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {c.recentOnsets
                .slice(-12)
                .reverse()
                .map((o) => (
                  <tr key={o.id} className={o.confidence >= accept ? '' : 'dim'}>
                    <td>{n(o.pitch)}</td>
                    <td>{o.confidence.toFixed(2)}</td>
                    <td>{o.unique.toFixed(2)}</td>
                    <td>{o.relative.toFixed(2)}</td>
                    <td>
                      {[o.transient ? 'attack' : '', o.reattack ? 're-strike' : '', o.harmonicOf !== undefined ? `partial of ${n(o.harmonicOf)}?` : ''].filter(Boolean).join(', ')}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        {rejectCounts.size > 0 && (
          <p className="hint">
            Rejected in last 3 s:{' '}
            {[...rejectCounts]
              .map(([r, k]) => `${r} ×${k}`)
              .join(', ')}
          </p>
        )}
      </section>
      {cap && (
        <section>
          <h3>Detector</h3>
          <p>
            {cap.label} <code>{cap.id}</code>
          </p>
          <ul className="plain small">
            {cap.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}
      {c.song && (
        <section>
          <h3>Piece</h3>
          <dl className="kv">
            <dt>Notes</dt>
            <dd>{c.song.notes.length}</dd>
            <dt>Tracks</dt>
            <dd>{c.song.tracks.map((t) => `${t.label} (${t.noteCount})`).join(', ')}</dd>
            <dt>Hands</dt>
            <dd>{c.song.handMapping ? `${c.song.handMapping.method} (${c.song.handMapping.unassigned} unassigned)` : 'no validated mapping'}</dd>
            <dt>Tempo</dt>
            <dd>{c.song.tempos.map((t) => `${t.bpm} qpm`).join(', ')}</dd>
            <dt>Keys</dt>
            <dd>{c.song.keys.map((k) => k.name).join(' → ')}</dd>
            {c.song.provenance?.sha256 && (
              <>
                <dt>SHA-256</dt>
                <dd className="mono">{c.song.provenance.sha256.slice(0, 16)}…</dd>
              </>
            )}
          </dl>
          {c.song.warnings.length > 0 && (
            <ul className="plain small">
              {c.song.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </aside>
  );
}

function FragRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
