// O livro (plano `docs/planos/ledger-bom.md`, F1) — o formato do lançamento. Módulo puro, separado do Oráculo.
//
// Um bom ledger, no sentido padrão: o diário só cresce, nada se edita nem se apaga, corrigir é lançar de novo, e o
// estado de cada tarefa é derivado dos lançamentos (`projecao.ts`). No disco é um JSONL: uma linha por lançamento,
// em JSON canônico (chaves ordenadas, sem espaço), então a mesma linha sempre tem os mesmos bytes.
//
// Cada lançamento:
//   versao   — a versão do formato; uma maior (canal mais novo) é lida e guardada inteira, e o diário fica só leitura;
//   seq      — o número de ordem, 1, 2, 3… sem buraco;
//   id       — o id único do lançamento (quem grava escolhe);
//   em       — quando (ms);
//   quem     — o autor (`LedgerActor`: o dono ou um lugar);
//   tipo     — o que aconteceu (`LivroType`);
//   tarefa   — a tarefa que o lançamento toca (numa criação, o id que ela recebe);
//   dados    — o resto, um objeto JSON (numa operação, os campos da `LedgerOp` sem `op` nem `id`);
//   chave    — a chave de idempotência: o mesmo pedido de novo não grava outra vez; a mesma chave com outro conteúdo
//              é recusada;
//   anterior — o `hash` do lançamento anterior (`null` no primeiro): a cadeia;
//   hash     — sha256 do próprio lançamento em JSON canônico, sem o `hash`. Com ele, trocar um byte de um
//              lançamento aponta aquele lançamento, não o seguinte.
//
// A conferência (`readJournal`) aponta, por linha, o que não bate: JSON quebrado, forma não canônica, campo
// desconhecido, número de ordem fora do lugar, hash, cadeia, id ou chave repetidos.

import { createHash } from 'node:crypto';
import type { LedgerActor, LedgerOp } from '../ledger/contract';
import { FILA_TIPOS, type FilaTipo } from './fila';

export const LIVRO_VERSION = 1;

/**
 * O que um lançamento pode ser: uma operação de hoje (`applyLedgerOp`), um evento importado do ledger v4 (F3), ou
 * prioridade, pai e limite do quadro (F9, `fila.ts`).
 */
export type LivroOpType = LedgerOp['op'];
export type LivroType = LivroOpType | 'v4-evento' | FilaTipo;

export const LIVRO_OP_TYPES: readonly LivroOpType[] = [
  'criar',
  'frente',
  'assumir',
  'entregar',
  'aceitar',
  'decidir-outra',
  'comentar',
  'rejeitar',
  'carta-slack',
  'slack-enviada',
  'transferir',
  'cancelar',
  'slack-resultado',
  'slack-bot',
  'andamento',
];
export const LIVRO_TYPES: readonly LivroType[] = [...LIVRO_OP_TYPES, 'v4-evento', ...FILA_TIPOS];

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export interface LivroEntry {
  readonly versao: typeof LIVRO_VERSION;
  readonly seq: number;
  readonly id: string;
  readonly em: number;
  readonly quem: LedgerActor;
  readonly tipo: LivroType;
  readonly tarefa: string;
  readonly dados: JsonObject;
  readonly chave: string;
  readonly anterior: string | null;
  readonly hash: string;
}

/** Uma linha do diário: um lançamento desta versão, ou um de versão maior, guardado inteiro e só lido. */
export type JournalLine =
  | ({ readonly kind: 'entry' } & LivroEntry)
  | {
      readonly kind: 'newer';
      readonly versao: number;
      readonly seq: number;
      readonly chave: string;
      readonly anterior: string | null;
      readonly hash: string;
      readonly raw: JsonObject;
    };

/** O que quem grava pede: o lançamento sem versão, número de ordem, cadeia nem hash (o livro calcula). */
export interface EntryInput {
  readonly id: string;
  readonly em: number;
  readonly quem: LedgerActor;
  readonly tipo: LivroType;
  readonly tarefa: string;
  readonly dados: Readonly<Record<string, unknown>>;
  readonly chave: string;
}

export interface JournalProblem {
  /** A posição da linha (1, 2, 3…), que num diário são é o `seq` dela. */
  readonly seq: number;
  readonly reason: string;
}

export interface JournalRead {
  readonly lines: JournalLine[];
  readonly problems: JournalProblem[];
  /** Há lançamento de versão maior: este app lê, mas não acrescenta. */
  readonly readOnly: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// JSON canônico e hash

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON com as chaves ordenadas e sem espaço. Recusa (lança) o que não é JSON: número não finito, função, undefined em lista. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('número não finito');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error(`valor que não é JSON (${typeof value})`);
}

