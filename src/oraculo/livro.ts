// F6 do ledger bom (docs/planos/ledger-bom.md) — the journal (the F1 format, `src/shared/livro/formato.ts`) on the
// daemon, read incrementally and appended to by every end: crons, workflows and bots with the service credential, the
// PC with its own token. Off unless the daemon is started with `DONEL_LIVRO_ARQUIVO` (main.ts): until F4 (the writer
// in shadow, which waits for the owner's letter) nothing in the app reads it, so a daemon that did not ask for it has
// no route at all.
//
// One writer (this daemon, one process): each append is one canonical line with its newline in a single write, then
// fsync. A last line with no newline (the process died mid-write) is cut on load, so it is never read and never glued
// to the next entry. The key (`chave`) makes a retry harmless (F1: same content answers the entry already there,
// other content is refused). An entry the projection would refuse (F2 rules, F9 rules) is answered with the reason
// and not appended: the caller learns it now instead of finding it "recusado" later.

import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LedgerActor } from '../shared/ledger/contract';
import { appendEntry, readJournal, serializeJournal, type JournalLine, type LivroType, LIVRO_TYPES } from '../shared/livro/formato';
import { projectJournal } from '../shared/livro/projecao';

export const LIVRO_PATH = '/v1/livro';
/** Default and most entries one read returns; the reader asks again from the last seq. */
export const LIVRO_PAGE = 100;
export const LIVRO_MAX_PAGE = 1000;

/** What a caller asks to append: the entry without id, time, author, chain or hash (the daemon sets them). */
export interface Rascunho {
  readonly tipo: LivroType;
  readonly tarefa: string;
  readonly dados: Readonly<Record<string, unknown>>;
  readonly chave: string;
}

/** An entry as stored (the F1 line without the reader's `kind`). */
export type LivroLinha = Readonly<Record<string, unknown>>;

export type LancarResult = { readonly ok: true; readonly lancamento: LivroLinha; readonly novo: boolean } | { readonly ok: false; readonly status: 400 | 409; readonly error: string };

export interface LivroStore {
  ler(query: { readonly desde?: number; readonly ultimos?: number; readonly limite?: number }): { readonly lancamentos: readonly LivroLinha[]; readonly ultimo: number };
  lancar(quem: LedgerActor, rascunho: Rascunho): LancarResult;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A draft from a request body (`quem` stays out: it comes from the token, or the PC names it beside). */
export function parseRascunho(value: unknown, extraKeys: readonly string[] = []): Rascunho | string {
  if (!isRecord(value)) return 'corpo não é um objeto';
  const extra = Object.keys(value).find((key) => !['tipo', 'tarefa', 'dados', 'chave', ...extraKeys].includes(key));
  if (extra) return `campo desconhecido: ${extra}`;
  const { tipo, tarefa, dados, chave } = value;
  if (typeof tipo !== 'string' || !LIVRO_TYPES.includes(tipo as LivroType)) return `tipo desconhecido: ${String(tipo)}`;
  if (typeof tarefa !== 'string' || !tarefa.trim()) return 'tarefa obrigatória';
  if (!isRecord(dados)) return 'dados é um objeto';
  if (typeof chave !== 'string' || !chave.trim()) return 'chave obrigatória';
  return { tipo: tipo as LivroType, tarefa, dados, chave };
}

const stored = (line: JournalLine): LivroLinha => {
  if (line.kind === 'newer') return line.raw;
  const { kind: _kind, ...entry } = line;
  return entry;
};

function loadJournal(filePath: string): JournalLine[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
  const end = raw.lastIndexOf('\n') + 1;
  if (end < raw.length) truncateSync(filePath, Buffer.byteLength(raw.slice(0, end), 'utf8'));
  const read = readJournal(raw.slice(0, end));
  // A journal that does not check out is never appended to (the next line would chain onto a lie).
  if (read.problems.length) throw new Error(`livro: ${read.problems.map((problem) => `linha ${problem.seq}: ${problem.reason}`).join('; ')}`);
  return read.lines;
}

export function createLivroStore(options: { readonly filePath: string; readonly now?: () => number }): LivroStore {
  const { filePath } = options;
  const now = options.now ?? Date.now;
  // Loaded on the first call: a journal that does not check out fails the call, never gets written over.
  let lines: JournalLine[] | null = null;
  const all = (): JournalLine[] => (lines ??= loadJournal(filePath));

  return {
    ler({ desde, ultimos, limite }) {
      const list = all();
      const page = Math.min(Math.max(1, Math.floor(limite ?? LIVRO_PAGE)), LIVRO_MAX_PAGE);
      const from = ultimos !== undefined ? Math.max(0, list.length - Math.min(Math.max(0, Math.floor(ultimos)), page)) : Math.max(0, Math.floor(desde ?? 0));
      return { lancamentos: list.slice(from, from + page).map(stored), ultimo: list.length };
    },
    lancar(quem, draft) {
      const list = all();
      const appended = appendEntry(list, { id: randomUUID(), em: now(), quem, ...draft });
      if (!appended.ok) return { ok: false, status: list.some((line) => line.chave === draft.chave) ? 409 : 400, error: appended.reason };
      if (appended.repeated) return { ok: true, lancamento: stored(appended.entry), novo: false };
      const step = projectJournal(appended.lines).steps.at(-1);
      if (step?.status === 'recusado') return { ok: false, status: 409, error: step.reason ?? 'recusado pelas regras' };
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      const fd = openSync(filePath, 'a', 0o600);
      try {
        writeSync(fd, serializeJournal([appended.entry]));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      lines = appended.lines;
      return { ok: true, lancamento: stored(appended.entry), novo: true };
    },
  };
}
