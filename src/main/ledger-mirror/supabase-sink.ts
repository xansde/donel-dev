// Espelho do Oráculo — destination Supabase (the owner's PERSONAL project, never a Seazone one): an upsert of every
// row into the table `demandas` through PostgREST. The table and the view "em aberto" are created once by
// docs/oraculo-espelho/supabase.sql. The service key comes from the vault at each push and never enters an error
// message or a log line.

import type { MirrorSink } from './mirror';

export const SUPABASE_TABLE = 'demandas';
const TIMEOUT_MS = 20_000;
/** PostgREST takes a big body, but a bounded batch keeps one bad row from hiding the rest. */
const BATCH = 200;

export interface SupabaseSinkDeps {
  /** `https://<ref>.supabase.co`. */
  readonly url: string;
  /** The service key, read when needed; `null` = not in the vault. */
  readonly key: () => string | null;
  readonly fetch?: typeof fetch;
}

export function createSupabaseSink(deps: SupabaseSinkDeps): MirrorSink {
  const doFetch = deps.fetch ?? fetch;
  const endpoint = `${deps.url.replace(/\/+$/, '')}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`;
  return {
    async push(rows) {
      const key = deps.key();
      if (!key) throw new Error('a chave do Supabase não está no cofre');
      for (let start = 0; start < rows.length; start += BATCH) {
        const batch = rows.slice(start, start + BATCH);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let response: Response;
        try {
          response = await doFetch(endpoint, {
            method: 'POST',
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify(batch.map((row) => ({ ...row, atualizado_em: new Date().toISOString() }))),
            signal: controller.signal,
          });
        } catch (error) {
          // undici hides the reason in `cause` (a connect timeout, DNS, a reset); only its code goes out, never a secret.
          const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
          const reason = typeof code === 'string' ? code : error instanceof Error ? error.name : 'erro';
          throw new Error(controller.signal.aborted ? 'sem resposta do Supabase em 20 s' : `sem rede (${reason})`);
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) {
          const detail = (await response.text().catch(() => '')).slice(0, 200).replaceAll(key, '[chave]');
          throw new Error(`Supabase respondeu ${response.status}${detail ? `: ${detail}` : ''}`);
        }
      }
    },
  };
}
