// t-b07b50ff (docs/adr/0011) — the phone warns like a normal app: its foreground service keeps a signed long-poll on
// `GET /api/v2/avisos?desde=<cursor>&espera=<s>` (the entregador's 47815) and posts a native notification for each
// warning. Three sources: the Líder único's lines in the chat (`chat-local.json`, in memory here), the letters that
// started waiting for the owner (`avisos-cartas.json`, written by the registro) and the test queue of the gate.
// The owner (20/11): "Eu prefiro não receber mensagem do que receber uma mensagem vazia tua." A warning without text
// is never made: `avisavel` here, and again in the app.

import { isBlankReply } from '../shared/lider/blankReply';
import { JOINED_REPLY } from './chat-celular';

export const AVISO_VERSAO = 1;
export const AVISOS_MAX = 10;
export const AVISO_MAX_TITULO = 70;
export const AVISO_MAX_TEXTO = 300;
export const AVISO_MAX_BYTES = 2048;
export const AVISOS_ESPERA_MAX_S = 50;
const TICK_MS = 1_000;
const DAY_MS = 86_400_000;
/**
 * A cursor is old (the phone was away) when more than `AVISOS_MAX` warnings wait and the oldest is older than this: a
 * connected phone takes each one in seconds, so a pile only builds while it was away. Then only the 10 newest of the
 * last 24 h go, and the cursor jumps to the end (no night without network turning into dozens of vibrations).
 */
export const RETOMADA_MS = 5 * 60_000;
const CARTA_ID = /^t-[0-9a-f]{8}$/;
const LIDER_TITULO = 'Líder único';

export type AvisoTipo = 'chat' | 'carta' | 'teste';

export interface Aviso {
  readonly v: 1;
  readonly id: string;
  readonly tipo: AvisoTipo;
  readonly titulo: string;
  readonly texto: string;
  readonly abrir: { readonly tela: 'lider' | 'oraculo'; readonly carta?: string };
  readonly em: string;
}

export interface CursorAvisos {
  readonly c: { readonly em: string; readonly id: string };
  readonly k: number;
  readonly t: number;
}

/** One line of the conversation (`CelularLocalStore.conversa`). */
export interface LinhaDoChat {
  readonly id: string;
  readonly autor: 'dono' | 'lider';
  readonly texto: string;
  readonly criada_em: string;
}

/** One letter that started waiting, as `avisos-cartas.json` keeps it. */
export interface EntradaCarta {
  readonly seq: number;
  readonly id: string;
  readonly t: string;
  readonly kind: string;
  readonly since: number;
  readonly titulo: string;
  readonly texto: string;
  /** When it was written. */
  readonly em: string;
}

export interface EntradaTeste {
  readonly seq: number;
  readonly texto: string;
  readonly at: number;
}

export interface RespostaAvisos {
  readonly v: 1;
  readonly cursor: string;
  readonly mais: boolean;
  readonly avisos: Aviso[];
}

/** Pure: whether a text (and its title) may become a warning. */
export function avisavel(texto: string, titulo = LIDER_TITULO): boolean {
  if (typeof texto !== 'string' || typeof titulo !== 'string') return false;
  if (isBlankReply(texto) || isBlankReply(titulo)) return false;
  return texto.trim() !== JOINED_REPLY;
}

/** Pure: at most `max` characters (code points), the cut ending in "…". */
export function cortar(text: string, max: number): string {
  const trimmed = text.trim();
  const chars = Array.from(trimmed);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : trimmed;
}

/** The warning as it goes, cut to its limits and to 2048 serialized bytes; `null` = nothing to warn. */
function montar(base: Omit<Aviso, 'v' | 'titulo' | 'texto'>, titulo: string, texto: string): Aviso | null {
  if (!avisavel(texto, titulo)) return null;
  const t = cortar(titulo, AVISO_MAX_TITULO);
  let limit = AVISO_MAX_TEXTO;
  let aviso: Aviso = { v: AVISO_VERSAO, id: base.id, tipo: base.tipo, titulo: t, texto: cortar(texto, limit), abrir: base.abrir, em: base.em };
  while (Buffer.byteLength(JSON.stringify(aviso), 'utf8') > AVISO_MAX_BYTES && limit > 1) {
    limit = Math.max(1, Math.floor(limit * 0.8));
    aviso = { ...aviso, texto: cortar(texto, limit) };
  }
  if (Buffer.byteLength(JSON.stringify(aviso), 'utf8') > AVISO_MAX_BYTES) return null;
  return avisavel(aviso.texto.replace(/…$/, ''), aviso.titulo) ? aviso : null;
}

export function encodeCursor(cursor: CursorAvisos): string {
  return Buffer.from(JSON.stringify({ c: { em: cursor.c.em, id: cursor.c.id }, k: cursor.k, t: cursor.t }), 'utf8').toString('base64url');
}

