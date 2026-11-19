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
//
// Etapa 2 (t-c3fbe852) — with the Líder único alive in this machine's tmux (`local`), the parked row's message goes to
// its recados queue instead of the relay (the same key), and the row is closed only once the queue says the Líder got
// it (end of turn, or typed and confirmed). His answer comes from his transcript here: when a turn that read the
// marker has ended, or a message he read later closed what he wrote (the Stop hook hands him the next recado in the
// same second his turn ends), what he wrote after it goes back (`celular_lider_responder`, the attribution of the
// desktop router, `answersIn`), once per row (the reply id is kept, the RPC never writes the same id twice, and a row
// the conversation already holds an answer to, given by hand with `chat_lider.py`, gets none). A key that went
// to the relay (the Líder left before reading it, or it was there before he came) stays the relay's: never both ways.
// No Líder here: the relay, as before.

import { randomUUID } from 'node:crypto';
import type { BoardConfig } from './board-client';
import { createServiceRequest, type ServiceRequest } from './decisoes';
import type { Relay } from './relay';
import { answersIn, phoneMarker } from '../main/lider/celular-chat';
import type { OwnerMessage } from '../main/ledger-card-writer';
import type { LedgerDeliveredTo } from '../shared/ledger/contract';
import type { RecadoState } from './recados';

const FIRST_DELAY_MS = 5_000;
const ROUND_MS = 15_000;
const TAKE_LIMIT = 10;
const PARKED_LIMIT = 50;
/** The owner's words given whole up to this; the SQL keeps up to 4000. */
const MAX_TEXT = 3500;
/** `celular.lider_mensagens.texto` holds up to 4000 characters. */
const MAX_REPLY = 4000;
/** A row delivered here and never answered in this long leaves the wait (the transcript lost it). */
const MAX_WAIT_MS = 24 * 60 * 60_000;
const JOINED_REPLY = '↳ respondi junto com a mensagem seguinte.';
/** Under the owner's words when the Líder reads them here: nothing to run, his answer goes back by itself. */
export const LOCAL_REPLY_HINT = 'Responda aqui mesmo: o que você escrever ao fim deste turno volta sozinho ao celular.';
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
  /** The Líder's answer to `emRespostaA`, under the id `id` (the same id is never written twice). */
  responder(id: string, emRespostaA: string, texto: string): Promise<void>;
  /**
   * Whether the conversation already holds an answer of the Líder to `id` (his own, or one given by hand with
   * `chat_lider.py responder`). Absent = not known (the Supabase queue): nothing is skipped.
   */
  respondida?(id: string): boolean;
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
    async responder(id, emRespostaA, texto) {
      await rpc('celular_lider_responder', { p_id: id, p_em_resposta_a: emRespostaA, p_texto: texto });
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

/** The Líder único's own queue on this machine (recados.ts) and his transcript. */
export interface ChatCelularLocal {
  /**
   * Queues the message for the Líder único alive here (he reads `localText`; the message itself is what goes to the
   * relay should he leave before reading it): `'lider'`; `null` = none here (or the key is the relay's).
   */
  readonly deliver: (message: OwnerMessage, localText: string) => Promise<LedgerDeliveredTo>;
  /** The item a key made: its state and the session it went to. */
  readonly state: (key: string) => { readonly estado: RecadoState; readonly sid: string } | undefined;
  /** The end of the transcript of that session (`null` = not readable now). */
  readonly tail: (sid: string) => Promise<string | null>;
}

/** What waits for the Líder's answer, and the answers that did not go yet (kept across a restart by `store`). */
export interface ChatCelularReplies {
  readonly waiting: ReadonlyArray<{ readonly id: string; readonly at: number }>;
  readonly outbox: ReadonlyArray<{ readonly id: string; readonly emRespostaA: string; readonly texto: string }>;
}

/** The kept wait, validated: anything else is dropped. */
export function parseChatReplies(text: string | null): ChatCelularReplies | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as { waiting?: unknown; outbox?: unknown };
    const waiting = Array.isArray(raw.waiting) ? raw.waiting.filter((entry): entry is { id: string; at: number } => typeof entry?.id === 'string' && typeof entry?.at === 'number') : [];
    const outbox = Array.isArray(raw.outbox)
      ? raw.outbox.filter(
          (reply): reply is { id: string; emRespostaA: string; texto: string } =>
            typeof reply?.id === 'string' && typeof reply?.emRespostaA === 'string' && typeof reply?.texto === 'string',
        )
      : [];
    return { waiting, outbox };
  } catch {
    return null;
  }
}

