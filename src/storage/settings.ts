import type { MatcherSettings, PracticeMode } from '../practice/types';
import { DEFAULT_MATCHER } from '../practice/types';
import { readJson, writeJson } from './local';

export type PartChoice = 'both' | 'right' | 'left' | 'upper' | 'lower' | `track:${number}`;

export interface AppSettings {
  version: 1;
  mode: PracticeMode;
  part: PartChoice;
  tempo: number; // 0.25..1.5
  labels: boolean;
  colorBy: 'hand' | 'track';
  keyRange: 'piece' | 'full' | 'custom';
  customRange: [number, number];
  matcher: MatcherSettings;
  sensitivity: number;
  tuningCents: number;
  /** Noise spectrum from the setup step (log-frequency bins); null until measured. */
  noiseProfile: number[] | null;
  noiseRmsDb: number | null;
  deviceId: string | null;
  accompaniment: boolean;
  accompanimentAcknowledged: boolean;
  playbackVolume: number;
  showDiagnostics: boolean;
  reducedMotion: boolean;
  /** Song seconds visible above the strike line. */
  lookahead: number;
  /** Seen the first-run setup explanation. */
  setupDone: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  mode: 'learn',
  part: 'right',
  tempo: 0.6,
  labels: true,
  colorBy: 'hand',
  keyRange: 'piece',
  customRange: [36, 96],
  matcher: DEFAULT_MATCHER,
  sensitivity: 1,
  tuningCents: 0,
  noiseProfile: null,
  noiseRmsDb: null,
  deviceId: null,
  accompaniment: false,
  accompanimentAcknowledged: false,
  playbackVolume: 0.8,
  showDiagnostics: false,
  reducedMotion: false,
  lookahead: 6,
  setupDone: false,
};

const KEY = 'moonlight.settings.v1';

export function loadSettings(): AppSettings {
  const s = readJson<AppSettings>(KEY, DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...s, matcher: { ...DEFAULT_MATCHER, ...s.matcher }, tempo: Math.max(0.25, Math.min(1.5, Number(s.tempo) || 0.6)) };
}

export function saveSettings(s: AppSettings): void {
  writeJson(KEY, s);
}
