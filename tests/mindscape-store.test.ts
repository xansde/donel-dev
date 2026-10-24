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
  it('loads the empty document when the file is missing or unreadable', () => {
    expect(createMindscapeStore(FILE, memoryIo().io).load()).toEqual(emptyMindscapeDoc());
    expect(createMindscapeStore(FILE, memoryIo({ [FILE]: '{nope' }).io).load()).toEqual(emptyMindscapeDoc());
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
    const newer = JSON.stringify({ schemaVersion: 2, boards: {}, future: true });
    const { io, files, calls } = memoryIo({ [FILE]: newer });
    const store = createMindscapeStore(FILE, io);
    store.load();
    expect(store.save(placeSessionCard(emptyMindscapeDoc(), 'C:/work/atlas', 's1'))).toEqual({ ok: false, reason: 'read-only' });
    expect(files[FILE]).toBe(newer);
    expect(calls.filter((call) => call.startsWith('write:') || call.startsWith('rename:'))).toEqual([]);
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
