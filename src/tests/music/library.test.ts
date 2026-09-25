import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { parseMidi } from '../../music/parse';
import { buildEvents } from '../../music/events';

interface Entry { id: string; title: string; composer: string; file: string; sha256: string; license: string }
const library = JSON.parse(readFileSync('public/songs/library.json', 'utf8')) as Entry[];

describe('bundled practice library', () => {
  test('has 49 pieces with a licence and unique ids', () => {
    expect(library).toHaveLength(49);
    expect(new Set(library.map((e) => e.id)).size).toBe(49);
    for (const e of library) expect(e.license).toMatch(/Public Domain|Creative Commons/);
  });

  test.each(library.map((e) => [e.title, e] as const))('%s: checksum matches and it parses into practice events', (_t, e) => {
    const bytes = readFileSync(`public/songs/${e.file}`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(e.sha256);
    const song = parseMidi(new Uint8Array(bytes), { id: e.id, title: e.title, composer: e.composer });
    expect(song.notes.length).toBeGreaterThan(10);
    expect(song.bars.length).toBeGreaterThan(0);
    expect(buildEvents(song, { kind: 'all' }).length).toBeGreaterThan(5);
  });
});
