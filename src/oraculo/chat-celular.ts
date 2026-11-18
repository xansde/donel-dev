// Chat do Líder pelo celular, com o PC no app de antes (t-cddc62fc) — the owner writes to the Líder único in the phone
// app; the row waits in `celular.lider_mensagens` (supabase/014 of donel-celular). The desktop's own router
// (src/main/lider/celular-chat.ts) only exists from the alfa 26.1118.428 on, so on an older PC nothing took the queue
// and the owner's words sat "na fila". This daemon takes it and hands each message to the relay (`fila.json`) with
// `placeId: ''`: the PC, old or new, delivers it to the Líder único and acks `'lider'` (the path the phone's decisions
// already use). Same config as the decision queue (`decisoes.json`: url + serviceKeyFile, the key read at each call,
// never logged), same round of 15 s. RPCs in `public`, only for the service_role (014 and 019 of donel-celular):
// - `celular_lider_tomar(p_limite)` takes the owner's rows not delivered yet and not parked, reserving them for 10 min;
// - `celular_lider_estacionar(p_id, p_resultado)` parks a row whose message waits in the relay (`resultado = PARKED`);
// - `celular_lider_estacionadas(p_resultado, p_limite)` lists the parked rows not delivered yet;
// - `celular_lider_entregue(p_id, p_resultado)` closes a row, parked or not.
//
// Two consumers, one queue: the desktop router also calls `celular_lider_tomar`. The 10 min reservation alone would
// not keep them apart (PC off longer than that: the desktop retakes the row and the relay delivers it too). So every
// row this daemon takes is PARKED (`resultado` set, `entregue_em` still null) BEFORE its message goes to the relay;
// `tomar` never hands a row with `resultado`, so from then on the row is only this daemon's: each round asks the relay
// about the parked rows with the same key (it joins the queued item, never a second one; a row parked by a daemon that
// died before sending is queued then) and closes each once the PC acked. A row whose park failed is not sent: its
// reservation ends and whoever takes it next delivers it, once.
// Nothing is lost: a row is only closed after the PC's ack; a failure leaves it reserved or parked.

import type { BoardConfig } from './board-client';
import { createServiceRequest, type ServiceRequest } from './decisoes';
import type { Relay } from './relay';
import { phoneMarker } from '../main/lider/celular-chat';

const FIRST_DELAY_MS = 5_000;
const ROUND_MS = 15_000;
const TAKE_LIMIT = 10;
const PARKED_LIMIT = 50;
/** The owner's words given whole up to this; the SQL keeps up to 4000. */
const MAX_TEXT = 3500;
export const DELIVERED_NOTE = 'entregue ao Líder único pela VPS';
/** `resultado` of a row whose message waits in the relay: `celular_lider_tomar` no longer hands it (019 of donel-celular). */
export const PARKED = 'na fila do Oráculo da VPS para o Líder único';
/** The relay's key of a row: one message per row, whatever the round. */
export const chatKey = (id: string): string => `celular-chat:${id}`;

export interface ChatCelularRow {
  readonly id: string;
  readonly texto: string;
  readonly criada_em: string;
}

export interface ChatCelularQueue {
  /** Takes up to `limit` of the owner's rows not delivered nor parked, reserving them for 10 min. */
  tomar(limit: number): Promise<readonly ChatCelularRow[]>;
  /** Marks the row delivered (parked or not); false = it was already. */
  entregue(id: string, resultado: string): Promise<boolean>;
  /** Parks a taken row: it leaves `tomar` for good. False = it was already delivered or parked. */
  estacionar(id: string, resultado: string): Promise<boolean>;
  /** The rows parked with `resultado` and not delivered yet, oldest first. */
  estacionadas(resultado: string, limit: number): Promise<readonly ChatCelularRow[]>;
}

function parseRow(value: unknown): ChatCelularRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, texto, criada_em } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !id || typeof texto !== 'string') return null;
  return { id, texto, criada_em: typeof criada_em === 'string' ? criada_em : '' };
}

function parseRows(value: unknown): ChatCelularRow[] {
  if (!Array.isArray(value)) throw new Error('o chat do celular respondeu algo que não é uma lista');
  return value.map(parseRow).filter((row): row is ChatCelularRow => row !== null);
}

/** The queue over one RPC (PostgREST with the service key in the daemon; a fake in the tests). */
export function chatCelularQueueOver(rpc: ServiceRequest['rpc']): ChatCelularQueue {
  return {
    async tomar(limit) {
      return parseRows(await rpc('celular_lider_tomar', { p_limite: limit }));
    },
    async entregue(id, resultado) {
      return (await rpc('celular_lider_entregue', { p_id: id, p_resultado: resultado })) === true;
    },
    async estacionar(id, resultado) {
      return (await rpc('celular_lider_estacionar', { p_id: id, p_resultado: resultado })) === true;
    },
    async estacionadas(resultado, limit) {
      return parseRows(await rpc('celular_lider_estacionadas', { p_resultado: resultado, p_limite: limit }));
    },
  };
}

export function createChatCelularQueue(config: BoardConfig, doFetch: typeof fetch = fetch): ChatCelularQueue {
  return chatCelularQueueOver(createServiceRequest(config, doFetch).rpc);
}

/** What the Líder único reads: the marker the desktop router uses, the owner's words, and how to answer on the phone. */
export function chatText(row: ChatCelularRow, replyHint?: (shortId: string) => string): string {
  const words = row.texto.trim();
  const fitted = words.length <= MAX_TEXT ? words : `${words.slice(0, MAX_TEXT - 1).replace(/[\uD800-\uDBFF]$/, '')}…`;
  const hint = replyHint?.(row.id.slice(0, 8));
  return `◆ Do dono, pelo chat do celular ${phoneMarker(row.id)}: «${fitted}»${hint ? `\n${hint}` : ''}`;
}