/** `null` = unreadable. */
export function decodeCursor(value: string | null | undefined): CursorAvisos | null {
  if (typeof value !== 'string' || !value || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { c?: { em?: unknown; id?: unknown }; k?: unknown; t?: unknown };
    const { c, k, t } = raw ?? {};
    if (!c || typeof c.em !== 'string' || typeof c.id !== 'string') return null;
    if (typeof k !== 'number' || !Number.isFinite(k) || typeof t !== 'number' || !Number.isFinite(t)) return null;
    return { c: { em: c.em, id: c.id }, k, t };
  } catch {
    return null;
  }
}

/** `(a.em, a.id) > (b.em, b.id)`: by order, never by place in the file (a line the cursor names may be gone). */
const after = (row: { readonly criada_em: string; readonly id: string }, c: CursorAvisos['c']): boolean => row.criada_em > c.em || (row.criada_em === c.em && row.id > c.id);

const avisoDoChat = (row: LinhaDoChat): Aviso | null =>
  row.autor === 'lider' ? montar({ id: `chat:${row.id}`, tipo: 'chat', abrir: { tela: 'lider' }, em: row.criada_em }, LIDER_TITULO, row.texto) : null;

/** Pure: the Líder's lines after `c` (all of them with `null`), as warnings; the owner's never. */
export function avisosDoChat(rows: readonly LinhaDoChat[], c: CursorAvisos['c'] | null): Aviso[] {
  return [...rows]
    .filter((row) => c === null || after(row, c))
    .sort((a, b) => (a.criada_em === b.criada_em ? a.id.localeCompare(b.id) : a.criada_em < b.criada_em ? -1 : 1))
    .flatMap((row) => avisoDoChat(row) ?? []);
}

/** Pure: a letter's warning; `null` without title or text. */
export function avisoDeCarta(entry: EntradaCarta): Aviso | null {
  const abrir = CARTA_ID.test(entry.t) ? { tela: 'oraculo' as const, carta: entry.t } : { tela: 'oraculo' as const };
  return montar({ id: `carta:${entry.t}:${entry.kind}:${entry.since}`, tipo: 'carta', abrir, em: new Date(entry.since).toISOString() }, entry.titulo, entry.texto);
}

const avisoDeTeste = (entry: EntradaTeste): Aviso | null =>
  montar({ id: `teste:${entry.seq}`, tipo: 'teste', abrir: { tela: 'lider' }, em: new Date(entry.at).toISOString() }, 'Donel', entry.texto);

/** One thing after the cursor, from one of the three sources, in that source's order. */
export interface Pendente {
  readonly fonte: 'c' | 'k' | 't';
  readonly at: number;
  readonly pos: { readonly c?: CursorAvisos['c']; readonly n?: number };
  readonly aviso: Aviso | null;
}

/**
 * Pure: what goes in one answer. Older than 24 h never goes. Up to `AVISOS_MAX`, oldest first, the cursor right after
 * the last one sent (`mais` when more wait); an old cursor (see `RETOMADA_MS`) takes the 10 newest and jumps to the end.
 */
export function limitarRetomada(cursor: CursorAvisos, pendentes: readonly Pendente[], now: number): { avisos: Aviso[]; cursor: CursorAvisos; mais: boolean } {
  const fresh = (p: Pendente): boolean => p.aviso !== null && p.at >= now - DAY_MS;
  const advance = (base: CursorAvisos, p: Pendente): CursorAvisos =>
    p.fonte === 'c' ? { ...base, c: p.pos.c! } : p.fonte === 'k' ? { ...base, k: Math.max(base.k, p.pos.n!) } : { ...base, t: Math.max(base.t, p.pos.n!) };
  const sendable = pendentes.filter(fresh);
  if (sendable.length > AVISOS_MAX && now - sendable[0]!.at > RETOMADA_MS) {
    return { avisos: sendable.slice(-AVISOS_MAX).map((p) => p.aviso!), cursor: pendentes.reduce(advance, cursor), mais: false };
  }
  const avisos: Aviso[] = [];
  let next = cursor;
  for (const p of pendentes) {
    if (fresh(p)) {
      if (avisos.length === AVISOS_MAX) return { avisos, cursor: next, mais: true };
      avisos.push(p.aviso!);
    }
    next = advance(next, p);
  }
  return { avisos, cursor: next, mais: false };
}

/** The gate's test warnings (`POST /local/celular/aviso-teste`): in memory, the seq starts again on a restart. */
export function createAvisosTeste(now: () => number = Date.now): { add(): EntradaTeste; entradas(): readonly EntradaTeste[] } {
  let seq = 0;
  const kept: EntradaTeste[] = [];
  const hora = (ms: number): string =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ms));
  return {
    add() {
      const at = now();
      seq += 1;
      const entry = { seq, texto: `Teste de aviso ${hora(at)}`, at };
      kept.push(entry);
      if (kept.length > 20) kept.splice(0, kept.length - 20);
      return entry;
    },
    entradas: () => kept,
  };
}

