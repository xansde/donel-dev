// Mindscape (V1) — the store of `<userData>/mindscape.json`. Only the main
// writes it (single writer); the whole document goes through temp → fsync →
// rename (`ConfigIoDeps` of config-store.ts). `userData` is shared by the
// alfa/beta/stable channels: a `schemaVersion` newer than ours is read and
// never written (same principle as the header of esteira-store.ts).
// A file that exists but cannot be read, or is not a document, fails the load
// instead of coming back as an empty board: the renderer would save that empty
// board over it (handoffs/mindscape-revisao.md, item 3).

import { dirname, join } from 'node:path';
import type { ConfigIoDeps } from './config-store';
import type { MindscapeSaveResult } from '../shared/mindscape/channels';
import { emptyMindscapeDoc, MINDSCAPE_SCHEMA_VERSION, parseMindscapeDoc, type MindscapeDoc } from '../shared/mindscape/model';

/** Smoke override: isolates the board file from the real one. */
export const MINDSCAPE_FILE_ENV_VAR = 'DONEL_MINDSCAPE_FILE';

export function mindscapeFilePath(env: Record<string, string | undefined>, userDataPath: string): string {
  const override = env[MINDSCAPE_FILE_ENV_VAR];
  return override && override.trim() ? override : join(userDataPath, 'mindscape.json');
}

export interface MindscapeStore {
  /** Missing file → empty document. Throws when the file exists but is unreadable or not a document (the IPC rejects). */
  load(): MindscapeDoc;
  /** Validates `payload` with `parseMindscapeDoc` before writing — never trusts the renderer. */
  save(payload: unknown): MindscapeSaveResult;
}

function readRaw(filePath: string, io: ConfigIoDeps): unknown {
  const text = io.readFileText(filePath);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadDoc(filePath: string, io: ConfigIoDeps): MindscapeDoc {
  const text = io.readFileText(filePath);
  if (text === null) {
    if (io.existsSync(filePath)) throw new Error('mindscape.json exists but could not be read');
    return emptyMindscapeDoc();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('mindscape.json is not valid JSON');
  }
  if (!isRecord(raw) || !isRecord(raw.boards)) throw new Error('mindscape.json is not a Mindscape document');
  return parseMindscapeDoc(raw);
}

function isNewerSchema(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' && version > MINDSCAPE_SCHEMA_VERSION;
}

export function createMindscapeStore(filePath: string, io: ConfigIoDeps): MindscapeStore {
  return {
    load: () => loadDoc(filePath, io),
    save: (payload) => {
      // Re-read on every save: another channel may have upgraded the file meanwhile.
      if (isNewerSchema(readRaw(filePath, io))) return { ok: false, reason: 'read-only' };
      const doc = parseMindscapeDoc(payload);
      const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        const dir = dirname(filePath);
        if (!io.existsSync(dir)) io.mkdirSync(dir);
        io.writeFileText(tmpPath, JSON.stringify(doc, null, 2));
        io.renameFile(tmpPath, filePath);
        return { ok: true };
      } catch {
        io.unlinkFile(tmpPath);
        return { ok: false, reason: 'write-failed' };
      }
    },
  };
}
