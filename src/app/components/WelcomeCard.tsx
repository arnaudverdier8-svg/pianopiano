import { useControllerState } from '../useController';

export function WelcomeCard({ onSetup }: { onSetup: () => void }) {
  const c = useControllerState();
  return (
    <div className="welcome" role="region" aria-label="Welcome">
      <h2>Practise with your own piano</h2>
      <p>
        MOONLIGHT listens through your computer’s microphone. The falling notes stop at the line and wait until you play them. Audio is analysed on this computer only. It is never recorded or sent anywhere.
      </p>
      <p className="hint">Starting point: the right hand, bars 1–4, at 60% tempo. You can change all of this below.</p>
      <div className="actions">
        <button className="btn primary" onClick={onSetup} data-testid="welcome-setup">
          Set up the microphone
        </button>
        <button
          className="btn"
          onClick={() => {
            c.setMode('manual');
            c.updateSettings({ setupDone: true });
          }}
        >
          Try without a microphone
        </button>
      </div>
    </div>
  );
}
