// t-89279f84 (item 4 da estrutura enxuta, 18/11) — the Supabase (the owner's personal project, oraculo-harrow) as the
// SOURCE of the ledger. The daemon reads `public.ledger_tarefas` + `public.ledger_meta` once at boot and, at every op,
// writes the tasks that changed BEFORE answering: an op the Supabase did not take is refused, nothing half-done.
// The daemon is the only writer, so it keeps the document in memory (the reads stay synchronous) and sends only the
// difference. Tables: docs/oraculo-espelho/ledger-fonte.sql. The key is read at each call and never enters a log or
// an error message.

import type { LedgerDoc } from '../shared/ledger/contract';
import type { LedgerStore } from '../main/ledger-store';

export const LEDGER_TASKS_TABLE = 'ledger_tarefas';
export const LEDGER_META_TABLE = 'ledger_meta';
const PAGE = 1000;
const BATCH = 200;
const TIMEOUT_MS = 20_000;

export interface SupabaseLedgerDeps {
  /** `https://<ref>.supabase.co`. */
  readonly url: string;
  /** The service key, read at each call; `null` = unreadable. */
  readonly key: () => string | null;
  readonly fetch?: typeof fetch;
  readonly log?: (line: string) => void;
}

export interface SupabaseLedgerStore extends LedgerStore {
  /** Tasks the Supabase has now (as this daemon last read or wrote them). */
  count(): number;
}

/** JSON with the keys sorted: `jsonb` keeps its own key order, so a plain `JSON.stringify` never matches what came back. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.keys(inner as Record<string, unknown>).sort().map((k) => [k, (inner as Record<string, unknown>)[k]]))
      : inner,
  );
}

type RawDoc = { schemaVersion: unknown; startedAt: unknown; tasks: Record<string, unknown> };

function client(deps: SupabaseLedgerDeps) {
  const doFetch = deps.fetch ?? fetch;
  const base = deps.url.replace(/\/+$/, '');
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const key = deps.key();
    if (!key) throw new Error('a chave do Supabase não pôde ser lida');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(`${base}/rest/v1/${path}`, {
        method,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch {
      throw new Error(controller.signal.aborted ? `sem resposta do Supabase em ${TIMEOUT_MS / 1000} s` : 'sem rede até o Supabase');
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200).replaceAll(key, '[chave]');
      throw new Error(`Supabase respondeu ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return response;
  }
  return call;
}

/** Reads the whole ledger from the Supabase (paged by id). Throws when it cannot: the daemon must not start empty. */
export async function readSupabaseLedger(deps: SupabaseLedgerDeps): Promise<RawDoc & { exists: boolean }> {
  const call = client(deps);
  const meta = (await (await call('GET', `${LEDGER_META_TABLE}?select=schema_version,started_at&id=eq.1`)).json()) as Array<{ schema_version: number; started_at: number | null }>;
  const tasks: Record<string, unknown> = {};
  for (let from = 0; ; from += PAGE) {
    const rows = (await (await call('GET', `${LEDGER_TASKS_TABLE}?select=id,doc&order=id`, undefined, { Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' })).json()) as Array<{ id: string; doc: unknown }>;
    for (const row of rows) tasks[row.id] = row.doc;
    if (rows.length < PAGE) break;
  }
  const head = meta[0];
  return { exists: head !== undefined, schemaVersion: head?.schema_version ?? null, startedAt: head?.started_at ?? null, tasks };
}

/**
 * The store over what `readSupabaseLedger` gave. `write` sends the tasks whose JSON changed (and removes the ones that
 * left), then the header when it changed; `false` = the Supabase did not take it (logged), and the memory stays as
 * the Supabase has it, so the next write sends that difference again.
 */
export function createSupabaseLedgerStore(deps: SupabaseLedgerDeps, initial: RawDoc & { exists: boolean }): SupabaseLedgerStore {
  const call = client(deps);
  const log = deps.log ?? (() => undefined);
  const persisted = new Map<string, string>(Object.entries(initial.tasks).map(([id, task]) => [id, canonicalJson(task)]));
  let current: RawDoc | null = initial.exists || persisted.size > 0 ? { schemaVersion: initial.schemaVersion, startedAt: initial.startedAt, tasks: { ...initial.tasks } } : null;
  let head = initial.exists ? JSON.stringify([initial.schemaVersion, initial.startedAt]) : null;

  return {
    read: () => current,
    count: () => persisted.size,
    async write(doc: LedgerDoc): Promise<boolean> {
      const changed: Array<{ id: string; doc: unknown; json: string }> = [];
      for (const [id, task] of Object.entries(doc.tasks)) {
        const json = canonicalJson(task);
        if (persisted.get(id) !== json) changed.push({ id, doc: task, json });
      }
      const gone = [...persisted.keys()].filter((id) => !(id in doc.tasks));
      const nextHead = JSON.stringify([doc.schemaVersion, doc.startedAt]);
      try {
        for (let start = 0; start < changed.length; start += BATCH) {
          const batch = changed.slice(start, start + BATCH);
          const at = new Date().toISOString();
          await call('POST', `${LEDGER_TASKS_TABLE}?on_conflict=id`, batch.map((row) => ({ id: row.id, doc: row.doc, atualizado_em: at })), { Prefer: 'resolution=merge-duplicates,return=minimal' });
          for (const row of batch) persisted.set(row.id, row.json);
        }
        for (let start = 0; start < gone.length; start += BATCH) {
          const batch = gone.slice(start, start + BATCH);
          await call('DELETE', `${LEDGER_TASKS_TABLE}?id=in.(${batch.map((id) => `"${id.replace(/["\\]/g, '')}"`).join(',')})`, undefined, { Prefer: 'return=minimal' });
          for (const id of batch) persisted.delete(id);
        }
        if (head !== nextHead) {
          await call('POST', `${LEDGER_META_TABLE}?on_conflict=id`, [{ id: 1, schema_version: doc.schemaVersion, started_at: doc.startedAt, atualizado_em: new Date().toISOString() }], { Prefer: 'resolution=merge-duplicates,return=minimal' });
          head = nextHead;
        }
      } catch (error) {
        log(`[ledger] o Supabase não gravou: ${error instanceof Error ? error.message : 'erro'}`);
        return false;
      }
      current = doc as unknown as RawDoc;
      return true;
    },
  };
}
