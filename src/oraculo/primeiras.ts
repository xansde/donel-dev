// t-f66595b2 — the opening request of a session the PC opened, kept on this machine until its CLI is up.
//
// A `sessao_abrir` the PC answers (its tunnel took it) opens a tab whose claude.sh may wait for hours in the limitador
// (`limitador.py espera`, up to 240 min). The app types the request only within 240 s of opening the tab and keeps it
// in memory: past that, the CLI came up on an empty box and nobody typed it (20/11: three places alive for hours on an
// empty box). This gate sees the request and the PC's answer (the place's id), so it keeps both here
// (`<oraculo>/primeiras.json`, mode 600, temp → rename). The recados loop (recados.ts) turns the entry into an item of
// its own queue once the session of that place is up on this machine, never had a turn, and its box has been empty and
// still for a while: from then on that queue types it once and confirms it by the transcript. A session whose
// conversation already started (the PC typed it in time) drops the entry. What no session here claims goes after a day.
//
// A session opened here with the PC off (abrir-local.ts) never comes through this: its request waits in
// `~/.donel/s/<sid>/pedido` and goes to the CLI as its first argument (remote-session.ts).

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_PIPELINE_TAG } from '../shared/chat/noPipeline';

export const FIRST_MESSAGES_FILE = 'primeiras.json';

export interface FirstMessage {
  readonly placeId: string;
  readonly pedido: string;
  /** When the PC answered the opening (ms). */
  readonly em: number;
  /** sha256 of the request trimmed (`requestHashes`): the PC's paste of it, found as the session's first message, drops it. */
  readonly hash: string;
  /** sha256 of the request with its line breaks collapsed into spaces (what tmux types, `typeable`). */
  readonly hashPlano: string;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const TAG_AT_END = new RegExp(`\\s*${NO_PIPELINE_TAG}\\s*$`, 'i');

/**
 * t-f66595b2 (condição do Líder) — the two hashes a request is known by: trimmed, and with its line breaks collapsed
 * into spaces (the PC pastes it with them; tmux types it without). The app adds its "#sem-esteira" tag at the end of
 * what it pastes (noPipeline.ts): never part of the request, on either side.
 */
export function requestHashes(text: string): { readonly hash: string; readonly hashPlano: string } {
  const trimmed = text.trim().replace(TAG_AT_END, '').trim();
  const flat = trimmed.replace(/\s*[\u0000-\u001f\u007f-\u009f]+\s*/g, ' ').trim();
  return { hash: sha256(trimmed), hashPlano: sha256(flat) };
}

/** `text` (a session's first message) is the request these hashes stand for, with or without its line breaks. */
export function isSameRequest(kept: { readonly hash: string; readonly hashPlano: string }, text: string): boolean {
  const seen = requestHashes(text);
  return seen.hash === kept.hash || seen.hashPlano === kept.hashPlano;
}

/** An entry no session of this machine claimed in this long is for another machine, or a place that never opened. */
const KEEP_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entries kept (an unreadable or missing file = none). */
export function readFirstMessages(file: string): FirstMessage[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!isRecord(raw) || !Array.isArray(raw.items)) return [];
    return raw.items.flatMap((item): FirstMessage[] => {
      if (!isRecord(item) || typeof item.placeId !== 'string' || !item.placeId || typeof item.pedido !== 'string' || typeof item.em !== 'number') return [];
      // An entry kept before the hashes (round 1) gets them from its own request.
      const hashes = typeof item.hash === 'string' && typeof item.hashPlano === 'string' ? { hash: item.hash, hashPlano: item.hashPlano } : requestHashes(item.pedido);
      return [{ placeId: item.placeId, pedido: item.pedido, em: item.em, ...hashes }];
    });
  } catch {
    return [];
  }
}

function writeFirstMessages(file: string, items: readonly FirstMessage[]): void {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tmp, JSON.stringify({ items }, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing was written
    }
    throw error;
  }
}

/** Keeps the request of a place the PC opened (a repeat of the same place replaces it); old entries go. */
export function rememberFirstMessage(file: string, placeId: string, pedido: string, at: number): void {
  const kept = readFirstMessages(file).filter((item) => item.placeId !== placeId && at - item.em < KEEP_MS);
  writeFirstMessages(file, [...kept, { placeId, pedido, em: at, ...requestHashes(pedido) }]);
}

/** Drops the entry of `placeId` and the ones too old to be claimed. */
export function forgetFirstMessage(file: string, placeId: string, at: number): void {
  const items = readFirstMessages(file);
  const kept = items.filter((item) => item.placeId !== placeId && at - item.em < KEEP_MS);
  if (kept.length !== items.length) writeFirstMessages(file, kept);
}

/** The folder of the long requests (`<oraculo>/primeiras/`, mode 700: a request is the owner's words). */
export const FIRST_FILES_DIR = 'primeiras';

/** Writes the whole of a long request for `sid` (600, in a 700 folder) and gives its path. */
export function writeLongRequest(oraculoDir: string, sid: string, pedido: string): string {
  const folder = join(oraculoDir, FIRST_FILES_DIR);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // A folder made before (round 1, with the umask) is closed too.
  chmodSync(folder, 0o700);
  const path = join(folder, `${sid}.md`);
  writeFileSync(path, pedido, { mode: 0o600 });
  return path;
}

/**
 * Removes the long requests no longer needed: `done(sid)` (its item was delivered, went stale or is gone), or older
 * than a day (the validity of an entry). What could not be removed waits for the next round.
 */
export function sweepLongRequests(oraculoDir: string, done: (sid: string) => boolean, at: number): void {
  const folder = join(oraculoDir, FIRST_FILES_DIR);
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const path = join(folder, name);
    try {
      if (done(name.slice(0, -3)) || at - statSync(path).mtimeMs >= KEEP_MS) unlinkSync(path);
    } catch {
      // gone already, or not ours to remove
    }
  }
}

/** The place a `sessao_abrir` answer of the PC opened (its `lugar`); `null` = an error, or not that answer. */
export function openedPlaceOf(answer: { readonly status: number; readonly body: string }): string | null {
  if (answer.status !== 200) return null;
  try {
    const parsed = JSON.parse(answer.body) as unknown;
    const result = isRecord(parsed) && isRecord(parsed.result) ? parsed.result : null;
    if (!result || result.isError === true || !Array.isArray(result.content)) return null;
    const first: unknown = result.content[0];
    if (!isRecord(first) || typeof first.text !== 'string') return null;
    const text = JSON.parse(first.text) as unknown;
    return isRecord(text) && typeof text.lugar === 'string' && /^place:[A-Za-z0-9-]{1,80}$/.test(text.lugar) ? text.lugar : null;
  } catch {
    return null;
  }
}

/** The place a session of this machine was opened for (`placeId` of `<sessionsDir>/<sid>/meta.json`). */
export function placeOfSessionIn(sessionsDir: string): (sid: string) => string | undefined {
  return (sid) => {
    try {
      const raw = JSON.parse(readFileSync(join(sessionsDir, sid, 'meta.json'), 'utf8')) as unknown;
      return isRecord(raw) && typeof raw.placeId === 'string' ? raw.placeId : undefined;
    } catch {
      return undefined;
    }
  };
}