/** sha256 (hex) do lançamento em JSON canônico, sem o campo `hash`. */
export function entryHash(entry: Readonly<Record<string, unknown>>): string {
  const { hash: _ignored, ...rest } = entry;
  return createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------------------------------------------
// Parse estrito

const FIELDS = ['versao', 'seq', 'id', 'em', 'quem', 'tipo', 'tarefa', 'dados', 'chave', 'anterior', 'hash'] as const;
const HASH = /^[0-9a-f]{64}$/;
const MAX_ID_CHARS = 200;

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_CHARS;

function actorProblem(raw: unknown): string | null {
  if (!isRecord(raw)) return '"quem" não é um autor';
  if (raw.kind === 'dono') return Object.keys(raw).length === 1 ? null : '"quem" do dono só tem "kind"';
  if (raw.kind !== 'lugar') return '"quem" não é o dono nem um lugar';
  const extra = Object.keys(raw).find((key) => !['kind', 'placeId', 'roleId'].includes(key));
  if (extra) return `"quem" tem o campo desconhecido "${extra}"`;
  if (!nonEmpty(raw.placeId)) return '"quem.placeId" vazio';
  if (raw.roleId !== undefined && typeof raw.roleId !== 'string') return '"quem.roleId" não é texto';
  return null;
}

/** Por que os campos de um lançamento desta versão não valem; `null` = valem. Não confere hash nem cadeia. */
function entryProblem(raw: Record<string, unknown>): string | null {
  const extra = Object.keys(raw).find((key) => !(FIELDS as readonly string[]).includes(key));
  if (extra) return `campo desconhecido "${extra}" na versão ${LIVRO_VERSION}`;
  if (!Number.isInteger(raw.seq) || (raw.seq as number) < 1) return '"seq" não é um número de ordem';
  if (!nonEmpty(raw.id)) return '"id" vazio';
  if (typeof raw.em !== 'number' || !Number.isFinite(raw.em)) return '"em" não é uma hora';
  const actor = actorProblem(raw.quem);
  if (actor) return actor;
  if (!LIVRO_TYPES.includes(raw.tipo as LivroType)) return `"tipo" desconhecido "${String(raw.tipo)}"`;
  if (!nonEmpty(raw.tarefa)) return '"tarefa" vazia';
  if (!isRecord(raw.dados)) return '"dados" não é um objeto';
  if (!nonEmpty(raw.chave)) return '"chave" vazia';
  if (raw.anterior !== null && !(typeof raw.anterior === 'string' && HASH.test(raw.anterior))) return '"anterior" não é um hash';
  if (!(typeof raw.hash === 'string' && HASH.test(raw.hash))) return '"hash" não é um hash';
  return null;
}

/** O conteúdo que a chave protege: o mesmo pedido de novo (outro id, outra hora) tem o mesmo conteúdo. */
function contentOf(line: { quem?: unknown; tipo?: unknown; tarefa?: unknown; dados?: unknown }): string {
  return canonicalJson({ quem: line.quem, tipo: line.tipo, tarefa: line.tarefa, dados: line.dados });
}

function lineContent(line: JournalLine): string {
  return line.kind === 'entry' ? contentOf(line) : contentOf(line.raw);
}

function lineId(line: JournalLine): unknown {
  return line.kind === 'entry' ? line.id : line.raw.id;
}

/** Lê o diário (JSONL) e confere linha a linha. Uma linha com problema fica fora de `lines` e aparece uma vez em `problems`. */
export function readJournal(text: string): JournalRead {
  const rows = text.split('\n');
  if (rows.at(-1) === '') rows.pop();
  const lines: JournalLine[] = [];
  const problems: JournalProblem[] = [];
  const chaves = new Map<string, string>();
  const ids = new Set<unknown>();
  // The previous line's hash. After a line with a problem its true hash is unknown, so the next one's chain is not
  // judged (that line's own hash still covers its "anterior"): one changed byte points at one line, never two.
  let previous: string | null | 'unknown' = null;
  rows.forEach((row, index) => {
    const position = index + 1;
    const reasons: string[] = [];
    let raw: unknown;
    try {
      raw = JSON.parse(row);
    } catch {
      raw = undefined;
    }
    if (!isRecord(raw)) {
      problems.push({ seq: position, reason: 'a linha não é um lançamento em JSON' });
      previous = 'unknown';
      return;
    }
    let computed: string | null = null;
    try {
      computed = entryHash(raw);
      if (canonicalJson(raw) !== row) reasons.push('a linha não está na forma canônica');
    } catch (error) {
      reasons.push(`a linha não é JSON puro (${(error as Error).message})`);
    }
    if (computed !== null && raw.hash !== computed) reasons.push('o conteúdo não bate com o hash');
    if (raw.seq !== position) reasons.push(`"seq" ${String(raw.seq)} na posição ${position}`);
    const prev = previous;
    if (prev === null) {
      if (raw.anterior !== null) reasons.push('o primeiro lançamento tem "anterior"');
    } else if (prev !== 'unknown' && raw.anterior !== prev) {
      reasons.push('a cadeia quebra: "anterior" não é o hash do lançamento anterior');
    }
    const newer = Number.isInteger(raw.versao) && (raw.versao as number) > LIVRO_VERSION;
    if (!newer) {
      if (raw.versao !== LIVRO_VERSION) reasons.push(`"versao" ${String(raw.versao)} desconhecida`);
      else {
        const why = entryProblem(raw);
        if (why) reasons.push(why);
      }
    } else if (!nonEmpty(raw.chave) || typeof raw.hash !== 'string') {
      reasons.push('lançamento de versão maior sem "chave" ou "hash"');
    }
    previous = reasons.length === 0 ? (raw.hash as string) : 'unknown';
    if (reasons.length === 0) {
      const line: JournalLine = newer
        ? { kind: 'newer', versao: raw.versao as number, seq: position, chave: raw.chave as string, anterior: (raw.anterior as string | null) ?? null, hash: raw.hash as string, raw: raw as JsonObject }
        : ({ kind: 'entry', ...(raw as unknown as LivroEntry) } as JournalLine);
      const known = chaves.get(line.chave);
      if (known !== undefined && known !== lineContent(line)) reasons.push(`a chave "${line.chave}" já foi usada com outro conteúdo`);
      if (ids.has(lineId(line))) reasons.push(`o id "${String(lineId(line))}" se repete`);
      if (reasons.length === 0) {
        if (known === undefined) chaves.set(line.chave, lineContent(line));
        ids.add(lineId(line));
        lines.push(line);
        return;
      }
    }
    previous = 'unknown';
    problems.push({ seq: position, reason: reasons.join('; ') });
  });
  return { lines, problems, readOnly: lines.some((line) => line.kind === 'newer') };
}

/** O diário em JSONL, uma linha canônica por lançamento. */
export function serializeJournal(lines: readonly JournalLine[]): string {
  return lines.map((line) => `${canonicalJson(line.kind === 'entry' ? stored(line) : line.raw)}\n`).join('');
}

function stored(line: Extract<JournalLine, { kind: 'entry' }>): LivroEntry {
  const { kind: _kind, ...entry } = line;
  return entry;
}

// ---------------------------------------------------------------------------------------------------------------
// Acrescentar

export type AppendResult =
  | { readonly ok: true; readonly lines: JournalLine[]; readonly entry: JournalLine; readonly repeated: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Acrescenta um lançamento ao fim. A mesma chave com o mesmo conteúdo devolve o lançamento que já existe, sem gravar
 * outro (`repeated`); com outro conteúdo, recusa. Um diário com lançamento de versão maior é só leitura.
 */
export function appendEntry(lines: readonly JournalLine[], input: EntryInput): AppendResult {
  const fail = (reason: string): AppendResult => ({ ok: false, reason });
  if (lines.some((line) => line.kind === 'newer')) return fail('o diário tem lançamento de uma versão mais nova: este app só lê.');
  let dados: JsonObject;
  try {
    dados = JSON.parse(canonicalJson(input.dados)) as JsonObject;
  } catch (error) {
    return fail(`"dados" não é JSON: ${(error as Error).message}`);
  }
  const previous = lines.at(-1);
  const draft = {
    versao: LIVRO_VERSION,
    seq: (previous?.seq ?? 0) + 1,
    id: input.id,
    em: input.em,
    quem: input.quem,
    tipo: input.tipo,
    tarefa: input.tarefa,
    dados,
    chave: input.chave,
    anterior: previous?.hash ?? null,
  };
  const same = lines.find((line) => line.chave === input.chave);
  if (same) {
    return lineContent(same) === contentOf(draft) ? { ok: true, lines: [...lines], entry: same, repeated: true } : fail(`a chave "${input.chave}" já foi usada com outro conteúdo.`);
  }
  if (lines.some((line) => lineId(line) === input.id)) return fail(`o id "${input.id}" já existe no diário.`);
  const entry = { ...draft, hash: entryHash(draft) } as LivroEntry;
  const why = entryProblem(entry as unknown as Record<string, unknown>);
  if (why) return fail(why);
  const line: JournalLine = { kind: 'entry', ...entry };
  return { ok: true, lines: [...lines, line], entry: line, repeated: false };
}
