// Chat do Líder pelo celular (plano da madrugada 18/11, item 11; contrato com o Dev do celular, t-d6995d93) — the owner
// writes to the Líder único in the phone app; the message waits in a queue in Supabase (`celular.lider_mensagens`,
// supabase/014 of donel-celular). The desktop, which holds the Líder's tab, takes it (`celular_lider_tomar`, reserved
// for 10 min), gives it to the Líder by the same path as the Jobu's bubble, marks it delivered
// (`celular_lider_entregue`) and, when a turn of the Líder that READ it ends, writes his answer back
// (`celular_lider_responder`). Only RPCs in `public`, with the service key the Oráculo's mirror already uses (the
// schema `celular` stays out of the API). The key never enters a log line nor an error message.
//
// Which turn answers which message: the text given to the Líder carries a marker (`[celular #<8 of the id>]`). At the
// end of each turn of the Líder, the tail of his transcript says whether the marker was read (a prompt of his, or a
// message the CLI put into a running turn) and whether he wrote after it. Only then the message is answered, with
// the last thing he said. What is waiting survives a restart of the app (`save`).

import { randomUUID } from 'node:crypto';
import type { LiderSendResult } from '../../shared/lider/ipc';

/** The text the Líder reads before the owner's message; it is also how the transcript is matched to the message. */
export function phoneMarker(id: string): string {
  return `[celular #${id.slice(0, 8)}]`;
}

const DELIVERED_NOTE = 'entregue ao Líder no desktop';
const JOINED_REPLY = '↳ respondi junto com a mensagem seguinte.';
/** `celular.lider_mensagens.texto` holds up to 4000 characters. */
const MAX_REPLY_CHARS = 4000;
const TAKE_LIMIT = 5;
/** A delivered message never read by the Líder in this long is dropped from the wait (the transcript lost it). */
const MAX_WAIT_MS = 24 * 60 * 60_000;

interface Reply {
  readonly p_id: string;
  readonly p_em_resposta_a: string;
  readonly p_texto: string;
}

interface Waiting {
  readonly id: string;
  readonly at: number;
}

/** What survives a restart: the messages delivered and not yet answered, and the answers that did not go. */
export interface CelularChatState {
  readonly waiting: readonly Waiting[];
  readonly outbox: readonly Reply[];
}

export interface CelularLiderChatDeps {
  /** One RPC in `public`; throws when it did not run (no network, HTTP error). */
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  /** Gives the text to the Líder único (opens one when none is open). */
  deliver(text: string): Promise<LiderSendResult>;
  newId?: () => string;
  now?: () => number;
  /** One line per event. Never the key, never the owner's text. */
  log?: (line: string) => void;
  load?: () => CelularChatState | null;
  save?: (state: CelularChatState) => void;
}

export interface CelularLiderChat {
  /** Retries the answers that did not go, then takes and delivers the owner's new messages. Never overlaps itself. */
  poll(): Promise<void>;
  /** A turn of the Líder ended: `text` is his last answer, `transcriptTail` the end of his transcript (`null` = not read). */
  turnEnded(text: string | null, transcriptTail: string | null): Promise<void>;
}

interface TakenRow {
  readonly id: string;
  readonly texto: string;
}

function takenRows(value: unknown): TakenRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is TakenRow =>
      typeof row === 'object' && row !== null && typeof (row as TakenRow).id === 'string' && typeof (row as TakenRow).texto === 'string',
  );
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_REPLY_CHARS ? trimmed : `${trimmed.slice(0, MAX_REPLY_CHARS - 1)}…`;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : ''))
    .join('\n');
}

/**
 * The markers of `ids` the Líder read AND wrote after, in the tail of his transcript: a user line of the main thread
 * (typed or sent by the app) or a message the CLI put into a running turn (`queued_command`), followed by a text of
 * his. Lines cut at the start of the tail or not JSON are skipped.
 */
export function answeredIds(transcriptTail: string, ids: readonly string[]): string[] {
  const events: Array<{ kind: 'read'; text: string } | { kind: 'wrote' }> = [];
  for (const line of transcriptTail.split('\n')) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null || entry.isSidechain === true) continue;
    if (entry.type === 'user') {
      events.push({ kind: 'read', text: textOf((entry.message as { content?: unknown } | undefined)?.content) });
    } else if (entry.type === 'attachment') {
      const attachment = entry.attachment as { type?: unknown; prompt?: unknown } | undefined;
      if (attachment?.type === 'queued_command') events.push({ kind: 'read', text: textOf(attachment.prompt) });
    } else if (entry.type === 'assistant' && textOf((entry.message as { content?: unknown } | undefined)?.content).trim()) {
      events.push({ kind: 'wrote' });
    }
  }
  return ids.filter((id) => {
    const marker = phoneMarker(id);
    let readAt = -1;
    events.forEach((event, index) => {
      if (event.kind === 'read' && event.text.includes(marker)) readAt = index;
    });
    return readAt >= 0 && events.slice(readAt + 1).some((event) => event.kind === 'wrote');
  });
}