export interface AvisosDeps {
  readonly conversa: () => readonly LinhaDoChat[];
  readonly cartas: () => readonly EntradaCarta[];
  readonly teste: () => readonly EntradaTeste[];
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export interface Avisos {
  /** One request of the device `device` (the name `verify` gave): waits up to `espera` s for a warning. */
  atender(device: string, query: URLSearchParams): Promise<RespostaAvisos>;
  /** Ends every request in wait (the daemon stops). */
  close(): void;
}

export function createAvisos(deps: AvisosDeps): Avisos {
  const now = deps.now ?? Date.now;
  const waiting = new Map<string, () => void>();

  const endCursor = (): CursorAvisos => {
    let c = { em: '', id: '' };
    for (const row of deps.conversa()) if (after(row, c)) c = { em: row.criada_em, id: row.id };
    const k = deps.cartas().reduce((max, entry) => Math.max(max, entry.seq), 0);
    const t = deps.teste().reduce((max, entry) => Math.max(max, entry.seq), 0);
    return { c, k, t };
  };

  /** Everything after the cursor, the three sources merged by time, each kept in its own order. */
  const pendentes = (cursor: CursorAvisos): Pendente[] => {
    const chat: Pendente[] = [...deps.conversa()]
      .filter((row) => after(row, cursor.c))
      .sort((a, b) => (a.criada_em === b.criada_em ? a.id.localeCompare(b.id) : a.criada_em < b.criada_em ? -1 : 1))
      .map((row) => ({ fonte: 'c', at: Date.parse(row.criada_em) || 0, pos: { c: { em: row.criada_em, id: row.id } }, aviso: avisoDoChat(row) }));
    const cartas: Pendente[] = deps
      .cartas()
      .filter((entry) => entry.seq > cursor.k)
      .sort((a, b) => a.seq - b.seq)
      .map((entry) => ({ fonte: 'k', at: entry.seq, pos: { n: entry.seq }, aviso: avisoDeCarta(entry) }));
    const testes: Pendente[] = deps
      .teste()
      .filter((entry) => entry.seq > cursor.t)
      .sort((a, b) => a.seq - b.seq)
      .map((entry) => ({ fonte: 't', at: entry.at, pos: { n: entry.seq }, aviso: avisoDeTeste(entry) }));
    // A merge of three ordered lists: a prefix of the result is a prefix of each one (the cursor never skips).
    const lists = [chat, cartas, testes];
    const idx = [0, 0, 0];
    const out: Pendente[] = [];
    for (;;) {
      let pick = -1;
      for (let i = 0; i < 3; i += 1) if (idx[i]! < lists[i]!.length && (pick < 0 || lists[i]![idx[i]!]!.at < lists[pick]![idx[pick]!]!.at)) pick = i;
      if (pick < 0) return out;
      out.push(lists[pick]![idx[pick]!]!);
      idx[pick] = idx[pick]! + 1;
    }
  };

  const responder = (cursor: CursorAvisos): RespostaAvisos | null => {
    const got = limitarRetomada(cursor, pendentes(cursor), now());
    return got.avisos.length ? { v: 1, cursor: encodeCursor(got.cursor), mais: got.mais, avisos: got.avisos } : null;
  };

  return {
    atender(device, query) {
      waiting.get(device)?.();
      const raw = query.get('desde');
      const cursor = raw === null ? null : decodeCursor(raw);
      if (raw !== null && cursor === null) deps.log?.('avisos cursor-invalido');
      if (cursor === null) return Promise.resolve({ v: 1, cursor: encodeCursor(endCursor()), mais: false, avisos: [] });
      const asked = Number.parseInt(query.get('espera') ?? '', 10);
      const espera = Number.isFinite(asked) ? Math.min(AVISOS_ESPERA_MAX_S, Math.max(1, asked)) : AVISOS_ESPERA_MAX_S;
      const now0 = responder(cursor);
      if (now0) return Promise.resolve(now0);
      const empty: RespostaAvisos = { v: 1, cursor: raw!, mais: false, avisos: [] };
      return new Promise<RespostaAvisos>((resolve) => {
        let done = false;
        const finish = (answer: RespostaAvisos): void => {
          if (done) return;
          done = true;
          clearInterval(tick);
          clearTimeout(deadline);
          if (waiting.get(device) === stop) waiting.delete(device);
          resolve(answer);
        };
        const stop = (): void => finish(empty);
        const tick = setInterval(() => {
          try {
            const got = responder(cursor);
            if (got) finish(got);
          } catch (error) {
            deps.log?.(`avisos leitura falhou: ${error instanceof Error ? error.message : String(error)}`);
          }
        }, TICK_MS);
        const deadline = setTimeout(stop, espera * 1000);
        waiting.set(device, stop);
      });
    },
    close() {
      for (const stop of [...waiting.values()]) stop();
    },
  };
}
