import { readJson, writeJson } from './local';

/** What actually happened in a session — never a "mastery" score. */
export interface SessionRecord {
  startedAt: string;
  endedAt: string;
  mode: string;
  part: string;
  tempo: number;
  fromBar: number;
  toBar: number;
  recognized: number;
  withUncertainParts: number;
  manual: number;
}

export interface SongProgress {
  position: number; // song seconds
  /** Practice loop in song seconds; null = no loop. Absent in records from before loops were saved. */
  loop?: { a: number; b: number } | null;
  updatedAt: string;
  sessions: SessionRecord[];
}

const KEY = 'moonlight.progress.v1';
type Store = Record<string, SongProgress>;

export function loadProgress(songId: string): SongProgress | null {
  return readJson<Store>(KEY, {})[songId] ?? null;
}

export function savePosition(songId: string, position: number, loop?: { a: number; b: number } | null): void {
  const store = readJson<Store>(KEY, {});
  const cur = store[songId] ?? { position: 0, updatedAt: '', sessions: [] };
  store[songId] = { ...cur, position, ...(loop !== undefined ? { loop } : {}), updatedAt: new Date().toISOString() };
  writeJson(KEY, store);
}

export function addSession(songId: string, rec: SessionRecord): void {
  if (rec.recognized + rec.withUncertainParts + rec.manual === 0) return;
  const store = readJson<Store>(KEY, {});
  const cur = store[songId] ?? { position: 0, updatedAt: '', sessions: [] };
  store[songId] = { ...cur, sessions: [...cur.sessions, rec].slice(-100), updatedAt: new Date().toISOString() };
  writeJson(KEY, store);
}

export function clearProgress(songId: string): void {
  const store = readJson<Store>(KEY, {});
  delete store[songId];
  writeJson(KEY, store);
}
