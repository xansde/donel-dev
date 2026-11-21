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
// message the CLI put into a running turn) and what he wrote after it, until the next message he read: that is the
// answer that goes back. What is waiting survives a restart of the app (`save`).

import { randomUUID } from 'node:crypto';
import { unwrapPastedContent } from '../../shared/chat/promptMatch';
import type { LiderSendResult } from '../../shared/lider/ipc';
import { isBlankReply } from '../../shared/lider/blankReply';

/** The text the Líder reads before the owner's message; it is also how the transcript is matched to the message. */
export function phoneMarker(id: string): string {
  return `[celular #${id.slice(0, 8)}]`;
}

/**
 * How a correction names the audio it corrects (t-753e8199): the audio's own marker, so the Líder sees which message it
 * is, read as a reference and never as the audio read again (`answersIn` skips it; otherwise the answer to the
 * correction would replace the audio's).
 */
export function phoneReference(id: string): string {
  return `correção da transcrição de ${phoneMarker(id)}`;
}

/** The text with every reference to an earlier message taken out: what is left says which messages it brings. */
function withoutReferences(text: string, ids: readonly string[]): string {
  return ids.reduce((rest, id) => rest.split(phoneReference(id)).join(''), text);
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

/**
 * Etapa 2 (t-c3fbe852) — whether this desktop takes the phone's queue now. It always does, except when the Líder único
 * lives in a remote tab on the machine of the Oráculo (the VPS whose daemon holds the ledger): that daemon takes the
 * queue and hands it to him there, with the PC off too. No Líder open: this desktop takes it and `deliver` opens one,
 * as before. A Líder on this PC, or on another machine (the Homologações), is this desktop's: the Oráculo would only
 * park the line in the relay, and his answer would not come back by itself.
 */
export function desktopTakesPhoneQueue(input: {
  readonly leaderPtyId: string | null;
  /** The ssh target of a remote tab; `undefined` = a tab of this PC. */
  readonly sshTargetOf: (ptyId: string) => string | undefined;
  /** Where the ledger lives (`remoto` on `lugar`); `null` = not known yet. */
  readonly oracle: { readonly mode: 'local' | 'remoto'; readonly lugar: string | null } | null;
  readonly remotes: readonly { readonly id: string; readonly sshTarget: string }[];
}): boolean {
  if (input.leaderPtyId === null) return true;
  const leaderAt = input.sshTargetOf(input.leaderPtyId);
  if (!leaderAt || input.oracle?.mode !== 'remoto' || !input.oracle.lugar) return true;
  const oracleAt = input.remotes.find((place) => place.id === input.oracle!.lugar)?.sshTarget;
  return !oracleAt || oracleAt !== leaderAt;
}

export interface CelularLiderChatDeps {
  /** One RPC in `public`; throws when it did not run (no network, HTTP error). */
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
  /** Gives the text to the Líder único (opens one when none is open). */
  deliver(text: string): Promise<LiderSendResult>;
  /**
   * Etapa 2 (t-c3fbe852) — whether this desktop takes the phone's queue now (`desktopTakesPhoneQueue`): not while the
   * Líder único lives on the Oráculo's machine, whose daemon is then the only one to take it. Absent = always.
   */
  mayTake?: () => boolean;
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
  /**
   * A turn of the Líder ended: `transcriptTail` is the end of his transcript (`null` = not read). `false` = messages wait
   * and none was answered by this tail (a mirror still behind may be read again).
   */
  turnEnded(transcriptTail: string | null, lastAnswer?: string | null): Promise<boolean>;
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

/** How the CLI records what a Stop hook gave back to the model (the end-of-turn delivery of the recados queue). */
const STOP_FEEDBACK = 'Stop hook feedback:';

/**
 * A line the Líder READ as a new message: a prompt of the main thread with text (not a tool result, not a tag), a
 * message the CLI put into a running turn, or what a Stop hook gave him at the end of a turn (a meta prompt starting
 * with `Stop hook feedback:`; its `hook_blocking_error` attachment repeats the same text and is not counted again).
 * No other meta line counts.
 */
function readText(entry: Record<string, unknown>): string | null {
  let content: string;
  if (entry.type === 'attachment') {
    const attachment = entry.attachment as { type?: unknown; prompt?: unknown } | undefined;
    if (attachment?.type !== 'queued_command') return null;
    content = textOf(attachment.prompt);
  } else if (entry.type === 'user') {
    content = textOf((entry.message as { content?: unknown } | undefined)?.content);
    if (entry.isMeta === true) {
      const trimmed = content.trimStart();
      return trimmed.startsWith(STOP_FEEDBACK) ? trimmed.slice(STOP_FEEDBACK.length).trim() || null : null;
    }
  } else {
    return null;
  }
  // A long or multi-line message goes by bracketed paste, and the CLI records it as `<pasted_content id=…>…`.
  const text = unwrapPastedContent(content).trim();
  // Tool results carry no text block; `<task-notification>` (also queued into a running turn), `<command-name>` and the
  // like are not a message: a background task ending in the middle of his answer does not cut it.
  return text && !text.startsWith('<') ? text : null;
}

/**
 * For each of `ids` whose marker the Líder read in the tail of his transcript (a prompt of his, a message the CLI
 * put into a running turn, or an end-of-turn delivery by the Stop hook), what he wrote AFTER reading it and before the
 * next message he read: his answer to it. Only the ids he already answered come back. Lines cut at the start of the
 * tail, not JSON, or of a subagent are skipped. `closedOnly`: only the answers a later message he read already closed
 * (the turn may still be going, but what he wrote before reading something new is whole).
 */
export function answersIn(transcriptTail: string, ids: readonly string[], options: { readonly closedOnly?: boolean } = {}): Map<string, string> {
  const events: Array<{ kind: 'read'; text: string } | { kind: 'wrote'; text: string }> = [];
  for (const line of transcriptTail.split('\n')) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null || entry.isSidechain === true) continue;
    const read = readText(entry);
    if (read !== null) {
      events.push({ kind: 'read', text: read });
      continue;
    }
    if (entry.type === 'assistant') {
      const text = textOf((entry.message as { content?: unknown } | undefined)?.content).trim();
      // Empty or a lone "-" never goes to the phone, nor replaces a good answer written before it (t-d461e003).
      if (!isBlankReply(text)) events.push({ kind: 'wrote', text });
    }
  }
  const answers = new Map<string, string>();
  const phoneMarkers = ids.map(phoneMarker);
  for (const event of events) if (event.kind === 'read') event.text = withoutReferences(event.text, ids);
  for (const id of ids) {
    const marker = phoneMarker(id);
    let readAt = -1;
    events.forEach((event, index) => {
      if (event.kind === 'read' && event.text.includes(marker)) readAt = index;
    });
    if (readAt < 0) continue;
    let answer: string | null = null;
    let closed = false;
    for (const event of events.slice(readAt + 1)) {
      // Another phone message read right after (nothing written between them) is answered together.
      if (event.kind === 'read') {
        if (answer === null && phoneMarkers.some((other) => event.text.includes(other))) continue;
        closed = true;
        break;
      }
      answer = event.text;
    }
    if (answer !== null && (closed || !options.closedOnly)) answers.set(id, answer);
  }
  return answers;
}

