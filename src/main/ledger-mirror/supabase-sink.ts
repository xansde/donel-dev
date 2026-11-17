// Espelho do Oráculo — destination Supabase (the owner's PERSONAL project, never a Seazone one): an upsert of every
// row into the table `tarefas` through PostgREST. The table and the view "em aberto" are created once by
// docs/oraculo-espelho/supabase.sql. The service key comes from the vault at each push and never enters an error
// message or a log line. t-36a99827 — then the cards for the phone (`cartas.ts`), by RPC.

import type { MirrorSink } from './mirror';
import { PROVA_RPC, pushCartas, type PreparedProof, type ProofReader } from './cartas';

export const SUPABASE_TABLE = 'tarefas';
const TIMEOUT_MS = 20_000;
/** A print of 5 MB goes as ~7 MB of base64: more time than a row. */
const PROOF_TIMEOUT_MS = 90_000;
/** PostgREST takes a big body, but a bounded batch keeps one bad row from hiding the rest. */
const BATCH = 200;

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
}

export function createSupabaseSink(deps: SupabaseSinkDeps): MirrorSink {
  const doFetch = deps.fetch ?? fetch;
  const base = deps.url.replace(/\/+$/, '');
  const endpoint = `${base}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`;
  const log = deps.log ?? (() => undefined);
  const readProof: ProofReader = deps.readProof ?? (async () => ({ kind: 'sumiu' }));
  const proofCache = new Map<string, PreparedProof>();

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

  return {
    async push(rows, cartas) {
      const key = deps.key();
      if (!key) throw new Error('a chave do Supabase não está no cofre');
      for (let start = 0; start < rows.length; start += BATCH) {
        const batch = rows.slice(start, start + BATCH);
        await post(endpoint, key, batch.map((row) => ({ ...row, atualizado_em: new Date().toISOString() })), TIMEOUT_MS, 'resolution=merge-duplicates,return=minimal');
      }
      if (!cartas) return;
      // After the tasks (the phone's view joins the cards to them). A failure here — the RPC not created yet (404), a
      // proof too big for the API — is a log line: the tasks went, and the next push tries the cards again.
      try {
        await pushCartas(cartas, {
          rpc: async (fn, body) => {
            const response = await post(`${base}/rest/v1/rpc/${fn}`, key, body, fn === PROVA_RPC ? PROOF_TIMEOUT_MS : TIMEOUT_MS);
            const text = await response.text();
            return text ? (JSON.parse(text) as unknown) : null;
          },
          read: readProof,
          log,
          cache: proofCache,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'falhou';
        log(`cartas do celular não foram: ${message.replaceAll(key, '[chave]')}`);
      }
    },
  };
}
