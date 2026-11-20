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

import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIRST_MESSAGES_FILE = 'primeiras.json';

export interface FirstMessage {
  readonly placeId: string;
  readonly pedido: string;
  /** When the PC answered the opening (ms). */
  readonly em: number;
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
    return raw.items.filter(
      (item): item is FirstMessage => isRecord(item) && typeof item.placeId === 'string' && item.placeId.length > 0 && typeof item.pedido === 'string' && typeof item.em === 'number',
    );
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
  writeFirstMessages(file, [...kept, { placeId, pedido, em: at }]);
}

/** Drops the entry of `placeId` and the ones too old to be claimed. */
export function forgetFirstMessage(file: string, placeId: string, at: number): void {
  const items = readFirstMessages(file);
  const kept = items.filter((item) => item.placeId !== placeId && at - item.em < KEEP_MS);
  if (kept.length !== items.length) writeFirstMessages(file, kept);
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
