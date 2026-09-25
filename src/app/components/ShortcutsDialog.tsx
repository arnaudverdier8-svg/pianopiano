import { Modal } from './Modal';

const KEYS: [string, string][] = [
  ['Space', 'Continue past the chord at the line (recorded as manual); when stopped, start'],
  ['K or P', 'Start / pause'],
  ['R', 'Restart (from loop A if a loop is set)'],
  ['← / →', 'Previous / next bar'],
  ['↑ / ↓', 'Tempo ±5%'],
  ['A / B / X', 'Set loop start / loop end / clear loop'],
  ['H', 'Hear the next two bars'],
  ['M', 'Microphone on / off'],
  ['1 2 3 4', 'Learn / Listen / Single note / Manual'],
  ['Shift + ← / →', 'Move the keyboard view an octave'],
  ['+ / −', 'Zoom the keyboard view'],
  ['N', 'Note names on / off'],
  ['F', 'Fullscreen'],
  ['D', 'Diagnostics panel'],
  ['?', 'This list'],
  ['Esc', 'Close a dialog'],
  ['Enter', 'Press the focused button (Space is reserved for practice)'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {KEYS.map(([k, v]) => (
            <tr key={k}>
              <th>
                <kbd>{k}</kbd>
              </th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