/** The last main user/assistant entry of the tail is an assistant's end of turn: nothing he writes now is half done. */
export function turnEndedIn(tail: string): boolean {
  const lines = tail.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry: { type?: unknown; isSidechain?: unknown; message?: { stop_reason?: unknown } };
    try {
      entry = JSON.parse(lines[index]!) as typeof entry;
    } catch {
      continue;
    }
    if ((entry.type !== 'user' && entry.type !== 'assistant') || entry.isSidechain === true) continue;
    return entry.type === 'assistant' && (entry.message?.stop_reason === 'end_turn' || entry.message?.stop_reason === 'stop_sequence');
  }
  return false;
}

export interface ChatCelularConsumerDeps {
  /** The queue, or null while `decisoes.json` is missing or invalid (read at each round). */
  readonly queue: () => ChatCelularQueue | null;
  readonly relay: Pick<Relay, 'send' | 'pending'> & Partial<Pick<Relay, 'byKey'>>;
  /** How long a message waits for the PC's ack before the round moves on (it stays queued either way). */
  readonly waitMs: number;
  /** The line under the owner's words telling the Líder how to answer on the phone; absent = none. */
  readonly replyHint?: (shortId: string) => string;
  /** t-c3fbe852 — the Líder único's own queue here; absent = always the relay. */
  readonly local?: ChatCelularLocal;
  /** Where the wait for answers survives a restart; absent = memory only. */
  readonly store?: { load(): ChatCelularReplies | null; save(state: ChatCelularReplies): void };
  readonly newId?: () => string;
  readonly now?: () => number;
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
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const saved = (() => {
    try {
      return deps.store?.load() ?? null;
    } catch {
      return null;
    }
  })();
  let waiting: Array<{ id: string; at: number }> = [...(saved?.waiting ?? [])];
  const outbox: Array<{ id: string; emRespostaA: string; texto: string }> = [...(saved?.outbox ?? [])];
  const persist = (): void => {
    try {
      deps.store?.save({ waiting, outbox });
    } catch (error) {
      log(`não gravei a espera das respostas: ${errorText(error)}`);
    }
  };

  /** Whether the relay holds `key`; an unreadable fila.json = not known (the local queue still checks the key). */
  const relayKnows = (key: string): boolean => {
    try {
      return deps.relay.byKey?.(key) !== undefined;
    } catch {
      return false;
    }
  };

  /** Whether the conversation already holds an answer of the Líder to `id`; unreadable = not known (nothing skipped). */
  const answeredThere = (queue: ChatCelularQueue, id: string): boolean => {
    try {
      return queue.respondida?.(id) === true;
    } catch {
      return false;
    }
  };

  /** To the Líder único alive here (his queue, same key): true = queued (or already there). */
  async function toLocal(row: ChatCelularRow): Promise<boolean> {
    if (!deps.local) return false;
    const relayText = chatText(row, deps.replyHint);
    try {
      return (await deps.local.deliver({ projectPath: '', placeId: '', text: relayText, leaderText: relayText, key: chatKey(row.id) }, `${chatText(row)}\n${LOCAL_REPLY_HINT}`)) === 'lider';
    } catch (error) {
      log(`${phoneMarker(row.id)} não entrou na fila do Líder único daqui: ${errorText(error)}`);
      return false;
    }
  }

  /** The Líder read it here: the row is closed and waits for his answer. */
  async function markLocal(queue: ChatCelularQueue, row: ChatCelularRow): Promise<void> {
    if (!waiting.some((entry) => entry.id === row.id)) {
      waiting.push({ id: row.id, at: now() });
      persist();
    }
    await mark(queue, row, 'lider');
  }

