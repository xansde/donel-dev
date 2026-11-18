// Chat do Líder pelo celular, com o PC no app de antes (t-cddc62fc) — the owner writes to the Líder único in the phone
// app; the row waits in `celular.lider_mensagens` (supabase/014 of donel-celular). The desktop's own router
// (src/main/lider/celular-chat.ts) only exists from the alfa 26.1118.428 on, so on an older PC nothing took the queue
// and the owner's words sat "na fila". This daemon takes it and hands each message to the relay (`fila.json`) with
// `placeId: ''`: the PC, old or new, delivers it to the Líder único and acks `'lider'` (the path the phone's decisions
// already use). Same config as the decision queue (`decisoes.json`: url + serviceKeyFile, the key read at each call,
// never logged), same round of 15 s. Two RPCs in `public`, only for the service_role:
// - `celular_lider_tomar(p_limite)` takes the owner's rows not delivered yet and reserves them for 10 min;
// - `celular_lider_entregue(p_id, p_resultado)` closes a row.
//
// Nothing duplicates: the relay's key is the row's id, so a row taken again (its reservation ended while the PC was
// off) joins the item already queued, and one already delivered answers where it went. Nothing is lost: a row is
// only marked after the PC's ack; a failure leaves it reserved, and it comes back when the reservation ends.
// Known overlap: an alfa 26.1118.428+ PC also takes the queue; the reservation keeps the two from taking the same row.

import type { BoardConfig } from './board-client';
import { createServiceRequest } from './decisoes';
import type { Relay } from './relay';
import { phoneMarker } from '../main/lider/celular-chat';

const FIRST_DELAY_MS = 5_000;
const ROUND_MS = 15_000;
const TAKE_LIMIT = 10;
/** The owner's words given whole up to this; the SQL keeps up to 4000. */
const MAX_TEXT = 3500;
export const DELIVERED_NOTE = 'entregue ao Líder único pela VPS';
/** The relay's key of a row: one message per row, whatever the round. */
export const chatKey = (id: string): string => `celular-chat:${id}`;

export interface ChatCelularRow {
  readonly id: string;
  readonly texto: string;
  readonly criada_em: string;
}

export interface ChatCelularQueue {
  /** Takes up to `limit` of the owner's rows not delivered yet, reserving them for 10 min. */
  tomar(limit: number): Promise<readonly ChatCelularRow[]>;
  /** Marks the row delivered; false = it was already. */
  entregue(id: string, resultado: string): Promise<boolean>;
}

function parseRow(value: unknown): ChatCelularRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, texto, criada_em } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !id || typeof texto !== 'string') return null;
  return { id, texto, criada_em: typeof criada_em === 'string' ? criada_em : '' };
}

export function createChatCelularQueue(config: BoardConfig, doFetch: typeof fetch = fetch): ChatCelularQueue {
  const { rpc } = createServiceRequest(config, doFetch);
  return {
    async tomar(limit) {
      const rows = await rpc('celular_lider_tomar', { p_limite: limit });
      if (!Array.isArray(rows)) throw new Error('o chat do celular respondeu algo que não é uma lista');
      return rows.map(parseRow).filter((row): row is ChatCelularRow => row !== null);
    },
    async entregue(id, resultado) {
      return (await rpc('celular_lider_entregue', { p_id: id, p_resultado: resultado })) === true;
    },
  };
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

export function createChatCelularConsumer(deps: ChatCelularConsumerDeps): ChatCelularConsumer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let inRound = false;
  let offLogged = false;
  // Rows queued while the PC was off, kept to mark as soon as its ack lands instead of after the reservation ends.
  const waiting = new Map<string, ChatCelularRow>();
  const log = (line: string): void => deps.log?.(`[chat-celular] ${line}`);
  const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  async function mark(queue: ChatCelularQueue, row: ChatCelularRow, to: Awaited<ReturnType<Relay['send']>>): Promise<void> {
    // With placeId '' the PC answers 'lider'; anything else still went somewhere, and the row says where.
    const note = to === 'lider' ? DELIVERED_NOTE : `entregue pela VPS a ${typeof to === 'object' ? to.placeId : String(to)}`;
    try {
      const marked = await queue.entregue(row.id, note);
      waiting.delete(row.id);
      log(`${phoneMarker(row.id)} ${note}${marked ? '' : ' (a linha já estava marcada)'}`);
    } catch (error) {
      // Delivered but not marked: the relay remembers it, so the next taking marks it without a second message.
      waiting.set(row.id, row);
      log(`${phoneMarker(row.id)} chegou ao Líder único, mas não marquei: ${errorText(error)}`);
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
      // The PC acked while the row was reserved: the relay answers where it went, no new item (the key joins).
      if (waiting.size) {
        const pendingKeys = new Set(deps.relay.pending().map((item) => item.key));
        for (const row of [...waiting.values()]) {
          if (pendingKeys.has(chatKey(row.id))) continue;
          const to = await deps.relay.send({ projectPath: '', placeId: '', text: chatText(row, deps.replyHint), leaderText: chatText(row, deps.replyHint), key: chatKey(row.id) }, 0);
          if (to !== 'pendente') await mark(queue, row, to);
        }
      }
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
        const text = chatText(row, deps.replyHint);
        let to: Awaited<ReturnType<Relay['send']>>;
        try {
          to = await deps.relay.send({ projectPath: '', placeId: '', text, leaderText: text, key: chatKey(row.id) }, wait);
        } catch (error) {
          log(`${phoneMarker(row.id)} não entrou na fila do PC: ${errorText(error)}`);
          return;
        }
        if (to === 'pendente') {
          waiting.set(row.id, row);
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
