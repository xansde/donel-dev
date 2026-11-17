// Decisões do celular (t-52bf8b45) — the daemon applies to the ledger what the owner decided in the phone app, from
// the queue `celular.decisoes` in the owner's Supabase, with the PC off. Off unless `<dir>/decisoes.json` says where
// it is: `{ "url": "https://<ref>.supabase.co", "serviceKeyFile": "<path of a 600 file with the service key>" }` (the
// same shape as the task board's config, read by `readBoardConfig`). Nothing here is hardcoded (the repo goes public).
// The key is read at each call and never logged, never put in an error message.
//
// The schema `celular` is not exposed in PostgREST: two RPCs in `public`, security definer, that only the service_role
// runs (supabase/004-celular-oraculo-consome.sql in the phone app's repo; 005-celular-decisao-assinada.sql adds the
// signature and the delivery he saw to what `tomar` returns):
// - `celular_decisoes_tomar(p_limite)` takes the pending rows (`aplicada_em is null`) and reserves them for 10 min;
// - `celular_decisao_marcar(p_pedido, p_resultado)` closes a row, only while `aplicada_em` is still empty.
//
// Nothing duplicates: the row's `pedido` is the `requestId` in the ledger, so a row read again after a crash between
// the ledger and the mark is answered by `decisionOfRequest` without a second write. Nothing is lost: a row is marked
// only when the ledger answered; a passing failure leaves it reserved, and it comes back when the reservation ends.
//
// Only the owner's phone decides (the Líder's call on PR #455): the queue's password ships inside the APK, so a row
// counts only when it carries an HMAC made with the key of a phone paired with this Oráculo (`decisaoMessage`, the
// scheme `donel-decisao-v1`). A row without it, or with a bad one, is marked refused and never reaches the ledger. The
// row also says which delivery he saw (`entrega_vista`): a decision taken on an older card is refused too.
//
// The one exception is explicit and recorded (t-8762b0ac): `decisoes.json` may carry `importar`, a list of rows the
// Líder vouched for — decisions the owner made with an APK that did not sign yet. Those are applied as listed, before
// the signature, delivery and mapping checks, with a note saying so; nothing outside the list skips a check.
//
// After a decision is applied, the task's row in the mirror (`public.tarefas`) is patched with its new state, so the
// card leaves the phone's view even while the PC's mirror is off.

import { readFileSync } from 'node:fs';
import type { ComentarInput, DecisaoInput, DecisaoOutcome, MobileLedgerPort } from '../main/celular/ledger-port';
import { LEDGER_NEWER, LEDGER_NOT_OPEN, LEDGER_READ_FAILED, LEDGER_WRITE_FAILED, type LedgerService } from '../main/ledger-store';
import { commentOfRequest, decisionOfRequest, isRequestId, lastDecision, lastDelivery, MAX_COMMENT_CHARS, OWN_OPTION, startsWithMark, waitsForOwner, type LedgerTask } from '../shared/ledger/contract';
import { tarefaRow } from '../shared/ledger/mirror';
import type { BoardConfig } from './board-client';
import { RETURNED_REASON } from './devolvido';

export const DECISOES_CONFIG_FILE = 'decisoes.json';
/** Beside `decisoes.json`: one JSON line per marked row with page notes (`NotasPaginasEntry`), mode 600, append only. */
export const NOTAS_PAGINAS_FILE = 'notas-paginas.jsonl';
const TIMEOUT_MS = 15_000;
const FIRST_DELAY_MS = 5_000;
const ROUND_MS = 15_000;
const TAKE_LIMIT = 10;
/** The SQL reserves a taken row for 10 min; past this, the batch stops before the reservation can end under it. */
const BATCH_BUDGET_MS = 9 * 60_000;
/** A `conferir` the Líder listed for a task that is not the Revisor's sample (accepting it would be a full accept). */
export const NOT_THE_SAMPLE = 'a tarefa não é a amostra do Revisor';
export const STALE_DECISION = 'a entrega mudou depois da decisão no celular';
export const UNSIGNED_DECISION = 'sem assinatura';
/** A signed row that arrives while the phone is switched off in Preferences: refused for that, not for its signature. */
export const PHONE_OFF = 'o celular está desligado nas Preferências do Oráculo';
/** A side without a label on a card whose options close that way: the decision does not say which path. */
export const OPTION_REQUIRED = 'a carta tem opções e a decisão não disse qual';
/** The first field of the signed message: a new scheme gets a new name, never a new meaning for this one. */
export const SIGNATURE_SCHEME = 'donel-decisao-v1';
/** The phone's side when no option of the card closes that way (`lados` in donel-nucleo's oraculo.rs). */
const GENERIC_LABEL = { sim: 'Aceitar', nao: 'Rejeitar' } as const;
/** The phone draws at most 12 pages in a card (the SQL refuses more). */
const MAX_PAGES = 12;
const MAX_PAGE_NAME = 24;

