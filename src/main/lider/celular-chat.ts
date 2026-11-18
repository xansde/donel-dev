// Chat do Líder pelo celular (plano da madrugada 18/11, item 11; contrato com o Dev do celular, t-d6995d93) — the owner
// writes to the Líder único in the phone app; the message waits in a queue in Supabase (`celular.lider_mensagens`,
// supabase/014 of donel-celular). The desktop, which holds the Líder's tab, takes it (`celular_lider_tomar`, reserved
// for 10 min), gives it to the Líder by the same path as the Jobu's bubble, marks it delivered
// (`celular_lider_entregue`) and, when the Líder's turn on it ends, writes his answer back (`celular_lider_responder`).
// Only RPCs in `public`, with the service key the Oráculo's mirror already uses (the schema `celular` stays out of
// the API). The key never enters a log line nor an error message.
//
// Which turn answers which message: the text given to the Líder carries a marker (`[celular #<8 of the id>]`); the
// prompt the CLI submits (UserPromptSubmit) says which messages that turn took. A turn with no prompt of its own (the
// message went in the middle of a running turn) answers what was delivered before it ended.

import { randomUUID } from 'node:crypto';
import type { LiderSendResult } from '../../shared/lider/ipc';

/** The text the Líder reads before the owner's message; it is also how a prompt is matched to the message. */
export function phoneMarker(id: string): string {
  return `[celular #${id.slice(0, 8)}]`;
}

const DELIVERED_NOTE = 'entregue ao Líder no desktop';
const JOINED_REPLY = '↳ respondi junto com a mensagem seguinte.';
/** `celular.lider_mensagens.texto` holds up to 4000 characters. */
const MAX_REPLY_CHARS = 4000;
const TAKE_LIMIT = 5;

export interface CelularLiderChatDeps {
  /** One RPC in `public`; throws when it did not run (no network, HTTP error). */
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  /** Gives the text to the Líder único (opens one when none is open). */
  deliver(text: string): Promise<LiderSendResult>;
  newId?: () => string;
  /** One line per event. Never the key, never the owner's text. */
  log?: (line: string) => void;
}

export interface CelularLiderChat {
  /** Retries the answers that did not go, then takes and delivers the owner's new messages. Never overlaps itself. */
  poll(): Promise<void>;
  /** The Líder's CLI submitted a prompt (its full text). */
  promptSubmitted(text: string): void;
  /** The Líder's turn ended with `text` (his last answer; `null` = not read). */
  turnEnded(text: string | null): Promise<void>;
}

interface Reply {
  readonly p_id: string;
  readonly p_em_resposta_a: string;
  readonly p_texto: string;
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

export function createCelularLiderChat(deps: CelularLiderChatDeps): CelularLiderChat {
  const newId = deps.newId ?? randomUUID;
  const log = deps.log ?? (() => undefined);
  /** Delivered to the Líder, not yet seen in a prompt of his. In delivery order. */
  let awaiting: string[] = [];
  /** Seen in a prompt of the running turn. */
  let inTurn: string[] = [];
  let sawPrompt = false;
  /** Answers that did not go; retried with the same id (the RPC does not write the same id twice). */
  const outbox: Reply[] = [];
  let polling = false;

  const flush = async (): Promise<boolean> => {
    while (outbox.length > 0) {
      const reply = outbox[0]!;
      try {
        await deps.rpc('celular_lider_responder', { ...reply });
        outbox.shift();
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
          awaiting.push(row.id);
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

    promptSubmitted(text) {
      sawPrompt = true;
      const taken = awaiting.filter((id) => text.includes(phoneMarker(id)));
      if (taken.length === 0) return;
      inTurn.push(...taken);
      awaiting = awaiting.filter((id) => !taken.includes(id));
    },

    async turnEnded(text) {
      const ids = sawPrompt ? inTurn : awaiting;
      if (!sawPrompt) awaiting = [];
      inTurn = [];
      sawPrompt = false;
      if (ids.length === 0) return;
      if (text === null || text.trim() === '') {
        // Nothing to send now: they wait for the next turn of the Líder.
        awaiting = [...ids, ...awaiting];
        return;
      }
      const newest = ids[ids.length - 1]!;
      outbox.push({ p_id: newId(), p_em_resposta_a: newest, p_texto: clip(text) });
      for (const id of ids.slice(0, -1).reverse()) outbox.push({ p_id: newId(), p_em_resposta_a: id, p_texto: JOINED_REPLY });
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
