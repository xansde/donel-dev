// Tarefas criadas no celular (t-2eedda0d, contrato 015) — the owner asks for a task in the phone app; the row waits in
// `celular.tarefas_pedidas` in his Supabase and this daemon turns it into a task in the ledger, with the PC off. Same
// config as the decision queue (`decisoes.json`: url + serviceKeyFile; the key read at each call, never logged), same
// round of 15 s. Two RPCs in `public`, security definer, only for the service_role
// (supabase/015-celular-tarefas.sql in the phone app's repo):
// - `celular_tarefas_pedidas_tomar(p_limite)` takes the rows not applied yet and reserves them for 10 min;
// - `celular_tarefa_pedida_marcar(p_pedido, p_resultado, p_tarefa)` closes a row, only while `aplicada_em` is empty.
//
// Each row becomes the task `tarefa_criar` would make (its own argument check, `parseLedgerToolCall`, then the ledger
// service's `criar`): title, the owner's literal words, criterion (or the default), due date, front; asked by the
// owner, made by the Líder único, low risk. The actor is the owner (`{ kind: 'dono' }`), as his decisions from the phone.
//
// Nothing duplicates: the row's `pedido` is the `requestId` of the creation, and a row read again (a crash between the
// ledger and the mark) finds the task born with it and is only marked. Nothing is lost: a bad row is marked with why
// and never reaches the ledger; a passing failure (the ledger not there to answer) leaves the row reserved.
//
// Review of PR #469: without `quadroTarefas` the queue is not even taken — a task born outside a board could only be
// cancelled (the Líder único transfers within a board), so the rows wait. The task carries the birth mark "criada pelo
// dono no celular" (`via`). After it is made, its row in the mirror (`public.tarefas`) is upserted from here, so the
// phone's list shows it with the PC off; the PC's mirror rewrites the row (with place names) when it is back. When the
// daemon runs its own mirror (the ledger's source in the Supabase, t-89279f84), that mirror writes the row instead.
//
// Etapa 2 (t-c3fbe852): once the row is marked, the Líder único hears of the new task (`avisarLider`: his own queue when
// he lives on this machine, else the PC's relay), keyed by the request, so a row read again never tells him twice.

import { readFileSync } from 'node:fs';
import type { LedgerService } from '../main/ledger-store';
import type { OwnerMessage } from '../main/ledger-card-writer';
import { ASKED_BY_OWNER, isDueDate, isRequestId, MAX_FRENTE_CHARS, MAX_TITLE_CHARS, type LedgerTask } from '../shared/ledger/contract';
import { missingLateColumn, tarefaRow, withoutLateColumns, type TarefaRow } from '../shared/ledger/mirror';
import { parseLedgerToolCall } from '../shared/ledger/tools';
import { LEADER_OF_ALL } from '../shared/mindscape/leader';
import type { BoardConfig } from './board-client';
import { createServiceRequest, passingLedgerReason } from './decisoes';

const FIRST_DELAY_MS = 7_000;
const ROUND_MS = 15_000;
const TAKE_LIMIT = 10;
/** The SQL reserves a taken row for 10 min; past this, the batch stops before the reservation can end under it. */
const BATCH_BUDGET_MS = 9 * 60_000;
/** The criterion when the owner wrote none (contract 015). */
export const DEFAULT_CRITERIO = 'Pronto quando o dono aceitar.';
/** The due date when the owner gave none: a week from today (São Paulo). */
const DEFAULT_DUE_DAYS = 7;
/** The SQL keeps `resultado` up to 300 characters. */
const MAX_RESULTADO = 300;
export const CREATED = 'criada';
// The contract's limits (the SQL checks the same, counted in characters).
const TITLE_MIN = 3;
const TITLE_MAX = 120;
const TEXT_MAX = 2000;
const CRITERIO_MAX = 1000;
const FRENTE_MAX = 80;

/** A row the queue handed over (and reserved), as the network gave it: checked by `planOf`. */
export interface TarefaPedidaRow {
  readonly pedido: string;
  readonly titulo: unknown;
  readonly texto: unknown;
  readonly criterio: unknown;
  readonly prazo: unknown;
  readonly frente: unknown;
  readonly criada_em: string;
}

