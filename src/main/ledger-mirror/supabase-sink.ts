// Espelho do Oráculo — destination Supabase (the owner's PERSONAL project, never a Seazone one): an upsert of every
// row into the table `tarefas` through PostgREST. The table and the view "em aberto" are created once by
// docs/oraculo-espelho/supabase.sql. The service key comes from the vault at each push and never enters an error
// message or a log line. t-36a99827 — then the cards for the phone (`cartas.ts`), by RPC, on a loop of their own:
// `push` resolves once the tasks went; the cards' list and the proof uploads run behind it (one at a time, the newest
// list wins) and try again on their own bounded backoff, so a slow upload never holds the tasks nor "Enviar agora".

import { LATE_COLUMNS, missingLateColumn, withoutLateColumns, type CartaRow } from '../../shared/ledger/mirror';
import { nodeTimers, type MirrorSink, type MirrorTimers } from './mirror';
import { PROVA_RPC, pushCartas, type PreparedProof, type ProofReader, type UploadFailure } from './cartas';

export const SUPABASE_TABLE = 'tarefas';
const TIMEOUT_MS = 20_000;
/** A print of 5 MB goes as ~7 MB of base64: more time than a row. */
const PROOF_TIMEOUT_MS = 90_000;
/** PostgREST takes a big body, but a bounded batch keeps one bad row from hiding the rest. */
const BATCH = 200;
/** The cards' own retry (a list not taken, an upload failed, a file not here yet): 1 min doubling to 15 min, 6 times. */
const CARDS_RETRY_MS = 60_000;
const MAX_CARDS_RETRY_MS = 15 * 60_000;
const MAX_CARDS_RETRIES = 6;
export interface SupabaseSinkDeps {
  /** `https://<ref>.supabase.co`. */
  readonly url: string;
  /** The service key, read when needed; `null` = not in the vault. */
  readonly key: () => string | null;
  readonly fetch?: typeof fetch;
  /** t-36a99827 — the proof files of the cards (`createProofReader` over `ledger-provas/`); absent = none goes. */
  readonly readProof?: ProofReader;
  /** One line per event of the cards' step (a failure, an upload). Never a secret. */
  readonly log?: (line: string) => void;
  /** The cards' retry timer (tests pass fake ones). */
  readonly timers?: MirrorTimers;
  readonly now?: () => number;
}

export interface SupabaseSink extends MirrorSink {
  /** Resolves once the cards' step running behind the last push is over (its retry timer may still be set). */
  idle(): Promise<void>;
  dispose(): void;
}

