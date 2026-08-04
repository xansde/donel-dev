// Spec 010 (D-10) — vertical pequeno, passo 2: a traducao FATO → EVENTO. Parte
// PURA da ingestao: recebe um `result.json` ja validado por
// `parseEsteiraResult` e devolve os eventos a acrescentar no store. Sem fs, sem
// Electron, nunca lanca. Quem descobre o arquivo, grava e observa o diretorio e
// o lado main (`esteira-store.ts` / o watcher).
//
// Duas regras que este modulo existe para cumprir:
//
// 1. **O app nao inventa.** Um fato nao declarado nao vira evento. Foi deduzir
//    "houve plano" da AUSENCIA de um campo opcional que produziu a inverdade de
//    03/08 — aqui nao ha deducao nenhuma, so traducao do que esta escrito.
// 2. **O que deu errado tambem e fato.** Run com `status` != `success` gera
//    `phase.failed` com codigo e motivo. Sem isso, "a fase falhou" seria
//    indistinguivel de "a fase nunca rodou" — a mesma inverdade por outra porta.
//
// A traducao snake_case (contrato) → camelCase (modelo do store) acontece AQUI
// e em nenhum outro lugar: o contrato e do mundo externo, o snapshot e do app.

import type { ContractIssue, EntityRef, EsteiraFact, EsteiraResult } from '../contract/resultContract';
import type { EntityId, StoreEventType } from '../store/storeFormat';

export interface EventDraft {
  readonly type: StoreEventType;
  /** Hora do EVENTO (quando o fato foi produzido), nao da gravacao. O writer nao a reescreve. */
  readonly at: string;
  readonly dedupe_key: string | null;
  readonly payload: Record<string, unknown>;
}

export interface IngestSource {
  /** Caminho do `result.json` de onde os fatos vieram — a trilha de volta ao arquivo. */
  readonly resultPath: string;
}

function refToId(ref: EntityRef): EntityId {
  return { entity: ref.entity, id: ref.id };
}

function refKey(ref: EntityRef): string {
  return `${ref.entity}:${ref.id}`;
}

/**
 * O assunto do run, do mais especifico para o mais amplo. E o que ancora
 * `phase.failed` e o erro de ingestao no card certo.
 */
export function runSubject(result: EsteiraResult): EntityId {
  const { discovery_id, plan_id, work_item_id } = result.subject;
  if (work_item_id !== null) return { entity: 'work_item', id: work_item_id };
  if (plan_id !== null) return { entity: 'plan', id: plan_id };
  return { entity: 'discovery', id: discovery_id };
}

/** `<run_id>:<tipo do fato>:<chave natural>` — o formato de `passo-zero.md` §2. */
function dedupeKey(runId: string, factType: string, natural: string): string {
  return `${runId}:${factType}:${natural}`;
}

