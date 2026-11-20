// t-b07b50ff (docs/adr/0011) — the letters that started waiting for the owner, for the phone's warnings. The registro
// (which sees the ledger) is the only writer of `avisos-cartas.json`; the entregador (which answers the phone) reads it
// when its mtime changes. `seq` = max(now, last + 1): it never goes back, not even when the file is deleted, so the
// phone's cursor (`k`) never repeats nor skips a letter.

import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { CARD_KINDS, type OwnerInboxItem } from '../shared/ledger/inbox';
import { lastDelivery } from '../shared/ledger/contract';
import { pushBodyFor, pushTitle } from '../main/celular/webpush';
import { avisavel, type EntradaCarta } from './avisos';

export const AVISOS_CARTAS_FILE = 'avisos-cartas.json';
const KEEP = 50;

export interface NovaCarta {
  readonly t: string;
  readonly kind: string;
  readonly since: number;
  readonly titulo: string;
  readonly texto: string;
}

interface CartasFile {
  readonly v: 1;
  readonly seq: number;
  readonly entradas: EntradaCarta[];
}

function read(file: string): CartasFile | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<CartasFile>;
    if (raw?.v !== 1 || typeof raw.seq !== 'number' || !Array.isArray(raw.entradas)) return null;
    return { v: 1, seq: raw.seq, entradas: raw.entradas.filter((e) => e && typeof e.seq === 'number' && typeof e.t === 'string') };
  } catch {
    return null;
  }
}

/** Pure: the items of the box that became letters (`CARD_KINDS`), with the human title and the question. */
export function entradasDeCartas(fresh: readonly OwnerInboxItem[]): NovaCarta[] {
  return fresh
    .filter((item) => CARD_KINDS.has(item.kind))
    .map((item) => ({
      t: item.task.id,
      kind: item.kind,
      since: item.since,
      titulo: pushTitle(item.task),
      texto: lastDelivery(item.task)?.forOwner?.question?.trim() || pushBodyFor(item.kind),
    }));
}

/** The registro's writer (temp → rename, 600); a letter without title or text is never written. */
export function createAvisosCartasWriter(file: string, now: () => number = Date.now): { add(cartas: readonly NovaCarta[]): number } {
  let last = 0;
  return {
    add(cartas) {
      const valid = cartas.filter((carta) => avisavel(carta.texto, carta.titulo));
      if (valid.length === 0) return 0;
      const current = read(file);
      last = Math.max(last, current?.seq ?? 0, ...(current?.entradas ?? []).map((e) => e.seq));
      const entradas = [...(current?.entradas ?? [])];
      for (const carta of valid) {
        const seq = Math.max(now(), last + 1);
        last = seq;
        entradas.push({ seq, id: `carta:${carta.t}:${carta.kind}:${carta.since}`, t: carta.t, kind: carta.kind, since: carta.since, titulo: carta.titulo, texto: carta.texto, em: new Date(now()).toISOString() });
      }
      const data: CartasFile = { v: 1, seq: last, entradas: entradas.slice(-KEEP) };
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, file);
      return valid.length;
    },
  };
}

/** The entregador's reader: the file read again only when it changed; missing or unreadable = none. */
export function createAvisosCartasReader(file: string): { entradas(): readonly EntradaCarta[] } {
  let seen: { readonly key: string; readonly entradas: readonly EntradaCarta[] } | null = null;
  return {
    entradas() {
      let key: string;
      try {
        const stat = statSync(file);
        key = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
      } catch {
        seen = null;
        return [];
      }
      if (seen?.key !== key) seen = { key, entradas: read(file)?.entradas ?? [] };
      return seen.entradas;
    },
  };
}