export function createSupabaseSink(deps: SupabaseSinkDeps): SupabaseSink {
  const doFetch = deps.fetch ?? fetch;
  const base = deps.url.replace(/\/+$/, '');
  const endpoint = `${base}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`;
  const log = deps.log ?? (() => undefined);
  const readProof: ProofReader = deps.readProof ?? (async () => ({ kind: 'sumiu' }));
  const proofCache = new Map<string, PreparedProof>();
  const uploadFailures = new Map<string, UploadFailure>();
  const timers = deps.timers ?? nodeTimers;
  const now = deps.now ?? Date.now;

  /** One POST with the service key; the error says what happened, never the key nor a body that echoes it. */
  async function post(url: string, key: string, body: unknown, timeoutMs: number, prefer?: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(prefer ? { Prefer: prefer } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // undici hides the reason in `cause` (a connect timeout, DNS, a reset); only its code goes out, never a secret.
      const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
      const reason = typeof code === 'string' ? code : error instanceof Error ? error.name : 'erro';
      throw new Error(controller.signal.aborted ? `sem resposta do Supabase em ${Math.round(timeoutMs / 1000)} s` : `sem rede (${reason})`);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200).replaceAll(key, '[chave]');
      throw new Error(`Supabase respondeu ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response;
  }

  /** The newest list not sent yet; the loop takes it. */
  let nextCartas: readonly CartaRow[] | null = null;
  let looping = false;
  let running: Promise<void> = Promise.resolve();
  let retryTimer: unknown = null;
  let retries = 0;
  let disposed = false;

  function startCartas(): void {
    if (looping || disposed) return;
    looping = true;
    running = cartasLoop();
  }

  async function cartasLoop(): Promise<void> {
    try {
      while (nextCartas && !disposed) {
        const list = nextCartas;
        nextCartas = null;
        const key = deps.key();
        let incomplete = true;
        try {
          if (!key) throw new Error('a chave do Supabase não está no cofre');
          const result = await pushCartas(list, {
            rpc: async (fn, body) => {
              const response = await post(`${base}/rest/v1/rpc/${fn}`, key, body, fn === PROVA_RPC ? PROOF_TIMEOUT_MS : TIMEOUT_MS);
              const text = await response.text();
              try {
                return text ? (JSON.parse(text) as unknown) : null;
              } catch {
                // The parser's message quotes the body: never into a log.
                throw new Error(`${fn} respondeu fora do formato`);
              }
            },
            read: readProof,
            log,
            cache: proofCache,
            failures: uploadFailures,
            now,
            stale: () => nextCartas !== null || disposed,
          });
          incomplete = result.incomplete;
        } catch (error) {
          // The RPC not created yet (404), no network: a log line, and the cards' own retry.
          const message = error instanceof Error ? error.message : 'falhou';
          log(`cartas do celular não foram: ${key ? message.replaceAll(key, '[chave]') : message}`);
        }
        if (nextCartas || disposed) continue; // a newer list goes now, with its own tries
        if (incomplete) scheduleRetry(list);
        else retries = 0;
      }
    } finally {
      looping = false;
    }
  }

  /** Bounded: after `MAX_CARDS_RETRIES` the cards wait for the next change of the ledger. */
  function scheduleRetry(list: readonly CartaRow[]): void {
    if (retryTimer !== null) return;
    if (retries >= MAX_CARDS_RETRIES) {
      log('cartas do celular: paro de tentar até a próxima mudança do Oráculo');
      return;
    }
    const wait = Math.min(CARDS_RETRY_MS * 2 ** retries, MAX_CARDS_RETRY_MS);
    retries += 1;
    log(`cartas do celular: tento de novo em ${Math.round(wait / 1000)} s`);
    retryTimer = timers.set(() => {
      retryTimer = null;
      nextCartas ??= list;
      startCartas();
    }, wait);
  }

  return {
    async push(rows, cartas) {
      const key = deps.key();
      if (!key) throw new Error('a chave do Supabase não está no cofre');
      let lateMissing = false;
      for (let start = 0; start < rows.length; start += BATCH) {
        const batch = rows.slice(start, start + BATCH).map((row) => ({ ...row, atualizado_em: new Date().toISOString() }));
        const send = (body: readonly Record<string, unknown>[]): Promise<Response> => post(endpoint, key, body, TIMEOUT_MS, 'resolution=merge-duplicates,return=minimal');
        if (lateMissing) {
          await send(batch.map(withoutLateColumns));
          continue;
        }
        try {
          await send(batch);
        } catch (error) {
          if (!missingLateColumn(error)) throw error;
          lateMissing = true;
          log(`tarefas sem as colunas ${LATE_COLUMNS.join(', ')}: vão sem elas até rodar docs/oraculo-espelho/tarefas-dod.sql`);
          await send(batch.map(withoutLateColumns));
        }
      }
      if (!cartas || disposed) return;
      // After the tasks (the phone's view joins the cards to them), and not awaited: the cards run behind, and a
      // newer list replaces one still waiting.
      if (retryTimer !== null) {
        timers.clear(retryTimer);
        retryTimer = null;
      }
      retries = 0;
      nextCartas = cartas;
      startCartas();
    },
    async idle() {
      while (looping) await running;
    },
    dispose() {
      disposed = true;
      nextCartas = null;
      if (retryTimer !== null) timers.clear(retryTimer);
      retryTimer = null;
    },
  };
}