function factToDraft(fact: EsteiraFact, index: number, result: EsteiraResult): EventDraft | null {
  const runId = result.run.run_id;
  const at = result.run.finished_at;
  const discoveryId = result.subject.discovery_id;

  switch (fact.type) {
    case 'discovery.recorded':
      return {
        type: 'discovery.created',
        at,
        dedupe_key: dedupeKey(runId, fact.type, fact.discovery_id),
        payload: {
          id: fact.discovery_id,
          title: fact.title,
          problem: fact.problem,
          tracker: fact.tracker === null ? null : { provider: fact.tracker.provider, cardId: fact.tracker.card_id },
          targetRepo: fact.target_repo,
          scopeRepos: fact.scope_repos,
          createdAt: at,
        },
      };

    case 'plan.recorded':
      return {
        type: 'plan.created',
        at,
        dedupe_key: dedupeKey(runId, fact.type, fact.plan_id),
        payload: {
          id: fact.plan_id,
          discoveryId: fact.discovery_id,
          title: fact.title,
          summary: fact.summary,
          createdAt: at,
        },
      };

    case 'work_item.recorded':
      return {
        type: 'work_item.created',
        at,
        dedupe_key: dedupeKey(runId, fact.type, fact.work_item_id),
        payload: {
          id: fact.work_item_id,
          // O item herda o discovery do SUBJECT do run: e o que garante que um
          // item sem plano (legitimo) ainda tenha onde aparecer no card.
          discoveryId,
          planId: fact.plan_id,
          itemType: fact.item_type,
          title: fact.title,
          targetRepo: fact.target_repo,
          scopeRepos: fact.scope_repos,
          state: 'open',
          createdBySkill: true,
          createdAt: at,
        },
      };

    case 'relation.recorded':
      return {
        type: 'relation.added',
        at,
        dedupe_key: dedupeKey(runId, fact.type, `${fact.relation}:${refKey(fact.from)}->${refKey(fact.to)}`),
        payload: {
          relation: fact.relation,
          from: refToId(fact.from),
          to: refToId(fact.to),
          recordedAt: at,
        },
      };

    case 'artifact.recorded':
      return {
        type: 'artifact.pinned',
        at,
        dedupe_key: dedupeKey(runId, fact.type, `${refKey(fact.owner)}:${fact.artifact_kind}:${fact.path}`),
        payload: {
          owner: refToId(fact.owner),
          artifactKind: fact.artifact_kind,
          location: fact.location,
          repo: fact.repo,
          path: fact.path,
          recordedAt: at,
        },
      };

    case 'verification.recorded':
      return {
        type: 'verification.updated',
        at,
        dedupe_key: dedupeKey(runId, fact.type, `${refKey(fact.subject)}:${fact.verification_kind}:${fact.ref ?? ''}`),
        payload: {
          subject: refToId(fact.subject),
          verificationKind: fact.verification_kind,
          state: fact.state,
          ref: fact.ref,
          recordedAt: at,
        },
      };

    case 'phase.completed':
      return {
        type: 'phase.completed',
        at,
        dedupe_key: dedupeKey(runId, fact.type, `${refKey(fact.subject)}:${fact.phase}`),
        payload: {
          subject: refToId(fact.subject),
          phase: fact.phase,
          outcome: fact.outcome,
          summary: fact.summary,
          at,
          runId,
        },
      };

    case 'lock.acquired':
      return {
        type: 'lock.acquired',
        at,
        dedupe_key: dedupeKey(runId, fact.type, `${refKey(fact.subject)}:${fact.phase}`),
        payload: {
          subject: refToId(fact.subject),
          phase: fact.phase,
          holderKind: fact.holder.kind,
          acquiredAt: fact.holder.acquired_at,
          cliSessionId: fact.holder.cli_session_id,
          mirroredLabel: null,
        },
      };

    case 'lock.released':
      return {
        type: 'lock.released',
        at,
        dedupe_key: dedupeKey(runId, fact.type, `${refKey(fact.subject)}:${fact.phase}`),
        payload: { subject: refToId(fact.subject), phase: fact.phase, at },
      };

    case 'note.recorded':
      // Chave pelo INDICE: duas notas de texto igual no mesmo run sao dois
      // gestos, e a chave so precisa impedir que o MESMO arquivo, relido, empilhe.
      return {
        type: 'note.added',
        at,
        dedupe_key: dedupeKey(runId, fact.type, String(index)),
        payload: { subject: refToId(fact.subject), text: fact.text, at },
      };
  }
}

/**
 * Traduz um `result.json` validado nos eventos a acrescentar. A ordem e a dos
 * fatos declarados; `phase.failed`, quando existe, vem por ultimo — ele fala do
 * run inteiro, nao de um fato.
 */
export function resultToEvents(result: EsteiraResult, source: IngestSource): readonly EventDraft[] {
  void source; // o caminho do arquivo viaja no `source` do envelope, gravado pelo writer
  const drafts: EventDraft[] = [];

  result.facts.forEach((fact, index) => {
    const draft = factToDraft(fact, index, result);
    if (draft !== null) drafts.push(draft);
  });

  if (result.run.status !== 'success') {
    const failure = result.run.failure;
    drafts.push({
      type: 'phase.failed',
      at: result.run.finished_at,
      dedupe_key: dedupeKey(result.run.run_id, 'run.failed', result.run.phase),
      payload: {
        subject: runSubject(result),
        phase: result.run.phase,
        status: result.run.status,
        failure: failure === null ? null : { code: failure.code, message: failure.message },
        at: result.run.finished_at,
        runId: result.run.run_id,
      },
    });
  }

  return drafts;
}

export interface IngestFailureInput {
  readonly resultPath: string;
  readonly issues: readonly ContractIssue[];
  /** O card em que o erro aparece, quando da para saber pelo documento. `null` = erro sem dono conhecido. */
  readonly subject: EntityId | null;
  readonly at: string;
}

/**
 * D-10 — documento fora do contrato vira ERRO VISIVEL, com os issues do parser.
 * A `dedupe_key` e o caminho do arquivo: o mesmo arquivo quebrado, reprocessado
 * a cada boot, mostra UM erro, nao uma pilha deles.
 */
export function ingestFailureEvent(input: IngestFailureInput): EventDraft {
  return {
    type: 'ingest.failed',
    at: input.at,
    dedupe_key: `ingest.failed:${input.resultPath}`,
    payload: {
      resultPath: input.resultPath,
      at: input.at,
      subject: input.subject,
      issues: input.issues.map((issue) => ({ code: issue.code, path: issue.path, message: issue.message })),
    },
  };
}
