import { percentile } from '../controller';
import { useControllerState } from '../useController';

export function StatusBar() {
  const c = useControllerState();
  const s = c.snap;
  const status = c.statusText();
  const t = s.totals;
  const lat = percentile(c.latency.decision, 0.5);
  const waitingTone = s.state === 'waiting' ? 'waiting' : s.state === 'completed' ? 'done' : '';
  return (
    <div className={`statusbar ${waitingTone}`}>
      <div className="status-main" role="status" aria-live="polite" data-testid="status">
        {status}
      </div>
      {c.notice && (
        <div className="notice" role="alert">
          {c.notice}
          <button className="link" onClick={() => c.dismissNotice()} aria-label="Dismiss message">
            Dismiss
          </button>
        </div>
      )}
      <div className="status-side">
        {(s.mode === 'single' || s.mode === 'manual') && <span className="tag">{s.mode === 'single' ? 'Single-note aid: top note only' : 'Manual: no listening'}</span>}
        <span title="Gates resolved in this pass: recognized from the microphone / recognized with uncertain parts / advanced manually">
          <span className="sym ok">✓</span> <span data-testid="count-recognized">{t.recognized}</span> <span className="sym warn">~</span> <span data-testid="count-uncertain">{t.withUncertainParts}</span> <span className="sym">›</span>{' '}
          <span data-testid="count-manual">{t.manual}</span>
        </span>
        {c.mic.kind === 'on' && lat !== null && <span title="Median time from your key press (audio timestamp) to the decision reaching the app">{Math.round(lat * 1000)} ms</span>}
      </div>
    </div>
  );
}
