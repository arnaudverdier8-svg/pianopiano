import { useControllerState } from '../useController';

export function SongState({ onImport }: { onImport: () => void }) {
  const c = useControllerState();
  const st = c.songStatus;
  if (st.kind === 'loading')
    return (
      <div className="song-state" role="status">
        Loading Clair de lune…
      </div>
    );
  return (
    <div className="song-state" role="alert" data-testid="song-missing">
      <h2>{st.kind === 'missing' ? 'The bundled piece is missing' : 'This piece could not be read'}</h2>
      <p>{st.kind === 'ready' ? '' : st.detail}</p>
      {st.kind === 'missing' && (
        <pre className="cmd">npm run fetch:song</pre>
      )}
      <div className="actions">
        <button className="btn primary" onClick={onImport}>
          Open a MIDI file…
        </button>
        <button className="btn" onClick={() => void c.loadBundled()}>
          Try again
        </button>
      </div>
      <p className="hint">You can also drag a .mid file onto this window.</p>
    </div>
  );
}