export type Lado = 'sim' | 'nao' | 'comentario';

/** A row the queue handed over (and reserved). */
export interface DecisaoRow {
  readonly pedido: string;
  readonly tarefa: string;
  readonly lado: Lado;
  readonly opcao: string | null;
  readonly comentario: string | null;
  /** `[{ pagina, nome, nota: 'up'|'down' }]` as the phone sends it; anything else is ignored. */
  readonly paginas: unknown;
  readonly criada_em: string;
  /** The delivery he saw on the card (timestamptz), or null (an old APK). */
  readonly entrega_vista: string | null;
  /** hex HMAC-SHA256 of `decisaoMessage(row)` with the paired phone's key, or null (an old APK). */
  readonly assinatura: string | null;
}

/** What a decision changes in the task's row of the mirror (`public.tarefas`), as the PC's mirror writes it. */
export interface TarefaEspelho {
  readonly estado: string;
  readonly esperando_dono: boolean;
  readonly atualizado_em: string;
}

export interface DecisoesQueue {
  /** Takes up to `limit` pending rows, reserving them; a row not marked comes back when the reservation ends. */
  tomar(limit: number): Promise<readonly DecisaoRow[]>;
  /** Closes the row with `resultado`; false = it was already closed (by someone else, or annulled). */
  marcar(pedido: string, resultado: string): Promise<boolean>;
  /** Patches the task's row in the mirror (no row = nothing changes). */
  atualizarTarefa(id: string, campos: TarefaEspelho): Promise<void>;
}

type Fetch = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Kept raw: the signature is checked over the row exactly as recorded; the cleaning comes after.
const rawText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A row from the network, or null when its shape is not the queue's. */
function parseRow(value: unknown): DecisaoRow | null {
  if (!isRecord(value)) return null;
  const { pedido, tarefa, lado } = value;
  if (typeof pedido !== 'string' || typeof tarefa !== 'string' || !tarefa) return null;
  if (lado !== 'sim' && lado !== 'nao' && lado !== 'comentario') return null;
  return {
    pedido,
    tarefa,
    lado,
    opcao: rawText(value.opcao),
    comentario: rawText(value.comentario),
    paginas: value.paginas ?? null,
    criada_em: typeof value.criada_em === 'string' ? value.criada_em : '',
    entrega_vista: rawText(value.entrega_vista),
    assinatura: rawText(value.assinatura),
  };
}