export interface ChatCelularConsumerDeps {
  /** The queue, or null while `decisoes.json` is missing or invalid (read at each round). */
  readonly queue: () => ChatCelularQueue | null;
  readonly relay: Pick<Relay, 'send' | 'pending'>;
  /** How long a message waits for the PC's ack before the round moves on (it stays queued either way). */
  readonly waitMs: number;
  /** The line under the owner's words telling the Líder how to answer on the phone; absent = none. */
  readonly replyHint?: (shortId: string) => string;
  /** One line per event: never the key, never the owner's text. */
  readonly log?: (line: string) => void;
}

export interface ChatCelularConsumer {
  round(): Promise<void>;
  start(): void;
  stop(): void;
}

type SendResult = Awaited<ReturnType<Relay['send']>>;

export function createChatCelularConsumer(deps: ChatCelularConsumerDeps): ChatCelularConsumer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let inRound = false;
  let offLogged = false;
  const log = (line: string): void => deps.log?.(`[chat-celular] ${line}`);
  const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const send = (row: ChatCelularRow, waitMs: number): Promise<SendResult> => {
    const text = chatText(row, deps.replyHint);
    return deps.relay.send({ projectPath: '', placeId: '', text, leaderText: text, key: chatKey(row.id) }, waitMs);
  };

  /** The PC acked: closes the row (always parked by then). A failure leaves it parked, for the next round to close. */
  async function mark(queue: ChatCelularQueue, row: ChatCelularRow, to: Exclude<SendResult, 'pendente'>): Promise<void> {
    // With placeId '' the PC answers 'lider'; anything else still went somewhere, and the row says where.
    const note = to === 'lider' ? DELIVERED_NOTE : `entregue pela VPS a ${typeof to === 'object' ? to.placeId : String(to)}`;
    try {
      const marked = await queue.entregue(row.id, note);
      log(`${phoneMarker(row.id)} ${note}${marked ? '' : ' (a linha já estava marcada)'}`);
    } catch (error) {
      // The row is parked: the next round asks the relay again (same key) and closes it.
      log(`${phoneMarker(row.id)} chegou ao Líder único, mas não marquei: ${errorText(error)}`);
    }
  }

  /**
   * Parks a taken row BEFORE its message goes to the relay: from then on `tomar` never hands it, so the desktop router
   * cannot deliver it a second time, even if this daemon dies in the middle (step 1 of the next round sends it). False =
   * not parked (the RPC failed, or the row was already closed): the message does not go now; the reservation ends in
   * 10 min and whoever takes the row then delivers it once.
   */
  async function park(queue: ChatCelularQueue, row: ChatCelularRow): Promise<boolean> {
    try {
      if (await queue.estacionar(row.id, PARKED)) return true;
      log(`${phoneMarker(row.id)} já estava fechada ou estacionada; não mandei`);
      return false;
    } catch (error) {
      log(`${phoneMarker(row.id)} não estacionei, não mandei agora: ${errorText(error)}`);
      return false;
    }
  }

  async function round(): Promise<void> {
    if (inRound) return;
    inRound = true;
    try {
      const queue = deps.queue();
      if (!queue) {
        if (!offLogged) log('sem decisoes.json válido; o chat do celular fica desligado.');
        offLogged = true;
        return;
      }
      offLogged = false;
      // 1. The parked rows: the relay answers where each went once the PC acked (the key joins, nothing new is queued).
      let parked: readonly ChatCelularRow[] = [];
      try {
        parked = await queue.estacionadas(PARKED, PARKED_LIMIT);
      } catch (error) {
        log(`não li as mensagens estacionadas: ${errorText(error)}`);
      }
      if (parked.length) {
        // Still pending in the relay: nothing to ask (and no new notice to the PC every round).
        const pendingKeys = new Set(deps.relay.pending().map((item) => item.key));
        for (const row of parked) {
          if (pendingKeys.has(chatKey(row.id))) continue;
          let to: SendResult;
          try {
            to = await send(row, 0);
          } catch (error) {
            log(`${phoneMarker(row.id)} não entrou na fila do PC: ${errorText(error)}`);
            return;
          }
          if (to !== 'pendente') await mark(queue, row, to);
        }
      }
      // 2. The new rows.
      let rows: ChatCelularRow[];
      try {
        rows = [...(await queue.tomar(TAKE_LIMIT))].sort((a, b) => a.criada_em.localeCompare(b.criada_em));
      } catch (error) {
        log(`não li a fila do chat: ${errorText(error)}`);
        return;
      }
      // Once one waits (the PC is off), the rest go in the queue without waiting each for the ack.
      let wait = deps.waitMs;
      for (const row of rows) {
        if (!(await park(queue, row))) continue;
        let to: SendResult;
        try {
          to = await send(row, wait);
        } catch (error) {
          // Parked: step 1 of the next round sends it.
          log(`${phoneMarker(row.id)} não entrou na fila do PC: ${errorText(error)}`);
          return;
        }
        if (to === 'pendente') {
          wait = 0;
          log(`${phoneMarker(row.id)} na fila do PC, esperando ele entregar ao Líder único`);
          continue;
        }
        await mark(queue, row, to);
      }
    } finally {
      inRound = false;
    }
  }

  function schedule(ms: number): void {
    timer = setTimeout(() => {
      void round()
        .catch((error) => log(`rodada falhou: ${errorText(error)}`))
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