export interface TarefasPedidasQueue {
  /** Takes up to `limit` rows not applied yet, reserving them; a row not marked comes back when the reservation ends. */
  tomar(limit: number): Promise<readonly TarefaPedidaRow[]>;
  /** Closes the row with `resultado` (and the task made, if any); false = it was already closed. */
  marcar(pedido: string, resultado: string, tarefa: string | null): Promise<boolean>;
  /** Upserts the task's row in the mirror (`public.tarefas`, by id), as the PC's mirror writes it. */
  espelhar(row: TarefaRow): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A row only needs its `pedido` to be marked; the rest is checked by `planOf`. */
function parseRow(value: unknown): TarefaPedidaRow | null {
  if (!isRecord(value) || typeof value.pedido !== 'string' || !value.pedido) return null;
  const { pedido, titulo, texto, criterio, prazo, frente } = value;
  return { pedido, titulo, texto, criterio, prazo, frente, criada_em: typeof value.criada_em === 'string' ? value.criada_em : '' };
}

export function createTarefasPedidasQueue(config: BoardConfig, doFetch: typeof fetch = fetch): TarefasPedidasQueue {
  const { request, rpc } = createServiceRequest(config, doFetch);
  return {
    async tomar(limit) {
      const rows = await rpc('celular_tarefas_pedidas_tomar', { p_limite: limit });
      if (!Array.isArray(rows)) throw new Error('a fila do celular respondeu algo que não é uma lista');
      return rows.map(parseRow).filter((row): row is TarefaPedidaRow => row !== null);
    },
    async marcar(pedido, resultado, tarefa) {
      return (await rpc('celular_tarefa_pedida_marcar', { p_pedido: pedido, p_resultado: resultado, p_tarefa: tarefa })) === true;
    },
    async espelhar(row) {
      // The same upsert as the PC's mirror (supabase-sink.ts): the table is in `public`, the key is `id`.
      const body: Record<string, unknown> = { ...row, atualizado_em: new Date().toISOString() };
      const send = (value: Record<string, unknown>): Promise<string> => request('tarefas?on_conflict=id', 'POST', [value], 'o espelho de tarefas', 'resolution=merge-duplicates,return=minimal');
      try {
        await send(body);
      } catch (error) {
        // A table made before the DoD columns (docs/oraculo-espelho/tarefas-dod.sql): the row goes without them.
        if (!missingLateColumn(error)) throw error;
        await send(withoutLateColumns(body));
      }
    },
  };
}

/** Characters as the SQL counts them (code points), not UTF-16 units. */
const chars = (value: string): number => [...value].length;

/** Cut to `max` UTF-16 units (the ledger's measure) with an ellipsis, never leaving half of a surrogate pair. */
function fit(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '').trimEnd()}…`;
}

const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** `AAAA-MM-DD` of `now` plus `days`, in São Paulo. */
export function dueIn(now: number, days: number): string {
  return SAO_PAULO_DATE.format(new Date(now + days * 24 * 60 * 60 * 1000));
}

/** What a row becomes: the `tarefa_criar` arguments, or the reason it is refused. */
export type TarefaPedidaPlano = { readonly kind: 'criar'; readonly args: Record<string, unknown> } | { readonly kind: 'recusar'; readonly message: string };

/**
 * The row as `tarefa_criar`'s arguments, after the contract's form check. A title or front longer than the ledger
 * keeps (60 / 40) is cut with an ellipsis: the owner's literal words stay whole in `pedido`.
 */
export function planOf(row: TarefaPedidaRow, now: number): TarefaPedidaPlano {
  const refuse = (message: string): TarefaPedidaPlano => ({ kind: 'recusar', message });
  if (!isRequestId(row.pedido)) return refuse('pedido fora do formato');
  if (typeof row.titulo !== 'string') return refuse('título ausente');
  const titulo = row.titulo.trim();
  if (chars(titulo) < TITLE_MIN || chars(titulo) > TITLE_MAX) return refuse(`título com ${chars(titulo)} caracteres (de ${TITLE_MIN} a ${TITLE_MAX})`);
  if (typeof row.texto !== 'string' || !row.texto.trim()) return refuse('texto do pedido ausente');
  if (chars(row.texto) > TEXT_MAX) return refuse(`texto do pedido com mais de ${TEXT_MAX} caracteres`);
  if (row.criterio !== null && row.criterio !== undefined && typeof row.criterio !== 'string') return refuse('critério não é texto');
  const criterio = typeof row.criterio === 'string' ? row.criterio.trim() : '';
  if (chars(criterio) > CRITERIO_MAX) return refuse(`critério com mais de ${CRITERIO_MAX} caracteres`);
  if (row.prazo !== null && row.prazo !== undefined && (typeof row.prazo !== 'string' || !isDueDate(row.prazo))) return refuse('prazo não é uma data AAAA-MM-DD');
  if (row.frente !== null && row.frente !== undefined && typeof row.frente !== 'string') return refuse('frente não é texto');
  const frente = typeof row.frente === 'string' ? row.frente.trim() : '';
  if (chars(frente) > FRENTE_MAX) return refuse(`frente com mais de ${FRENTE_MAX} caracteres`);
  return {
    kind: 'criar',
    args: {
      titulo: fit(titulo, MAX_TITLE_CHARS),
      pedido: row.texto,
      criterio: criterio || DEFAULT_CRITERIO,
      prazo: typeof row.prazo === 'string' ? row.prazo : dueIn(now, DEFAULT_DUE_DAYS),
      dono: LEADER_OF_ALL,
      risco: 'baixo',
      quemPediu: ASKED_BY_OWNER,
      ...(frente ? { frente: fit(frente, MAX_FRENTE_CHARS) } : {}),
    },
  };
}

/** The task a row already made (born with its `pedido` as requestId), whatever it became since. */
export function taskOfPedido(tasks: Readonly<Record<string, LedgerTask>>, pedido: string): LedgerTask | undefined {
  return Object.values(tasks).find((task) => task.events[0]?.kind === 'criada' && task.events[0].requestId === pedido);
}

/** One row's answer: marked (with the task made, if any), or left in the queue with why. */
type RowOutcome = { readonly mark: string; readonly tarefa: string | null } | { readonly passing: string };

export interface TarefasPedidasConsumerDeps {
  /** The queue, or null while `decisoes.json` is missing or invalid (read at each round). */
  readonly queue: () => TarefasPedidasQueue | null;
  readonly ledger: () => LedgerService;
  /** The ledger went back to the PC: nothing is created nor marked here. */
  readonly returned: () => boolean;
  /** The board folder the tasks land on (`quadroTarefas` in `decisoes.json`); '' = none named: the queue is not taken. */
  readonly quadro?: () => string;
  /** The daemon's own mirror already writes `public.tarefas` at every change: no upsert from here. */
  readonly hasMirror?: boolean;
  /** How the mirror names the owner (the daemon's mirror uses the same); absent = the mirror's default. */
  readonly ownerName?: () => string;
  /** Tells the Líder único of a task born of the phone (`deliverLocalFirst`); absent = nobody is told. */
  readonly avisarLider?: (message: OwnerMessage) => Promise<unknown>;
  readonly log?: (line: string) => void;
}

/** The notice to the Líder único of the task the owner asked for on the phone (one per request). */
export function pedidoNotice(task: LedgerTask, pedido: string): OwnerMessage {
  const board = task.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? task.projectPath;
  const title = task.title ?? task.request.slice(0, 80);
  const text = `◆ O dono pediu pelo celular uma tarefa nova: ${task.id} «${title}», no quadro ${board}${task.ownerPlaceId === LEADER_OF_ALL ? ', com você de dono. Passe a quem vai fazer (tarefa_transferir) ou responda a ele' : ''}.`;
  return { projectPath: task.projectPath, placeId: '', text, leaderText: text, key: `pedido-tarefa:${pedido}` };
}

export interface TarefasPedidasConsumer {
  round(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createTarefasPedidasConsumer(deps: TarefasPedidasConsumerDeps): TarefasPedidasConsumer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let offLogged = false;
  let noBoardLogged = false;
  const log = (line: string): void => deps.log?.(`[tarefas-pedidas] ${line}`);
  const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  async function round(): Promise<void> {
    if (deps.returned()) return;
    const queue = deps.queue();
    if (!queue) {
      if (!offLogged) log('sem decisoes.json válido; a fila de tarefas do celular fica desligada.');
      offLogged = true;
      return;
    }
    offLogged = false;
    const quadro = deps.quadro?.() ?? '';
    if (!quadro) {
      if (!noBoardLogged) log('sem "quadroTarefas" em decisoes.json; os pedidos do celular esperam na fila até ele existir.');
      noBoardLogged = true;
      return;
    }
    noBoardLogged = false;
    const takenAt = Date.now();
    const rows = [...(await queue.tomar(TAKE_LIMIT))].sort((a, b) => a.criada_em.localeCompare(b.criada_em));
    if (!rows.length) return;
    try {
      if (deps.ledger().load().readOnly) return; // the rows come back when the reservation ends
    } catch {
      return;
    }
    for (const row of rows) {
      if (deps.returned()) return;
      if (Date.now() - takenAt > BATCH_BUDGET_MS) {
        log('a reserva da fila está para vencer; o resto do lote volta na próxima rodada.');
        return;
      }
      let outcome: RowOutcome;
      try {
        outcome = await applyRow(row, quadro);
      } catch (error) {
        log(`${row.pedido} falhou e fica na fila: ${errorText(error)}`);
        continue;
      }
      if (deps.returned() || 'passing' in outcome) {
        log(`${row.pedido} fica na fila: ${'passing' in outcome ? outcome.passing : 'o Oráculo voltou para o PC'}`);
        return;
      }
      let marked: boolean;
      try {
        marked = await queue.marcar(row.pedido, outcome.mark, outcome.tarefa);
      } catch (error) {
        // Created but not marked: the next reading finds the task by its pedido and only marks it.
        log(`${row.pedido} ${outcome.mark}${outcome.tarefa ? ` ${outcome.tarefa}` : ''}, mas não marcou na fila: ${errorText(error)}`);
        continue;
      }
      log(`${row.pedido} ${outcome.mark}${outcome.tarefa ? ` ${outcome.tarefa} (criada pelo dono no celular)` : ''}${marked ? '' : ' (a linha já estava marcada)'}`);
      if (outcome.tarefa && !deps.hasMirror) await mirror(queue, outcome.tarefa);
      if (outcome.tarefa && marked) await tellLeader(outcome.tarefa, row.pedido);
    }
  }

  /** The Líder único hears of the new task; a failure is a log line (the task is made either way). */
  async function tellLeader(id: string, pedido: string): Promise<void> {
    if (!deps.avisarLider) return;
    try {
      const task = deps.ledger().load().doc.tasks[id];
      if (task) await deps.avisarLider(pedidoNotice(task, pedido));
    } catch (error) {
      log(`${id}: o aviso ao Líder único não saiu: ${errorText(error)}`);
    }
  }

  /** The new task's row in the mirror; a failure is a log line and undoes nothing (the PC's mirror writes it later). */
  async function mirror(queue: TarefasPedidasQueue, id: string): Promise<void> {
    try {
      const { doc } = deps.ledger().load();
      const task = doc.tasks[id];
      // Without place names (the daemon has none); masked as the PC's mirror masks.
      if (task) await queue.espelhar(tarefaRow(doc, task, undefined, [], { ownerName: deps.ownerName?.() }));
    } catch (error) {
      log(`${id}: o espelho de tarefas não recebeu a tarefa nova: ${errorText(error)}`);
    }
  }

  async function applyRow(row: TarefaPedidaRow, quadro: string): Promise<RowOutcome> {
    const ledger = deps.ledger();
    let tasks: Readonly<Record<string, LedgerTask>>;
    try {
      tasks = ledger.load().doc.tasks;
    } catch (error) {
      return { passing: errorText(error) };
    }
    // Already made by this row (a crash between the ledger and the mark): only marked, never made twice.
    if (isRequestId(row.pedido)) {
      const made = taskOfPedido(tasks, row.pedido);
      if (made) return { mark: CREATED, tarefa: made.id };
    }
    const plano = planOf(row, ledger.now());
    if (plano.kind === 'recusar') return { mark: plano.message.slice(0, MAX_RESULTADO), tarefa: null };
    // The MCP's own check of `tarefa_criar`, then the op it builds (ledger-store's `runLedgerTool`).
    const parsed = parseLedgerToolCall('tarefa_criar', plano.args);
    if (!parsed.ok) return { mark: parsed.reason.slice(0, MAX_RESULTADO), tarefa: null };
    const call = parsed.call;
    if (call.tool !== 'tarefa_criar') return { mark: 'pedido não virou tarefa', tarefa: null };
    const result = await ledger.apply(
      { kind: 'dono' },
      {
        op: 'criar',
        projectPath: quadro,
        request: call.pedido,
        doneWhen: call.criterio,
        due: call.prazo,
        ownerPlaceId: call.dono ?? LEADER_OF_ALL,
        risk: call.risco,
        ...(call.titulo ? { title: call.titulo } : {}),
        ...(call.quemPediu ? { requestedBy: call.quemPediu } : {}),
        ...(call.frente ? { frente: call.frente } : {}),
        requestId: row.pedido,
        via: 'celular',
      },
    );
    if (result.ok) return { mark: CREATED, tarefa: result.task.id };
    return passingLedgerReason(result.reason) ? { passing: result.reason } : { mark: result.reason.slice(0, MAX_RESULTADO), tarefa: null };
  }

  function schedule(ms: number): void {
    timer = setTimeout(() => {
      void serialRound()
        .catch((error) => log(`rodada falhou: ${errorText(error)}`))
        .finally(() => {
          if (running) schedule(ROUND_MS);
        });
    }, ms);
    timer.unref?.();
  }

  // One round at a time: the timer's and a write's kick (saída iii) never apply two rows of the same card out of
  // order; a round asked while one runs runs right after it.
  let chain: Promise<void> = Promise.resolve();
  function serialRound(): Promise<void> {
    const next = chain.then(() => round());
    chain = next.catch(() => undefined);
    return next;
  }

  return {
    round: serialRound,
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

/** `quadroTarefas` of `decisoes.json`: the board folder the phone's tasks land on; '' when absent or unreadable. */
export function readQuadroTarefas(file: string): string {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return isRecord(raw) && typeof raw.quadroTarefas === 'string' ? raw.quadroTarefas.trim() : '';
  } catch {
    return '';
  }
}
