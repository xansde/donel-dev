// Decisões do celular (t-52bf8b45) — the daemon applies to the ledger what the owner decided in the phone app, from
// the queue `celular.decisoes` in the owner's Supabase, with the PC off. Off unless `<dir>/decisoes.json` says where
// it is: `{ "url": "https://<ref>.supabase.co", "serviceKeyFile": "<path of a 600 file with the service key>" }` (the
// same shape as the task board's config, read by `readBoardConfig`). Nothing here is hardcoded (the repo goes public).
// The key is read at each call and never logged, never put in an error message.
//
// The schema `celular` is not exposed in PostgREST: two RPCs in `public`, security definer, that only the service_role
// runs (supabase/004-celular-oraculo-consome.sql in the phone app's repo):
// - `celular_decisoes_tomar(p_limite)` takes the pending rows (`aplicada_em is null`) and reserves them for 10 min;
// - `celular_decisao_marcar(p_pedido, p_resultado)` closes a row, only while `aplicada_em` is still empty.
//
// Nothing duplicates: the row's `pedido` is the `requestId` in the ledger, so a row read again after a crash between
// the ledger and the mark is answered by `decisionOfRequest` without a second write. Nothing is lost: a row is marked
// only when the ledger answered; a passing failure leaves it reserved, and it comes back when the reservation ends.

import { readFileSync } from 'node:fs';
import type { DecisaoInput, DecisaoOutcome, MobileLedgerPort } from '../main/celular/ledger-port';
import { LEDGER_NEWER, LEDGER_NOT_OPEN, LEDGER_READ_FAILED, LEDGER_WRITE_FAILED, type LedgerService } from '../main/ledger-store';
import { decisionOfRequest, isRequestId, lastDelivery, MAX_COMMENT_CHARS, OWN_OPTION, type LedgerTask } from '../shared/ledger/contract';
import type { BoardConfig } from './board-client';
import { RETURNED_REASON } from './devolvido';

export const DECISOES_CONFIG_FILE = 'decisoes.json';
const TIMEOUT_MS = 15_000;
const FIRST_DELAY_MS = 5_000;
const ROUND_MS = 15_000;
const TAKE_LIMIT = 10;
/** The SQL reserves a taken row for 10 min; past this, the batch stops before the reservation can end under it. */
const BATCH_BUDGET_MS = 9 * 60_000;
/** Clock skew between Supabase (`criada_em`) and this machine (the delivery's `at`). */
const CLOCK_SLACK_MS = 5_000;
export const STALE_DECISION = 'a entrega mudou depois da decisão no celular';
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
}

export interface DecisoesQueue {
  /** Takes up to `limit` pending rows, reserving them; a row not marked comes back when the reservation ends. */
  tomar(limit: number): Promise<readonly DecisaoRow[]>;
  /** Closes the row with `resultado`; false = it was already closed (by someone else, or annulled). */
  marcar(pedido: string, resultado: string): Promise<boolean>;
}

