import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfigIoDeps } from '../src/main/config-store';
import { createMindscapeStore, MINDSCAPE_FILE_ENV_VAR, mindscapeFilePath } from '../src/main/mindscape-store';
import { emptyMindscapeDoc, placeSessionCard } from '../src/shared/mindscape/model';

// Mindscape, fatia 01 — the store: the main is the only writer of
// `<userData>/mindscape.json`; temp → rename; a newer schema is read and never written.

const FILE = 'C:/data/mindscape.json';

function memoryIo(initial: Record<string, string> = {}): { io: ConfigIoDeps; files: Record<string, string>; calls: string[] } {
  const files: Record<string, string> = { ...initial };
  const calls: string[] = [];
  const io: ConfigIoDeps = {
    existsSync: (path) => path in files || path === 'C:/data',
    readFileText: (path) => files[path] ?? null,
    writeFileText: (path, content) => {
      calls.push(`write:${path}`);
      files[path] = content;
    },
    renameFile: (from, to) => {
      calls.push(`rename:${from}->${to}`);
      files[to] = files[from]!;
      delete files[from];
    },
    mkdirSync: (path) => {
      calls.push(`mkdir:${path}`);
    },
    unlinkFile: (path) => {
      calls.push(`unlink:${path}`);
      delete files[path];
    },
  };
  return { io, files, calls };
}

describe('mindscapeFilePath', () => {
  it('uses <userData>/mindscape.json, or the smoke override', () => {
    expect(mindscapeFilePath({}, 'C:/ud').replace(/\\/g, '/')).toBe('C:/ud/mindscape.json');
    expect(mindscapeFilePath({ [MINDSCAPE_FILE_ENV_VAR]: 'C:/tmp/m.json' }, 'C:/ud')).toBe('C:/tmp/m.json');
  });
});

describe('createMindscapeStore', () => {
  it('loads the empty document when the file is missing', () => {
    expect(createMindscapeStore(FILE, memoryIo().io).load()).toEqual(emptyMindscapeDoc());
  });

  // An empty board for a file that exists would be saved over it by the renderer:
  // the load fails instead, and the file stays as it was (handoffs/mindscape-revisao.md, item 3).
  it.each([
    ['invalid JSON', '{nope'],
    ['an empty file', ''],
    ['JSON that is not a document', '[1, 2]'],
    ['a document without boards', '{"schemaVersion": 2}'],
  ])('fails to load %s and leaves the file as it was', (_label, text) => {
    const { io, files, calls } = memoryIo({ [FILE]: text });
    expect(() => createMindscapeStore(FILE, io).load()).toThrow();
    expect(files[FILE]).toBe(text);
    expect(calls).toEqual([]);
  });

  it('fails to load a file that exists but cannot be read (a folder, a lock)', () => {
    const { io } = memoryIo();
    const unreadable: ConfigIoDeps = { ...io, existsSync: (path) => path === FILE || io.existsSync(path) };
    expect(() => createMindscapeStore(FILE, unreadable).load()).toThrow();
  });

  it('still loads a newer schemaVersion (read-only, never written)', () => {
    const newer = JSON.stringify({ schemaVersion: 3, boards: {}, future: true });
    expect(createMindscapeStore(FILE, memoryIo({ [FILE]: newer }).io).load()).toEqual(emptyMindscapeDoc());
  });

  it('saves through a temp file and a rename, and loads it back', () => {
    const { io, files, calls } = memoryIo();
    const store = createMindscapeStore(FILE, io);
    const doc = placeSessionCard(emptyMindscapeDoc(), 'C:/work/atlas', 's1');
    expect(store.save(doc)).toEqual({ ok: true });
    const write = calls.find((call) => call.startsWith('write:'))!;
    const tmp = write.slice('write:'.length);
    expect(tmp).not.toBe(FILE);
    expect(calls).toContain(`rename:${tmp}->${FILE}`);
    expect(Object.keys(files)).toEqual([FILE]);
    expect(createMindscapeStore(FILE, io).load()).toEqual(doc);
  });

  it('validates the payload before writing (never trusts the renderer)', () => {
    const { io, files } = memoryIo();
    const store = createMindscapeStore(FILE, io);
    expect(store.save({ boards: 'garbage' })).toEqual({ ok: true });
    expect(JSON.parse(files[FILE]!)).toEqual(emptyMindscapeDoc());
  });

  it('refuses to write over a newer schemaVersion and leaves the file as it was', () => {
    const newer = JSON.stringify({ schemaVersion: 3, boards: {}, future: true });
    const { io, files, calls } = memoryIo({ [FILE]: newer });
    const store = createMindscapeStore(FILE, io);
    store.load();
    expect(store.save(placeSessionCard(emptyMindscapeDoc(), 'C:/work/atlas', 's1'))).toEqual({ ok: false, reason: 'read-only' });
    expect(files[FILE]).toBe(newer);
    expect(calls.filter((call) => call.startsWith('write:') || call.startsWith('rename:'))).toEqual([]);
  });

  it('reads a v1 file and writes it back as v2 (desenho, fatia 01)', () => {
    const v1 = readFileSync(path.join(__dirname, 'fixtures/mindscape/v1-sample.json'), 'utf8');
    const { io, files } = memoryIo({ [FILE]: v1 });
    const store = createMindscapeStore(FILE, io);
    const doc = store.load();
    expect(doc.schemaVersion).toBe(2);
    expect(doc.boards['C:/work/atlas']!.drawings).toEqual([]);
    expect(store.save(doc)).toEqual({ ok: true });
    const written = JSON.parse(files[FILE]!) as { schemaVersion: number; boards: Record<string, { zoom: number; drawings: unknown[] }> };
    expect(written.schemaVersion).toBe(2);
    expect(written.boards['C:/work/atlas']).toMatchObject({ zoom: 1, drawings: [] });
  });

  it('reports write-failed and cleans the temp file when the rename fails', () => {
    const { io, files } = memoryIo();
    io.renameFile = () => {
      throw new Error('EPERM');
    };
    const store = createMindscapeStore(FILE, io);
    expect(store.save(emptyMindscapeDoc())).toEqual({ ok: false, reason: 'write-failed' });
    expect(Object.keys(files)).toEqual([]);
  });
});