  /** The answers that did not go, then the ones the Líder's transcript holds now. A failure keeps them for the next round. */
  async function answers(queue: ChatCelularQueue): Promise<void> {
    if (!deps.local) return;
    const before = waiting.length;
    waiting = waiting.filter((entry) => now() - entry.at < MAX_WAIT_MS);
    if (waiting.length !== before) {
      log(`${before - waiting.length} mensagem(ns) do celular sem resposta do Líder em 24 h saíram da espera`);
      persist();
    }
    const bySid = new Map<string, string[]>();
    for (const entry of waiting) {
      const sid = deps.local.state(chatKey(entry.id))?.sid;
      if (sid) bySid.set(sid, [...(bySid.get(sid) ?? []), entry.id]);
    }
    for (const [sid, ids] of bySid) {
      let tail: string | null;
      try {
        tail = await deps.local.tail(sid);
      } catch {
        tail = null;
      }
      if (!tail) continue;
      // An answer is whole once the turn ended, or once he read something after it: with recados arriving, the Stop
      // hook hands him the next one in the same second his turn ends, and a round every 15 s would never see the end.
      const found = answersIn(tail, ids, { closedOnly: !turnEndedIn(tail) });
      if (!found.size) continue;
      // Already answered in the conversation (by hand, or a reply of ours a restart kept): out of the wait, never twice.
      const already = ids.filter((id) => found.has(id) && answeredThere(queue, id));
      for (const id of already) {
        found.delete(id);
        log(`${phoneMarker(id)} já tinha resposta do Líder na conversa; não mandei outra`);
      }
      const answered = ids.filter((id) => found.has(id));
      waiting = waiting.filter((entry) => !found.has(entry.id) && !already.includes(entry.id));
      // Read together (nothing written between them): the whole answer on the newest, the others point to it.
      answered.forEach((id, index) => {
        const text = found.get(id)!.trim();
        const joined = answered.slice(index + 1).some((other) => found.get(other)!.trim() === text);
        outbox.push({ id: newId(), emRespostaA: id, texto: joined ? JOINED_REPLY : text.length <= MAX_REPLY ? text : `${text.slice(0, MAX_REPLY - 1)}…` });
      });
      persist();
    }
    while (outbox.length) {
      const reply = outbox[0]!;
      if (answeredThere(queue, reply.emRespostaA)) {
        // Answered by hand while this one waited to go (or it went and the restart kept it): not a second time.
        outbox.shift();
        persist();
        continue;
      }
      try {
        await queue.responder(reply.id, reply.emRespostaA, reply.texto);
      } catch (error) {
        log(`${phoneMarker(reply.emRespostaA)} resposta do Líder não foi ao celular: ${errorText(error)}`);
        return;
      }
      outbox.shift();
      persist();
      log(`${phoneMarker(reply.emRespostaA)} resposta do Líder único enviada ao celular`);
    }
  }

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
      await deliverRows(queue);
      // 3. His answers, from his transcript here.
      await answers(queue);
    } finally {
      inRound = false;
    }
  }

  /** Steps 1 and 2: the parked rows, then the new ones. */
  async function deliverRows(queue: ChatCelularQueue): Promise<void> {
    // 1. The parked rows: the relay answers where each went once the PC acked (the key joins, nothing new is queued).
    let parked: readonly ChatCelularRow[] = [];
    try {
      parked = await queue.estacionadas(PARKED, PARKED_LIMIT);
    } catch (error) {
      log(`não li as mensagens estacionadas: ${errorText(error)}`);
    }
    if (parked.length) {
      // Still pending in the relay: nothing to ask (and no new notice to the PC every round).
      // An unreadable fila.json (it throws) does not stop the rows in the Líder's queue here from closing.
      let pendingKeys: ReadonlySet<string> = new Set();
      try {
        pendingKeys = new Set(deps.relay.pending().map((item) => item.key));
      } catch (error) {
        log(`não li a fila do PC: ${errorText(error)}`);
      }
      for (const row of parked) {
        // In the Líder's queue here: closed once he got it; still waiting there, nothing to do. Gone back to the relay:
        // the relay's from now on.
        const here = deps.local?.state(chatKey(row.id));
        if (here?.estado === 'entregue') {
          await markLocal(queue, row);
          continue;
        }
        if (here && here.estado !== 'devolvido') continue;
        if (pendingKeys.has(chatKey(row.id))) continue;
        // Parked by a daemon that died before sending it, with the Líder here: his queue (unless the relay knows the key).
        if (!here && !relayKnows(chatKey(row.id)) && (await toLocal(row))) continue;
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
      if (await toLocal(row)) {
        log(`${phoneMarker(row.id)} na fila do Líder único desta VPS`);
        continue;
      }
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