/** The queue over PostgREST's RPCs (no profile header: the functions live in `public`). */
export function createDecisoesQueue(config: BoardConfig, doFetch: Fetch = fetch): DecisoesQueue {
  // Read at each call; an unreadable file says so without its path (someone might paste the key in the path field).
  const key = (): string => {
    try {
      const secret = readFileSync(config.serviceKeyFile, 'utf8').trim();
      if (secret) return secret;
    } catch {
      // below
    }
    throw new Error('a chave da fila do celular não pôde ser lida (serviceKeyFile em decisoes.json)');
  };

  async function request(path: string, method: 'POST' | 'PATCH', args: object, what: string): Promise<string> {
    const secret = key();
    let res: Response;
    try {
      res = await doFetch(`${config.url}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: secret,
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(method === 'PATCH' ? { Prefer: 'return=minimal' } : {}),
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // undici hides the reason in `cause`; only its code goes out, never a secret.
      const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
      throw new Error(`${what} não respondeu (${typeof code === 'string' ? code : error instanceof Error ? error.name : 'erro'})`);
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const detail = text.replaceAll(secret, '[chave]').slice(0, 200);
      throw new Error(`${what} recusou (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
    }
    return text;
  }

  async function rpc(fn: string, args: object): Promise<unknown> {
    const text = await request(`rpc/${fn}`, 'POST', args, 'a fila do celular');
    try {
      return text ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new Error('a fila do celular respondeu algo que não é JSON');
    }
  }

  return {
    async tomar(limit) {
      const rows = await rpc('celular_decisoes_tomar', { p_limite: limit });
      if (!Array.isArray(rows)) throw new Error('a fila do celular respondeu algo que não é uma lista');
      return rows.map(parseRow).filter((row): row is DecisaoRow => row !== null);
    },
    async marcar(pedido, resultado) {
      return (await rpc('celular_decisao_marcar', { p_pedido: pedido, p_resultado: resultado })) === true;
    },
    async atualizarTarefa(id, campos) {
      // The table is in `public` (no profile header), the same one the PC's mirror upserts.
      await request(`tarefas?id=eq.${encodeURIComponent(id)}`, 'PATCH', campos, 'o espelho de tarefas');
    },
  };
}

/** What the Líder listed for a row (t-8762b0ac): the action, and the owner's words when he wrote any. */
export type ImportAcao = 'aceitar' | 'rejeitar' | 'comentar' | 'conferir';

export interface ImportItem {
  readonly pedido: string;
  readonly acao: ImportAcao;
  readonly texto?: string;
}

/** The list in `decisoes.json`, keyed by `pedido`; `ok: false` = the whole list is ignored, with why. */
export type ImportList = { readonly ok: true; readonly items: ReadonlyMap<string, ImportItem> } | { readonly ok: false; readonly reason: string };

export const MAX_IMPORT_ITEMS = 100;
const IMPORT_ACOES: readonly ImportAcao[] = ['aceitar', 'rejeitar', 'comentar', 'conferir'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_IMPORTS: ImportList = { ok: true, items: new Map() };

/**
 * The field `importar` of `decisoes.json`: `[{ "pedido": "<uuid>", "acao": "aceitar"|"rejeitar"|"comentar"|"conferir",
 * "texto"?: "<the owner's words>" }]`. All or nothing: one bad item ignores the whole list (a half-read list would apply
 * a part of what the Líder vouched for). Absent = an empty list.
 */
export function parseImportList(raw: unknown): ImportList {
  if (raw === undefined) return NO_IMPORTS;
  if (!Array.isArray(raw)) return { ok: false, reason: '"importar" não é uma lista' };
  if (raw.length > MAX_IMPORT_ITEMS) return { ok: false, reason: `"importar" tem mais de ${MAX_IMPORT_ITEMS} itens` };
  const items = new Map<string, ImportItem>();
  for (const [index, entry] of raw.entries()) {
    const where = `"importar" item ${index + 1}`;
    if (!isRecord(entry)) return { ok: false, reason: `${where} não é um objeto` };
    const { pedido, acao, texto } = entry;
    // A uuid, as the queue's column (never an id the ledger would not keep as requestId).
    if (typeof pedido !== 'string' || !UUID.test(pedido) || !isRequestId(pedido)) return { ok: false, reason: `${where}: pedido fora do formato` };
    if (items.has(pedido)) return { ok: false, reason: `${where}: pedido repetido` };
    if (typeof acao !== 'string' || !IMPORT_ACOES.includes(acao as ImportAcao)) return { ok: false, reason: `${where}: ação desconhecida` };
    if (texto !== undefined && typeof texto !== 'string') return { ok: false, reason: `${where}: texto não é texto` };
    const words = cleanText(texto ?? null).trim();
    if (words.length > MAX_COMMENT_CHARS) return { ok: false, reason: `${where}: texto com mais de ${MAX_COMMENT_CHARS} caracteres` };
    if (startsWithMark(words)) return { ok: false, reason: `${where}: texto começa com a marca do Oráculo` };
    if (acao === 'rejeitar' && !words) return { ok: false, reason: `${where}: rejeitar sem texto` };
    items.set(pedido, { pedido, acao: acao as ImportAcao, ...(words ? { texto: words } : {}) });
  }
  return { ok: true, items };
}

/**
 * Reads `importar` from the config file at each round. It is read only while the queue is on, so a file that is gone
 * or does not parse here changed under the round (a non-atomic rewrite): `ok: false`, and the round holds the queue,
 * never an empty list that would send the listed rows to the signature check.
 */
export function readImportList(file: string): ImportList {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return { ok: false, reason: `${DECISOES_CONFIG_FILE} não pôde ser lido como JSON` };
  }
  return isRecord(raw) ? parseImportList(raw.importar) : { ok: false, reason: `${DECISOES_CONFIG_FILE} não é um objeto` };
}

const SAO_PAULO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The note every imported event carries, with the time the owner decided (São Paulo time, from the row). */
export function importNote(criadaEm: string): string {
  const at = Date.parse(criadaEm);
  if (!Number.isFinite(at)) return 'Decisão do dono pelo celular (importada; feita antes da decisão assinada).';
  const part = (type: Intl.DateTimeFormatPartTypes): string => SAO_PAULO.formatToParts(at).find((entry) => entry.type === type)?.value ?? '';
  return `Decisão do dono pelo celular às ${part('hour')}:${part('minute')} de ${part('day')}/${part('month')} (importada; feita antes da decisão assinada).`;
}

/** The comment of a `conferir` gets its own repeat key, never the decision's (the uuid plus a suffix no uuid has). */
export const importCommentKey = (pedido: string): string => `${pedido}-c`;

/** One page's 👍/👎 as the owner left it on the card. */
export interface NotaPagina {
  readonly pagina: number;
  readonly nome: string;
  readonly nota: 'up' | 'down';
}

/** What `notas-paginas.jsonl` keeps per row (the bridge cron writes the same shape, without `resultado`). */
export interface NotasPaginasEntry {
  readonly tarefa: string;
  readonly pedido: string;
  readonly criada_em: string;
  readonly paginas: readonly NotaPagina[];
  /** The mark the row got in the queue (applied or refused). */
  readonly resultado: string;
}

/**
 * The owner's 👍/👎 per page (t-8762b0ac, 17/11): design feedback, kept apart from the decision. They never ride in a
 * decision's or a comment's text (that text is the message to whoever did the task); they go to `notas-paginas.jsonl`.
 * Only pages 1–12 with `up`/`down`; the name is cleaned to letters, digits, spaces and hyphens. Sorted by page.
 */
export function paginasNotas(paginas: unknown): NotaPagina[] {
  if (!Array.isArray(paginas)) return [];
  return paginas
    .slice(0, MAX_PAGES)
    .flatMap((entry): NotaPagina[] => {
      if (!isRecord(entry)) return [];
      const { pagina, nota } = entry;
      if (typeof pagina !== 'number' || !Number.isInteger(pagina) || pagina < 1 || pagina > MAX_PAGES) return [];
      if (nota !== 'up' && nota !== 'down') return [];
      const nome = typeof entry.nome === 'string' ? entry.nome.replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_NAME).trim() : '';
      return [{ pagina, nome, nota }];
    })
    .sort((a, b) => a.pagina - b.pagina);
}

/** The owner's words cut so that words + tail fit the ledger's limit: the cut falls on the words, never the tail. */
function fitWords(words: string, tail = ''): string {
  const budget = MAX_COMMENT_CHARS - (tail ? tail.length + 1 : 0);
  // Cut in UTF-16 units (the ledger's measure), never leaving half of a surrogate pair (jsonb refuses it).
  return words.trim().slice(0, Math.max(0, budget)).replace(/[\uD800-\uDBFF]$/, '').trim();
}

const joinLines = (...parts: string[]): string => parts.filter((part) => part.trim()).join('\n');

/** Each field as `<UTF-8 length>:<value>\n`, so no value can pass for another field. */
const signedField = (value: string): string => `${Buffer.byteLength(value, 'utf8')}:${value}\n`;

/** The delivery he saw, in ms since the epoch ('' when absent or unreadable). */
function entregaMs(value: string | null): string {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? String(ms) : '';
}

const scalar = (value: unknown): string => (typeof value === 'number' || typeof value === 'string' ? String(value) : '');

/**
 * The message the phone signs (scheme `donel-decisao-v1`), from the row's raw values: the scheme, pedido, tarefa,
 * lado, opcao, comentario ('' when null), the delivery he saw in ms, and the pages as `<pagina>:<nota>:<nome>` joined
 * by `;`. The phone builds the same bytes (donel-nucleo's assinatura.rs); both sides test the same vector.
 */
export function decisaoMessage(row: DecisaoRow): string {
  const paginas = Array.isArray(row.paginas)
    ? row.paginas.map((entry) => (isRecord(entry) ? `${scalar(entry.pagina)}:${scalar(entry.nota)}:${typeof entry.nome === 'string' ? entry.nome : ''}` : '')).join(';')
    : '';
  return [SIGNATURE_SCHEME, row.pedido, row.tarefa, row.lado, row.opcao ?? '', row.comentario ?? '', entregaMs(row.entrega_vista), paginas].map(signedField).join('');
}

/** Control characters out (but line breaks and tabs) before the owner's words reach the ledger and the relay. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const cleanText = (value: string | null): string => (value ?? '').replace(CONTROL_CHARS, '');

/** What a row becomes: a decision through the port, words on the card (comentar), or a refusal of its own. */
export type DecisaoPlano =
  | { readonly kind: 'decidir'; readonly input: DecisaoInput }
  | { readonly kind: 'comentar'; readonly input: ComentarInput }
  | { readonly kind: 'recusar'; readonly message: string };

/**
 * The row as the phone port's call (the same path the PWA uses: dedup by `pedido`, owner queue check, the right op).
 * The mapping is strict, as the phone draws its sides (`lados`): `sim` closes `aceita`, `nao` closes `rejeitada`.
 * - `opcao` an option of the last delivery that closes as the side → decided with it; closing the other way → refused;
 * - `opcao` the exact generic of the side ("Aceitar"/"Rejeitar") while no option closes that way → the side, without an
 *   option (on `nao`, his words or the label are the reason);
 * - any other label speaks of a card that is no longer there → refused ("a entrega mudou");
 * - no `opcao` is the generic of the side too: decided only while no option closes that way; otherwise refused
 *   (OPTION_REQUIRED), since a card with paths (main or the alfa) never closes without saying which one. A named
 *   generic on such a card is a label of a card that is no longer there (STALE_DECISION);
 * - the Revisor's sample (an accepted task still before him) is a card without options, as the port draws it.
 * `comentario` is his own option ("Escreva no lugar do arraste") on a delivered card; on the sample there is nothing to
 * decide, so his words go on the card. Any other state is left to the ledger, which refuses it.
 */
export function planoDe(row: DecisaoRow, task: LedgerTask | undefined): DecisaoPlano {
  const words = fitWords(cleanText(row.comentario));
  const base = { pedidoId: row.pedido, itemId: row.tarefa };
  if (row.lado === 'comentario') {
    if (task && task.state === 'aceita') return { kind: 'comentar', input: { ...base, texto: words } };
    return { kind: 'decidir', input: { ...base, decisao: 'aceitar', motivo: null, opcao: OWN_OPTION, texto: words } };
  }
  const closes = row.lado === 'sim' ? 'aceita' : 'rejeitada';
  const decide = (opcao: string | null, motivo: string | null): DecisaoPlano => ({
    kind: 'decidir',
    input:
      closes === 'rejeitada'
        ? { ...base, decisao: 'rejeitar', motivo, ...(opcao ? { opcao } : {}) }
        : { ...base, decisao: 'aceitar', motivo: null, ...(opcao ? { opcao } : {}), texto: words },
  });
  const label = cleanText(row.opcao).trim();
  // No task: the port says it is gone.
  if (!task) return decide(null, words || label || null);
  // The Revisor's sample shows the old card, without options (the port draws it with `forOwner` undefined).
  const options = task.state === 'aceita' ? [] : (lastDelivery(task)?.forOwner?.options ?? []);
  if (label) {
    const option = options.find((entry) => entry.label.trim() === label);
    if (option) return option.closes === closes ? decide(option.label, words || null) : { kind: 'recusar', message: STALE_DECISION };
    if (label !== GENERIC_LABEL[row.lado]) return { kind: 'recusar', message: STALE_DECISION };
  }
  // The generic of the side (named, or no label at all): only on a card with no option closing that way.
  if (options.some((entry) => entry.closes === closes)) return { kind: 'recusar', message: label ? STALE_DECISION : OPTION_REQUIRED };
  return decide(null, words || label || null);
}

/** The delivery he saw is not the task's last one (or the row does not say): a card he never saw. */
export function entregaMudou(row: DecisaoRow, task: LedgerTask): boolean {
  const seen = row.entrega_vista ? Date.parse(row.entrega_vista) : Number.NaN;
  const last = lastDelivery(task)?.at;
  return !Number.isFinite(seen) || last === undefined || seen !== last;
}

/**
 * A refusal that says nothing about the decision (the ledger was not there to answer): the row is not marked. The
 * texts are the ledger's own constants, so a rewording there cannot turn a disk failure into a lost decision.
 */
function passing(outcome: DecisaoOutcome & { ok: false }): boolean {
  if (outcome.reason !== 'recusada') return false;
  const { message } = outcome;
  return (
    message === RETURNED_REASON ||
    message === LEDGER_NOT_OPEN ||
    message === LEDGER_NEWER ||
    message === LEDGER_WRITE_FAILED ||
    message.startsWith(`${LEDGER_READ_FAILED} (`)
  );
}

/** The card writer wraps the ledger's reason in its own words: the same passing failures, found inside the text. */
function passingComment(message: string): boolean {
  return (
    message.startsWith('O app ainda está abrindo') ||
    message.startsWith('O Oráculo Harrow não abriu') ||
    message.startsWith('Não consegui ler o Oráculo Harrow') ||
    [RETURNED_REASON, LEDGER_NOT_OPEN, LEDGER_NEWER, LEDGER_WRITE_FAILED, LEDGER_READ_FAILED].some((text) => message.includes(text))
  );
}

/** Who signed a row: the paired phone's name, or null (no such phone, or a bad signature). */
export type DecisaoVerifier = (message: string, signatureHex: string) => { readonly deviceName: string } | null;

/** One row's answer: marked with `resultado` (`decided`: the task's state changed), or left in the queue with why. */
type RowOutcome = { readonly mark: string; readonly note?: string; readonly decided?: true } | { readonly passing: string };

export interface DecisoesConsumerDeps {
  /** The queue, or null while `decisoes.json` is missing or invalid (read at each round: writing it turns this on). */
  readonly queue: () => DecisoesQueue | null;
  readonly port: Pick<MobileLedgerPort, 'decidir' | 'comentar'>;
  /** The paired phones' signature check; null while the phone's core is not up (rows wait, never refused for it). */
  readonly verifier: () => DecisaoVerifier | null;
  /** The phone is switched on in Preferences (off = no signature counts; the row says so). Absent = on. */
  readonly phoneOn?: () => boolean;
  readonly ledger: () => LedgerService;
  /** The ledger went back to the PC: nothing is applied nor marked here. */
  readonly returned: () => boolean;
  /** The Líder's list of rows to import (`importar` in `decisoes.json`), read at each round. Absent = none. */
  readonly importar?: () => ImportList;
  /** Appends a marked row's page notes to `notas-paginas.jsonl` (only rows with valid notes). A failure is a log line. */
  readonly guardarNotas?: (entry: NotasPaginasEntry) => void | Promise<void>;
  readonly log?: (line: string) => void;
}

export interface DecisoesConsumer {
  /** Takes the pending rows and applies them one at a time (the relay may wait up to 10 s per decision). */
  round(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createDecisoesConsumer(deps: DecisoesConsumerDeps): DecisoesConsumer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let offLogged = false;
  let importLogged = '';

  async function round(): Promise<void> {
    if (deps.returned()) return;
    // The config first (a small file): with the queue off, the ledger is never parsed.
    const queue = deps.queue();
    if (!queue) {
      if (!offLogged) deps.log?.(`[decisoes] sem ${DECISOES_CONFIG_FILE} válido; a fila do celular fica desligada.`);
      offLogged = true;
      return;
    }
    offLogged = false;
    // A bad list holds the whole queue: with it dropped, the rows it lists would reach the signature check and be
    // refused for good ("sem assinatura"). Nothing is taken until the Líder fixes it.
    const list = deps.importar?.() ?? NO_IMPORTS;
    if (!list.ok) {
      if (importLogged !== list.reason) deps.log?.(`[decisoes] ${list.reason}; a fila do celular fica parada até a lista "importar" ser corrigida.`);
      importLogged = list.reason;
      return;
    }
    importLogged = '';
    const imports = list.items;
    const takenAt = Date.now();
    const rows = [...(await queue.tomar(TAKE_LIMIT))].sort((a, b) => a.criada_em.localeCompare(b.criada_em));
    if (!rows.length) return;
    try {
      if (deps.ledger().load().readOnly) return; // taken for nothing: the rows come back when the reservation ends
    } catch {
      return; // unreadable ledger: nothing applied, the rows come back
    }
    for (const row of rows) {
      if (deps.returned()) return;
      if (Date.now() - takenAt > BATCH_BUDGET_MS) {
        deps.log?.('[decisoes] a reserva da fila está para vencer; o resto do lote volta na próxima rodada.');
        return;
      }
      // A `pedido` the ledger would not keep as requestId would lose the dedup: never applied (the column is a uuid).
      if (!isRequestId(row.pedido)) {
        deps.log?.(`[decisoes] pedido fora do formato na tarefa ${row.tarefa}; ignorado.`);
        continue;
      }
      let task: LedgerTask | undefined;
      try {
        task = deps.ledger().load().doc.tasks[row.tarefa];
      } catch {
        return;
      }
      let outcome: RowOutcome;
      try {
        const item = imports.get(row.pedido);
        outcome = item ? await importRow(row, item, task) : await applyRow(row, task);
      } catch (error) {
        // One row that throws does not hold the batch: it stays reserved and comes back when the reservation ends.
        deps.log?.(`[decisoes] ${row.tarefa} falhou e fica na fila: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (deps.returned() || 'passing' in outcome) {
        // Not marked: the reservation ends and the row is read again (by this daemon or, after the way back, never).
        deps.log?.(`[decisoes] ${row.tarefa} fica na fila: ${'passing' in outcome ? outcome.passing : 'o Oráculo voltou para o PC'}`);
        return;
      }
      if (outcome.decided) await mirror(queue, row.tarefa);
      const resultado = outcome.mark;
      let marked: boolean;
      try {
        marked = await queue.marcar(row.pedido, resultado);
      } catch (error) {
        // Applied but not marked: the next reading repeats it, and the ledger answers without writing again. Each mark
        // stands alone, so the rest of the batch goes on.
        deps.log?.(`[decisoes] ${row.tarefa} ${resultado}, mas não marcou na fila: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      // false = closed meanwhile. The guard against an annulment racing the ledger is in the SQL, not here: an annulment
      // (not written yet) must respect `tomada_em`, and the batch stops before the 10-min reservation ends.
      deps.log?.(`[decisoes] ${row.tarefa} ${resultado}${outcome.note ? ` (${outcome.note})` : ''}${marked ? '' : ' (a linha já estava marcada por outro)'}`);
      if (marked) await keepNotes(row, resultado);
    }
  }

  /**
   * The row's page notes, recorded beside the decision (never in its text); a failure never undoes the mark. A row
   * refused for its signature is not the owner's, so neither are its notes (and the bridge reopens such a row, which
   * would record them twice).
   */
  async function keepNotes(row: DecisaoRow, resultado: string): Promise<void> {
    const paginas = paginasNotas(row.paginas);
    if (!paginas.length || !deps.guardarNotas || resultado === `recusada: ${UNSIGNED_DECISION}`) return;
    try {
      await deps.guardarNotas({ tarefa: row.tarefa, pedido: row.pedido, criada_em: row.criada_em, paginas, resultado });
    } catch (error) {
      deps.log?.(`[decisoes] ${row.tarefa}: as notas por página não foram guardadas: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function decide(input: DecisaoInput, suffix = ''): Promise<RowOutcome> {
    const outcome = await deps.port.decidir(input);
    if (outcome.ok) return { mark: `aplicada: ${outcome.estado}${suffix}`, decided: true };
    return passing(outcome) ? { passing: outcome.message } : { mark: `recusada: ${outcome.message}` };
  }

  async function comment(input: ComentarInput, suffix = ''): Promise<RowOutcome> {
    const outcome = await deps.port.comentar(input);
    if (outcome.ok) return { mark: `aplicada: comentário${suffix}` };
    return passingComment(outcome.mensagem) ? { passing: outcome.mensagem } : { mark: `recusada: ${outcome.mensagem}` };
  }

  /** The task's row in the mirror, from the ledger after the decision; a failure is a log line and undoes nothing. */
  async function mirror(queue: DecisoesQueue, id: string): Promise<void> {
    try {
      const { doc } = deps.ledger().load();
      const task = doc.tasks[id];
      if (!task) return;
      const { estado } = tarefaRow(doc, task, undefined, []);
      await queue.atualizarTarefa(id, { estado, esperando_dono: waitsForOwner(doc, task), atualizado_em: new Date().toISOString() });
    } catch (error) {
      deps.log?.(`[decisoes] ${id}: o espelho de tarefas não atualizou: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * A row the Líder listed (t-8762b0ac): applied as listed through the same port, which answers a repeat with what it
   * already recorded. No signature, delivery or mapping check runs, and the verifier is never asked.
   */
  async function importRow(row: DecisaoRow, item: ImportItem, task: LedgerTask | undefined): Promise<RowOutcome> {
    const tail = importNote(row.criada_em);
    const words = fitWords(item.texto ?? cleanText(row.comentario), tail);
    const base = { pedidoId: row.pedido, itemId: row.tarefa };
    const suffix = ' (importação)';
    // Already decided by this row: the port answers what it recorded, whatever the task became since.
    if (item.acao !== 'comentar' && task && decisionOfRequest(task, row.pedido)) return decide({ ...base, decisao: item.acao === 'rejeitar' ? 'rejeitar' : 'aceitar', motivo: null }, suffix);
    // On the Revisor's sample the ledger turns an accept into `conferida`, an event without text: the words and the note
    // ride on a comment first. Off the sample, a `conferir` would be a full accept, which the row did not ask for.
    const sample = task !== undefined && task.state === 'aceita' && lastDecision(task)?.by.kind === 'lugar';
    if (sample && (item.acao === 'aceitar' || item.acao === 'conferir')) {
      const noted = await comment({ ...base, pedidoId: importCommentKey(row.pedido), texto: joinLines(words, tail) });
      if (!('mark' in noted) || noted.mark.startsWith('recusada')) return noted;
      return decide({ ...base, decisao: 'aceitar', motivo: null }, suffix);
    }
    switch (item.acao) {
      case 'aceitar':
        return decide({ ...base, decisao: 'aceitar', motivo: null, texto: joinLines(words, tail) }, suffix);
      case 'rejeitar':
        return decide({ ...base, decisao: 'rejeitar', motivo: words, texto: tail }, suffix);
      case 'comentar':
        return comment({ ...base, texto: joinLines(words, tail) }, suffix);
      case 'conferir':
        return { mark: `recusada: ${NOT_THE_SAMPLE}` }; // the sample took the branch above
    }
  }

  /** In order: already applied, signed by a paired phone, the delivery he saw, the strict mapping. */
  async function applyRow(row: DecisaoRow, task: LedgerTask | undefined): Promise<RowOutcome> {
    // (a) Already in the ledger (a crash between the ledger and the mark): the port answers it without writing, and
    // no later check (a new delivery since) may turn an applied decision into a refused row.
    if (task && decisionOfRequest(task, row.pedido)) return decide({ pedidoId: row.pedido, itemId: row.tarefa, decisao: row.lado === 'nao' ? 'rejeitar' : 'aceitar', motivo: null });
    if (task && commentOfRequest(task, row.pedido)) return comment({ pedidoId: row.pedido, itemId: row.tarefa, texto: '' });
    // (b) Only a paired phone decides for the owner.
    const verify = deps.verifier();
    if (!verify) return { passing: 'o celular do Oráculo não está pronto para conferir a assinatura' };
    if (!row.assinatura) {
      deps.log?.(`[decisoes] ${row.tarefa}: linha sem assinatura, recusada.`);
      return { mark: `recusada: ${UNSIGNED_DECISION}` };
    }
    if (deps.phoneOn && !deps.phoneOn()) {
      deps.log?.(`[decisoes] ${row.tarefa}: o celular está desligado nas Preferências, recusada.`);
      return { mark: `recusada: ${PHONE_OFF}` };
    }
    const signer = verify(decisaoMessage(row), row.assinatura);
    if (!signer) {
      deps.log?.(`[decisoes] ${row.tarefa}: assinatura que nenhum celular pareado e ligado fez, recusada.`);
      return { mark: `recusada: ${UNSIGNED_DECISION}` };
    }
    const note = `assinada por ${signer.deviceName}`;
    // (c) The card he saw is the task's last delivery (no task: the port says it is gone).
    if (task && entregaMudou(row, task)) return { mark: `recusada: ${STALE_DECISION}`, note };
    // (d) The strict mapping.
    const plano = planoDe(row, task);
    const outcome = plano.kind === 'recusar' ? { mark: `recusada: ${plano.message}` } : plano.kind === 'comentar' ? await comment(plano.input) : await decide(plano.input);
    return 'mark' in outcome ? { ...outcome, note } : outcome;
  }

  function schedule(ms: number): void {
    timer = setTimeout(() => {
      void round()
        .catch((error) => deps.log?.(`[decisoes] rodada falhou: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          if (running) schedule(ROUND_MS);
        });
    }, ms);
    timer.unref?.();
  }

  return {
    round,
    start() {
      if (running) return;
      running = true;
      schedule(FIRST_DELAY_MS);
    },
    stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
