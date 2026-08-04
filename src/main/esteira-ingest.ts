// Spec 010 (D-10) — vertical pequeno, passo 2: a INGESTAO. Descobre o
// `result.json` que a skill deixou, valida contra o contrato e traduz em
// eventos do store. A traducao em si e pura (`shared/esteira/ingest`); aqui
// mora o encanamento de disco.
//
// A REGRA que este modulo existe para cumprir: **o app nunca afirma o que nao
// leu**. Documento fora do contrato nao e ignorado nem "interpretado do jeito
// que der" — vira `ingest.failed` com os issues do parser e o caminho do
// arquivo, visivel no card. "Nao consegui ler" e um estado; "nao realizada" e
// uma afirmacao. Confundir os dois foi o bug de 03/08.
//
// Nada aqui lanca: arquivo ausente, permissao negada ou JSON truncado degradam
// para um resultado tipado.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEsteiraResultText } from '../shared/esteira/contract/resultContract';
import { ingestFailureEvent, resultToEvents } from '../shared/esteira/ingest/resultToEvents';
import type { EsteiraStore } from './esteira-store';

/**
 * O "local combinado" — onde a skill deixa o `result.json` e o app o encontra.
 *
 * Fora do repo (nao polui checkout nem vira commit acidental), fora do
 * `userData` (a skill nao sabe o nome nem o canal do app), no home LOCAL —
 * nunca no OneDrive, onde sync gera conflito.
 */
export const ESTEIRA_OUTBOX_DIR_ENV_VAR = 'DONEL_ESTEIRA_OUTBOX_DIR';

export function esteiraOutboxDir(env: Record<string, string | undefined>, homedirFn: () => string): string {
  const override = env[ESTEIRA_OUTBOX_DIR_ENV_VAR];
  return override && override.trim() ? override : join(homedirFn(), '.claude', 'esteira-donel', 'outbox');
}

export type IngestStatus =
  /** Fatos gravados no store. */
  | 'ingested'
  /** Ja estava no store (mesmo `run_id`): nenhuma linha nova. */
  | 'already-ingested'
  /** Fora do contrato: virou `ingest.failed` VISIVEL, com os issues. */
  | 'rejected'
  /** Nao deu para ler o arquivo (ausente, permissao). Nao e afirmacao sobre a fase. */
  | 'unreadable'
  /** O store recusou escrita (cabecalho de major a frente, por exemplo). */
  | 'store-refused';

export interface IngestOutcome {
  readonly status: IngestStatus;
  readonly resultPath: string;
  readonly runId: string | null;
}

/** Le um `result.json` e o grava no store. Nunca lanca. */
export function ingestResultFile(store: EsteiraStore, resultPath: string): IngestOutcome {
  let text: string;
  try {
    text = readFileSync(resultPath, 'utf8');
  } catch {
    // Nao ler um arquivo NAO diz nada sobre o trabalho que ele descreve — e por
    // isso que este caminho nao grava fato nenhum.
    return { status: 'unreadable', resultPath, runId: null };
  }

  const parsed = parseEsteiraResultText(text);

  if (!parsed.ok) {
    // O erro precisa ter DONO: sem o `subject` do documento (que pode estar
    // ilegivel), ele aparece como erro sem card, mas aparece.
    const subject = subjectFromRawText(text);
    const failure = ingestFailureEvent({
      resultPath,
      issues: parsed.issues,
      subject,
      at: new Date().toISOString(),
    });
    const written = store.append([failure], { kind: 'app' });
    if (!written.ok) return { status: 'store-refused', resultPath, runId: null };
    return { status: 'rejected', resultPath, runId: null };
  }

  const result = parsed.result;
  const drafts = resultToEvents(result, { resultPath });
  const written = store.append(drafts, { kind: 'ingest', run_id: result.run.run_id, result_path: resultPath });

  if (!written.ok) return { status: 'store-refused', resultPath, runId: result.run.run_id };
  // Zero eventos escritos com drafts nao-vazios = tudo ja estava la (dedupe).
  if (written.events.length === 0 && drafts.length > 0) {
    return { status: 'already-ingested', resultPath, runId: result.run.run_id };
  }
  return { status: 'ingested', resultPath, runId: result.run.run_id };
}

/**
 * Tenta achar o assunto num documento que o parser recusou. Best-effort de
 * proposito: e melhor um erro ancorado no card certo do que um erro correto e
 * invisivel — mas nunca se INVENTA um dono quando o documento nao diz qual e.
 */
function subjectFromRawText(text: string): { entity: 'discovery' | 'plan' | 'work_item'; id: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const subject = (parsed as Record<string, unknown>).subject;
  if (typeof subject !== 'object' || subject === null) return null;

  const node = subject as Record<string, unknown>;
  const workItemId = typeof node.work_item_id === 'string' ? node.work_item_id : null;
  const planId = typeof node.plan_id === 'string' ? node.plan_id : null;
  const discoveryId = typeof node.discovery_id === 'string' ? node.discovery_id : null;

  if (workItemId) return { entity: 'work_item', id: workItemId };
  if (planId) return { entity: 'plan', id: planId };
  if (discoveryId) return { entity: 'discovery', id: discoveryId };
  return null;
}

export interface OutboxSummary {
  readonly ingested: number;
  readonly alreadyIngested: number;
  readonly rejected: number;
  readonly unreadable: number;
  readonly outcomes: readonly IngestOutcome[];
}

/**
 * Varre o diretorio combinado. Ordem alfabetica (nome com `run_id` datado ja
 * ordena por tempo) e, principalmente, TOLERANTE: um arquivo ruim nao impede os
 * outros de entrarem.
 *
 * O arquivo NAO e movido nem apagado depois de ingerido — a idempotencia vem do
 * `run_id`, e apagar o insumo destruiria a trilha de volta ao que a skill
 * escreveu.
 */
export function ingestOutbox(store: EsteiraStore, outboxDir: string): OutboxSummary {
  if (!existsSync(outboxDir)) {
    return { ingested: 0, alreadyIngested: 0, rejected: 0, unreadable: 0, outcomes: [] };
  }

  let names: string[];
  try {
    names = readdirSync(outboxDir).filter((name) => name.toLowerCase().endsWith('.json')).sort();
  } catch {
    return { ingested: 0, alreadyIngested: 0, rejected: 0, unreadable: 0, outcomes: [] };
  }

  const outcomes = names.map((name) => ingestResultFile(store, join(outboxDir, name)));

  return {
    ingested: outcomes.filter((outcome) => outcome.status === 'ingested').length,
    alreadyIngested: outcomes.filter((outcome) => outcome.status === 'already-ingested').length,
    rejected: outcomes.filter((outcome) => outcome.status === 'rejected').length,
    unreadable: outcomes.filter((outcome) => outcome.status === 'unreadable').length,
    outcomes,
  };
}