export function createCelularLiderChat(deps: CelularLiderChatDeps): CelularLiderChat {
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const saved = deps.load?.() ?? null;
  /** Delivered to the Líder and not answered yet, in delivery order. */
  let waiting: Waiting[] = [...(saved?.waiting ?? [])];
  /** Answers that did not go; retried with the same id (the RPC does not write the same id twice). */
  const outbox: Reply[] = [...(saved?.outbox ?? [])];
  let polling = false;

  const persist = (): void => {
    try {
      deps.save?.({ waiting, outbox });
    } catch (error) {
      log(`não gravei o estado do chat do celular: ${error instanceof Error ? error.message : 'erro'}`);
    }
  };

  const flush = async (): Promise<boolean> => {
    while (outbox.length > 0) {
      const reply = outbox[0]!;
      try {
        await deps.rpc('celular_lider_responder', { ...reply });
        outbox.shift();
        persist();
        log(`resposta enviada ao celular (${phoneMarker(reply.p_em_resposta_a)})`);
      } catch (error) {
        log(`resposta ao celular não foi: ${error instanceof Error ? error.message : 'erro'}`);
        return false;
      }
    }
    return true;
  };

  return {
    async poll() {
      if (polling) return;
      polling = true;
      try {
        if (!(await flush())) return;
        const before = waiting.length;
        waiting = waiting.filter((entry) => now() - entry.at < MAX_WAIT_MS);
        if (waiting.length !== before) {
          log(`${before - waiting.length} mensagem(ns) do celular sem leitura do Líder em 24 h saíram da espera`);
          persist();
        }
        let rows: TakenRow[];
        try {
          rows = takenRows(await deps.rpc('celular_lider_tomar', { p_limite: TAKE_LIMIT }));
        } catch (error) {
          log(`não li a fila do celular: ${error instanceof Error ? error.message : 'erro'}`);
          return;
        }
        for (const row of rows) {
          const result = await deps.deliver(`${phoneMarker(row.id)} ${row.texto}`);
          if (!result.ok) {
            // Not marked: the reservation ends in 10 min and the message comes back. The rest waits with it.
            log(`mensagem do celular ${phoneMarker(row.id)} não chegou ao Líder: ${result.reason}`);
            return;
          }
          if (!waiting.some((entry) => entry.id === row.id)) waiting.push({ id: row.id, at: now() });
          persist();
          try {
            await deps.rpc('celular_lider_entregue', { p_id: row.id, p_resultado: DELIVERED_NOTE });
          } catch (error) {
            log(`não marquei ${phoneMarker(row.id)} como entregue: ${error instanceof Error ? error.message : 'erro'}`);
          }
        }
      } finally {
        polling = false;
      }
    },

    async turnEnded(text, transcriptTail) {
      if (waiting.length === 0 || transcriptTail === null) return;
      if (text === null || text.trim() === '') return;
      const answered = answeredIds(
        transcriptTail,
        waiting.map((entry) => entry.id),
      );
      if (answered.length === 0) return;
      waiting = waiting.filter((entry) => !answered.includes(entry.id));
      const newest = answered[answered.length - 1]!;
      outbox.push({ p_id: newId(), p_em_resposta_a: newest, p_texto: clip(text) });
      for (const id of answered.slice(0, -1).reverse()) outbox.push({ p_id: newId(), p_em_resposta_a: id, p_texto: JOINED_REPLY });
      persist();
      await flush();
    },
  };
}

/** Where the RPCs go: the Supabase of the Oráculo's mirror. `null` = not configured (the chat with the phone is off). */
export interface SupabaseAccess {
  readonly url: string;
  readonly key: () => string | null;
}

const RPC_TIMEOUT_MS = 15_000;

/** One RPC by PostgREST with the service key. The error says what happened, never the key nor the body. */
export function createSupabaseRpc(access: () => SupabaseAccess | null, doFetch: typeof fetch = fetch): CelularLiderChatDeps['rpc'] {
  return async (fn, args) => {
    const target = access();
    if (target === null) throw new Error('espelho do Oráculo sem Supabase configurado');
    const key = target.key();
    if (!key) throw new Error('chave do Supabase fora do cofre');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(`${target.url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: controller.signal,
      });
    } catch {
      throw new Error(controller.signal.aborted ? 'sem resposta do Supabase' : 'sem rede');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`Supabase respondeu ${response.status} em ${fn}`);
    const body = await response.text();
    return body ? (JSON.parse(body) as unknown) : null;
  };
}

/** The persisted state, validated: anything else is dropped. */
export function parseCelularChatState(text: string | null): CelularChatState | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as { waiting?: unknown; outbox?: unknown };
    const waiting = Array.isArray(raw.waiting)
      ? raw.waiting.filter((entry): entry is Waiting => typeof entry?.id === 'string' && typeof entry?.at === 'number')
      : [];
    const outbox = Array.isArray(raw.outbox)
      ? raw.outbox.filter(
          (reply): reply is Reply => typeof reply?.p_id === 'string' && typeof reply?.p_em_resposta_a === 'string' && typeof reply?.p_texto === 'string',
        )
      : [];
    return { waiting, outbox };
  } catch {
    return null;
  }
}