/** The ids of `ids` already answered in the tail (see `answersIn`). */
export function answeredIds(transcriptTail: string, ids: readonly string[]): string[] {
  const answers = answersIn(transcriptTail, ids);
  return ids.filter((id) => answers.has(id));
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

  const sendReplies = async (): Promise<boolean> => {
    while (outbox.length > 0) {
      const reply = outbox[0]!;
      try {
        await deps.rpc('celular_lider_responder', { ...reply });
        outbox.shift();
        persist();
        log(`resposta enviada ao celular (${phoneMarker(reply.p_em_resposta_a)})`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'erro';
        if (error instanceof RpcRefused) {
          // Refused for good (the message it answers is gone, a text the database does not take): dropped, so it
          // never holds the queue of the phone behind it.
          outbox.shift();
          persist();
          log(`resposta ao celular recusada e descartada (${phoneMarker(reply.p_em_resposta_a)}): ${reason}`);
          continue;
        }
        log(`resposta ao celular não foi: ${reason}`);
        return false;
      }
    }
    return true;
  };
  /** One send of the answers at a time (the poll and the end of a turn both call it). */
  let sending: Promise<boolean> | null = null;
  const flush = (): Promise<boolean> => {
    sending ??= sendReplies().finally(() => {
      sending = null;
    });
    return sending;
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
        if (deps.mayTake && !deps.mayTake()) return;
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

    async turnEnded(transcriptTail, lastAnswer) {
      if (waiting.length === 0) return true;
      if (transcriptTail === null) return false;
      // The tail of a remote Líder is a mirror that may still be behind the Stop: wait until it holds his last answer.
      if (lastAnswer && !transcriptTail.includes(JSON.stringify(lastAnswer.trim()).slice(1, -1).slice(-160))) return false;
      const answers = answersIn(
        transcriptTail,
        waiting.map((entry) => entry.id),
      );
      if (answers.size === 0) return false;
      const answered = waiting.map((entry) => entry.id).filter((id) => answers.has(id));
      waiting = waiting.filter((entry) => !answers.has(entry.id));
      // Read together (nothing written between them): the whole answer on the newest, the others point to it.
      for (let index = 0; index < answered.length; index += 1) {
        const id = answered[index]!;
        const text = answers.get(id)!;
        const sameAsNext = answered.slice(index + 1).some((other) => answers.get(other) === text);
        outbox.push({ p_id: newId(), p_em_resposta_a: id, p_texto: sameAsNext ? JOINED_REPLY : clip(text) });
      }
      persist();
      await flush();
      return true;
    },
  };
}

/** Where the RPCs go: the Supabase of the Oráculo's mirror. `null` = not configured (the chat with the phone is off). */
export interface SupabaseAccess {
  readonly url: string;
  readonly key: () => string | null;
}

const RPC_TIMEOUT_MS = 15_000;

/** The database answered and refused the call (4xx other than auth, timeout or rate limit): trying again will not help. */
export class RpcRefused extends Error {}

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
    if (!response.ok) {
      const message = `Supabase respondeu ${response.status} em ${fn}`;
      const permanent = response.status >= 400 && response.status < 500 && ![401, 403, 408, 429].includes(response.status);
      throw permanent ? new RpcRefused(message) : new Error(message);
    }
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