type Fetch = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const optionalText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

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
    opcao: optionalText(value.opcao),
    comentario: optionalText(value.comentario),
    paginas: value.paginas ?? null,
    criada_em: typeof value.criada_em === 'string' ? value.criada_em : '',
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

  async function rpc(fn: string, args: object): Promise<unknown> {
    const secret = key();
    let res: Response;
    try {
      res = await doFetch(`${config.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // undici hides the reason in `cause`; only its code goes out, never a secret.
      const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
      throw new Error(`a fila do celular não respondeu (${typeof code === 'string' ? code : error instanceof Error ? error.name : 'erro'})`);
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const detail = text.replaceAll(secret, '[chave]').slice(0, 200);
      throw new Error(`a fila do celular recusou (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
    }
    try {
      return text ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new Error(`a fila do celular respondeu algo que não é JSON (HTTP ${res.status})`);
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
  };
}

/**
 * The owner's 👍/👎 per page as one line of plain text (it rides in the decision's own text, no new field in the
 * ledger): `Notas por página: 👍 p1 capa · 👎 p3 provas`. Only pages 1–12 with `up`/`down`; the name is cleaned to
 * letters, digits, spaces and hyphens. '' when there is no valid note. The line never starts with a mark.
 */
export function paginasTexto(paginas: unknown): string {
  if (!Array.isArray(paginas)) return '';
  const notes = paginas
    .slice(0, MAX_PAGES)
    .flatMap((entry): { pagina: number; text: string }[] => {
      if (!isRecord(entry)) return [];
      const { pagina, nota } = entry;
      if (typeof pagina !== 'number' || !Number.isInteger(pagina) || pagina < 1 || pagina > MAX_PAGES) return [];
      if (nota !== 'up' && nota !== 'down') return [];
      const nome = typeof entry.nome === 'string' ? entry.nome.replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_NAME).trim() : '';
      return [{ pagina, text: `${nota === 'up' ? '👍' : '👎'} p${pagina}${nome ? ` ${nome}` : ''}` }];
    })
    .sort((a, b) => a.pagina - b.pagina);
  return notes.length ? `Notas por página: ${notes.map((note) => note.text).join(' · ')}` : '';
}

/** The owner's words cut so that words + notes fit the ledger's limit: the cut falls on the words, never the notes. */
function fitWords(words: string, notes: string): string {
  const budget = MAX_COMMENT_CHARS - (notes ? notes.length + 1 : 0);
  // Cut in UTF-16 units (the ledger's measure), never leaving half of a surrogate pair (jsonb refuses it).
  return words.trim().slice(0, Math.max(0, budget)).replace(/[\uD800-\uDBFF]$/, '').trim();
}

const joinLines = (...parts: string[]): string => parts.filter((part) => part.trim()).join('\n');

/**
 * The row as the phone port's decision (the same path the PWA uses: dedup by `pedido`, owner queue check, the right
 * op). `comentario` is his own option ("Escreva no lugar do arraste"); `sim`/`nao` with an option of the last delivery
 * close the way the option closes. A label that is not an option is the phone's generic side ("Aceitar"/"Rejeitar",
 * drawn when no option closes that way): the side decides without an option, and on `nao` the label is the reason
 * when he wrote nothing.
 */
export function decisaoDe(row: DecisaoRow, task: LedgerTask | undefined): DecisaoInput {
  const notes = paginasTexto(row.paginas);
  const words = fitWords(row.comentario ?? '', notes);
  const base = { pedidoId: row.pedido, itemId: row.tarefa };
  if (row.lado === 'comentario') return { ...base, decisao: 'aceitar', motivo: null, opcao: OWN_OPTION, texto: joinLines(words, notes) };
  const option = row.opcao ? task && lastDelivery(task)?.forOwner?.options.find((entry) => entry.label === row.opcao) : undefined;
  const rejects = option ? option.closes === 'rejeitada' : row.lado === 'nao';
  const opcao = option ? { opcao: option.label } : {};
  return rejects
    ? { ...base, decisao: 'rejeitar', motivo: words || (option ? null : row.opcao), ...opcao, texto: notes }
    : { ...base, decisao: 'aceitar', motivo: null, ...opcao, texto: joinLines(words, notes) };
}

/**
 * The row speaks of a delivery older than the task's last one (the queue does not say which delivery he saw): a new
 * delivery after his gesture is a card he never saw, so the row is refused. A row the ledger already applied (crash
 * between the ledger and the mark) is never stale: the port answers it without writing.
 */
export function staleDecision(row: DecisaoRow, task: LedgerTask | undefined): boolean {
  if (!task || decisionOfRequest(task, row.pedido)) return false;
  const decidedAt = Date.parse(row.criada_em);
  if (!Number.isFinite(decidedAt)) return true;
  const deliveredAt = lastDelivery(task)?.at;
  return deliveredAt !== undefined && deliveredAt > decidedAt + CLOCK_SLACK_MS;
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

export interface DecisoesConsumerDeps {
  /** The queue, or null while `decisoes.json` is missing or invalid (read at each round: writing it turns this on). */
  readonly queue: () => DecisoesQueue | null;
  readonly port: Pick<MobileLedgerPort, 'decidir'>;
  readonly ledger: () => LedgerService;
  /** The ledger went back to the PC: nothing is applied nor marked here. */
  readonly returned: () => boolean;
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
      const outcome: DecisaoOutcome = staleDecision(row, task)
        ? { ok: false, reason: 'recusada', message: STALE_DECISION }
        : await deps.port.decidir(decisaoDe(row, task));
      if (deps.returned() || (!outcome.ok && passing(outcome))) {
        // Not marked: the reservation ends and the row is read again (by this daemon or, after the way back, never).
        deps.log?.(`[decisoes] ${row.tarefa} fica na fila: ${outcome.ok ? 'o Oráculo voltou para o PC' : outcome.message}`);
        return;
      }
      const resultado = outcome.ok ? `aplicada: ${outcome.estado}` : `recusada: ${outcome.message}`;
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
      deps.log?.(`[decisoes] ${row.tarefa} ${resultado}${marked ? '' : ' (a linha já estava marcada por outro)'}`);
    }
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
