// t-b3f48bf5 — the phone's homologation screen (`GET /api/v2/homologacao`). The homologation runs on its own machine
// and never depends on us: a cron here (~/bin/rotinas/homologacao-celular/exportar_homologacao.py, every 15 min) reads
// that machine read only, cleans what is sensitive (names become roles; no session id, e-mail, link, Slack thread,
// Supabase ref or vault path) and writes one file, `export.json` (format `homologacao-painel@1`). This route only reads
// that file: no shell, no ssh, no other path (the path is fixed by the daemon's config, never by the request), and it
// adds nothing to what the file says besides how old it is.
//
// Behind the local flag `celular-homologacao`, read at every request: absent = 404 `desligada`.

import { readFileSync, statSync } from 'node:fs';

export const HOMOLOGACAO_FLAG = 'celular-homologacao';
export const HOMOLOGACAO_PATH = 'homologacao';
export const HOMOLOGACAO_FORMATO = 'homologacao-painel@1';
/** Past this the copy is answered with `velho: true` (the cron runs every 15 min). */
export const HOMOLOGACAO_VELHO_MIN = 60;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MINUTE_MS = 60_000;

export interface HomologacaoPaths {
  /** The cron's copy (`DONEL_HOMOLOGACAO_EXPORT`, else `~/.donel/homologacao/export.json`). */
  readonly file: string;
}

export type HomologacaoLeitura =
  | { readonly kind: 'ausente' }
  | { readonly kind: 'invalida'; readonly motivo: string }
  | { readonly kind: 'ok'; readonly body: { readonly lidoEm: string; readonly idadeMin: number; readonly velho: boolean; readonly dados: Record<string, unknown> } };

/** Reads the copy as it is. The answer's `dados` is the file, untouched. */
export function lerHomologacao(paths: HomologacaoPaths, nowMs: number): HomologacaoLeitura {
  let size: number;
  let mtimeMs: number;
  try {
    const st = statSync(paths.file);
    if (!st.isFile()) return { kind: 'ausente' };
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return { kind: 'ausente' };
  }
  if (size > MAX_FILE_BYTES) return { kind: 'invalida', motivo: 'grande demais' };
  let dados: unknown;
  try {
    dados = JSON.parse(readFileSync(paths.file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'ausente' };
    return { kind: 'invalida', motivo: 'JSON quebrado' };
  }
  if (typeof dados !== 'object' || dados === null || Array.isArray(dados)) return { kind: 'invalida', motivo: 'não é um objeto' };
  const doc = dados as Record<string, unknown>;
  if (doc.formato !== HOMOLOGACAO_FORMATO) return { kind: 'invalida', motivo: 'formato desconhecido' };
  const lidoMs = typeof doc.lidoEm === 'string' ? Date.parse(doc.lidoEm) : Number.NaN;
  const base = Number.isFinite(lidoMs) ? lidoMs : mtimeMs;
  const idadeMin = Math.max(0, Math.floor((nowMs - base) / MINUTE_MS));
  return {
    kind: 'ok',
    body: {
      lidoEm: Number.isFinite(lidoMs) ? (doc.lidoEm as string) : new Date(mtimeMs).toISOString(),
      idadeMin,
      velho: idadeMin > HOMOLOGACAO_VELHO_MIN,
      dados: doc,
    },
  };
}
