import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mix, uiowa } from '../detector/audio-utils';

/**
 * Builds the fake microphone signal: 2.5 s of silence, then F5 + A♭5 (the first right-hand chord of
 * Clair de lune) from the recorded Steinway, then silence. Chromium loops the file.
 */
export default function globalSetup(): void {
  const f5 = uiowa(77);
  const ab5 = uiowa(80);
  if (!f5 || !ab5) throw new Error('Audio fixtures missing: run "npm run fetch:fixtures" before the browser tests.');
  const rate = f5.rate;
  const clip = mix(rate, 6, [
    { clip: f5, at: 2.5, gain: 1.2 },
    { clip: ab5, at: 2.51, gain: 1.1 },
  ]);
  const data = Buffer.alloc(44 + clip.data.length * 2);
  data.write('RIFF', 0, 'latin1');
  data.writeUInt32LE(36 + clip.data.length * 2, 4);
  data.write('WAVE', 8, 'latin1');
  data.write('fmt ', 12, 'latin1');
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36, 'latin1');
  data.writeUInt32LE(clip.data.length * 2, 40);
  for (let i = 0; i < clip.data.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(clip.data[i]! * 32767))), 44 + i * 2);
  const dir = join(process.cwd(), 'test-results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fake-mic.wav'), data);
}
